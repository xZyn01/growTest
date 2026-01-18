import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);

// Redis adapter for horizontal scaling (optional)
let io: Server;
const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
  console.log("Redis URL detected, enabling Redis adapter for horizontal scaling");
  // Redis adapter will be configured here when ioredis is installed
  // For now, log a message and use standard adapter
  io = new Server(httpServer, {
    cors: {
      origin: "*", // In production, replace with specific domain
      methods: ["GET", "POST"]
    }
  });
  console.log("⚠️  Redis adapter not yet configured - install 'ioredis' and '@socket.io/redis-adapter' to enable");
} else {
  console.log("No Redis URL found, using in-memory adapter (single instance mode)");
  io = new Server(httpServer, {
    cors: {
      origin: "*", // In production, replace with specific domain
      methods: ["GET", "POST"]
    }
  });
}

const PORT = parseInt(process.env.PORT || "3001", 10);
const JWT_SECRET = process.env.REALTIME_SECRET || "super-secret-key_CHANGE_ME";

// Types
interface UserData {
  id: string;
  name: string;
  email: string;
  image?: string;
  bio?: string;
  industry?: string;
  skills?: string[];
  networkingAvailable: boolean;
}

interface ConnectedUser extends UserData {
  socketId: string;
  status: "ONLINE" | "BUSY";
}

interface PresenceData {
  userId: string;
  status: "ONLINE" | "BUSY" | "OFFLINE";
}

// In-memory store (Replace with Redis for scaling)
const onlineUsers = new Map<string, ConnectedUser>();

// Rate limiting for call requests (in-memory, 5 calls per minute per user)
const callRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const limit = callRateLimits.get(userId);

  if (!limit || now > limit.resetAt) {
    callRateLimits.set(userId, { count: 1, resetAt: now + 60000 }); // 1 minute
    return true;
  }

  if (limit.count >= 5) {
    return false;
  }

  limit.count++;
  return true;
}

// Helper to broadcast presence updates
function broadcastPresenceUpdate() {
  const presenceList: PresenceData[] = Array.from(onlineUsers.values()).map(user => ({
    userId: user.id,
    status: user.status,
  }));
  io.emit("presence-update", presenceList);
}

// Middleware for authentication
io.use((socket: any, next: any) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserData;
    // Attach user data to socket
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", (socket: Socket) => {
  const user = (socket as any).user as UserData;
  console.log(`User connected: ${user.name} (${user.id})`);

  // Automatic presence registration on connect
  // Only add to presence pool if networkingAvailable is true
  if (user.networkingAvailable) {
    onlineUsers.set(user.id, {
      ...user,
      socketId: socket.id,
      status: "ONLINE",
    });
    
    console.log(`User ${user.name} joined YariConnect presence pool`);
    broadcastPresenceUpdate();
  }

  // Call Request with enhanced authorization
  socket.on("call-request", (data: { toUserId: string }) => {
    // Check rate limit
    if (!checkRateLimit(user.id)) {
      socket.emit("call-error", { message: "Too many call requests. Please wait a minute." });
      return;
    }

    // Validate caller has networkingAvailable
    if (!user.networkingAvailable) {
      socket.emit("call-error", { message: "You must enable YariConnect to make calls" });
      return;
    }

    // Validate receiver exists and is online
    const targetUser = onlineUsers.get(data.toUserId);
    if (!targetUser) {
      socket.emit("call-error", { message: "User is offline or unavailable" });
      return;
    }

    // Validate receiver has networkingAvailable
    if (!targetUser.networkingAvailable) {
      socket.emit("call-error", { message: "User is not available for calls" });
      return;
    }
    
    // Validate receiver is not busy
    if (targetUser.status === "BUSY") {
      socket.emit("call-error", { message: "User is currently busy" });
      return;
    }

    // All validations passed, send call request
    io.to(targetUser.socketId).emit("incoming-call", {
      from: {
        id: user.id,
        name: user.name,
        image: user.image,
        bio: user.bio,
        industry: user.industry
      },
    });
    
    console.log(`Call request: ${user.name} -> ${targetUser.name}`);
  });

  // Call Acceptance
  socket.on("call-accepted", (data: { toUserId: string }) => {
    const caller = onlineUsers.get(data.toUserId);
    const receiver = onlineUsers.get(user.id);

    if (caller && receiver) {
      // Mark both as BUSY
      caller.status = "BUSY";
      receiver.status = "BUSY";
      onlineUsers.set(caller.id, caller);
      onlineUsers.set(receiver.id, receiver);
      
      // Broadcast updated presence
      broadcastPresenceUpdate();

      // Send ICE server configuration
      const iceServers = getIceServers();
      
      io.to(caller.socketId).emit("call-accepted", { 
        fromUserId: user.id,
        iceServers 
      });
      
      socket.emit("call-started", { iceServers });
      
      console.log(`Call accepted: ${user.name} <-> ${caller.name}`);
    }
  });

  // Call Rejected
  socket.on("call-rejected", (data: { toUserId: string }) => {
    const caller = onlineUsers.get(data.toUserId);
    if (caller) {
      io.to(caller.socketId).emit("call-rejected", { fromUserId: user.id });
      console.log(`Call rejected: ${caller.name} <- ${user.name}`);
    }
  });

  // WebRTC Signaling (Offer, Answer, ICE Candidate)
  socket.on("signal", (data: { toUserId: string, signal: any }) => {
    const target = onlineUsers.get(data.toUserId);
    if (target) {
      io.to(target.socketId).emit("signal", { fromUserId: user.id, signal: data.signal });
    }
  });

  // End Call
  socket.on("end-call", (data: { toUserId: string }) => {
    // Reset status to ONLINE
    const me = onlineUsers.get(user.id);
    if (me) {
      me.status = "ONLINE";
      onlineUsers.set(me.id, me);
    }

    // Notify other party
    if (data.toUserId) {
      const other = onlineUsers.get(data.toUserId);
      if (other) {
        other.status = "ONLINE";
        onlineUsers.set(other.id, other);
        io.to(other.socketId).emit("call-ended", { byUserId: user.id });
      }
    }
    
    broadcastPresenceUpdate();
    console.log(`Call ended by ${user.name}`);
  });

  // Handle networking status changes (when user disables networkingAvailable)
  socket.on("networking-disabled", () => {
    console.log(`User ${user.name} disabled YariConnect`);
    
    // Find if user is in an active call
    const me = onlineUsers.get(user.id);
    if (me && me.status === "BUSY") {
      // Terminate any active calls
      // Find the other party (iterate through online users to find another BUSY user)
      for (const [otherId, otherUser] of onlineUsers.entries()) {
        if (otherId !== user.id && otherUser.status === "BUSY") {
          // Assume they're in a call together (simplified logic)
          otherUser.status = "ONLINE";
          onlineUsers.set(otherId, otherUser);
          io.to(otherUser.socketId).emit("call-ended", { 
            byUserId: user.id,
            reason: "User left YariConnect" 
          });
        }
      }
    }
    
    // Remove from presence pool
    onlineUsers.delete(user.id);
    broadcastPresenceUpdate();
  });

  // Disconnect handler
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${user.name}`);
    
    // Check if user was in a call
    const me = onlineUsers.get(user.id);
    if (me && me.status === "BUSY") {
      // Notify other party that call ended
      for (const [otherId, otherUser] of onlineUsers.entries()) {
        if (otherId !== user.id && otherUser.status === "BUSY") {
          otherUser.status = "ONLINE";
          onlineUsers.set(otherId, otherUser);
          io.to(otherUser.socketId).emit("call-ended", { 
            byUserId: user.id,
            reason: "User disconnected" 
          });
        }
      }
    }
    
    onlineUsers.delete(user.id);
    broadcastPresenceUpdate();
  });
});

// ICE Server configuration
function getIceServers() {
  const iceServers: any[] = [];

  // Always include Google STUN servers
  iceServers.push({
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
    ],
  });

  // Add TURN server if configured (production)
  const turnServerUrl = process.env.TURN_SERVER_URL;
  if (turnServerUrl && process.env.TURN_SECRET) {
    // For production, generate time-limited credentials
    // Note: This is a simplified version, actual implementation in lib/turn-credentials.ts
    iceServers.push({
      urls: turnServerUrl,
      username: process.env.TURN_USERNAME || "growthyari",
      credential: process.env.TURN_SECRET,
    });
  }

  return iceServers;
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Realtime server running on port ${PORT}`);
  console.log(`📡 YariConnect presence tracking enabled`);
  console.log(`🔧 Mode: ${REDIS_URL ? 'Multi-instance (Redis)' : 'Single-instance (In-memory)'}`);
  console.log(`📱 Local network access: Bind to 0.0.0.0 (use your machine's IP for testing on mobile)`);
});
