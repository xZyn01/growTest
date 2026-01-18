"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { UserCard } from "@/components/networking/UserCard";
import { IncomingCallModal } from "@/components/networking/IncomingCallModal";
import { VideoCall } from "@/components/networking/VideoCall";
import { Button } from "@/components/ui/button";
import { Loader2, WifiOff, Search, Zap, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface YariConnectClientProps {
    token: string;
    currentUser: any;
    initialNetworkingAvailable: boolean;
}

interface YariConnectMember {
    id: string;
    name: string;
    email: string;
    image?: string;
    bio?: string;
    location?: string;
    headline?: string;
    industry?: string;
    experienceLevel?: string;
    interests?: string[];
    skills?: string[];
}

interface PresenceData {
    userId: string;
    status: "ONLINE" | "BUSY" | "OFFLINE";
}

interface DisplayUser extends YariConnectMember {
    status: "ONLINE" | "BUSY" | "OFFLINE";
}

export default function YariConnectClient({ token, currentUser, initialNetworkingAvailable }: YariConnectClientProps) {
    const [socket, setSocket] = useState<Socket | null>(null);

    // Separate membership and presence data
    const [allMembers, setAllMembers] = useState<YariConnectMember[]>([]);
    const [presenceMap, setPresenceMap] = useState<Map<string, "ONLINE" | "BUSY" | "OFFLINE">>(new Map());
    const [isLoadingMembers, setIsLoadingMembers] = useState(true);

    // Filter state
    const [showOnlineOnly, setShowOnlineOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    // Call States
    const [incomingCall, setIncomingCall] = useState<any | null>(null);
    const [activeCall, setActiveCall] = useState<{ userId: string; isInitiator: boolean; iceServers?: any[] } | null>(null);

    const socketRef = useRef<Socket | null>(null);

    // Fetch YariConnect members on mount
    useEffect(() => {
        async function fetchMembers() {
            try {
                const response = await fetch("/api/yariconnect/members");
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
                    console.error("Failed to fetch members:", response.status, errorData);
                    throw new Error(errorData.error || `Failed to fetch members (${response.status})`);
                }
                const data = await response.json();
                setAllMembers(data.members || []);
                console.log(`Loaded ${data.members?.length || 0} YariConnect members`);
            } catch (error) {
                console.error("Error fetching YariConnect members:", error);
                const errorMessage = error instanceof Error ? error.message : "Failed to load YariConnect members";
                toast.error(errorMessage);
            } finally {
                setIsLoadingMembers(false);
            }
        }

        fetchMembers();
    }, []);

    // Connect to Socket.IO for presence updates
    useEffect(() => {
        const envUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
        // If envUrl is empty string (Proxy Mode), use undefined (relative).
        // Otherwise use envUrl or fallback to localhost:3001.
        const connectionUrl = envUrl === "" ? undefined : (envUrl || "http://localhost:3001");

        const newSocket = io(connectionUrl, {
            auth: { token },
            transports: ["websocket"],
            reconnectionAttempts: 5,
        });

        socketRef.current = newSocket;
        setSocket(newSocket);

        newSocket.on("connect", () => {
            console.log("Connected to realtime server");
        });

        // Listen for presence updates instead of users-update
        newSocket.on("presence-update", (presenceList: PresenceData[]) => {
            const newPresenceMap = new Map<string, "ONLINE" | "BUSY" | "OFFLINE">();
            presenceList.forEach(p => {
                newPresenceMap.set(p.userId, p.status);
            });
            setPresenceMap(newPresenceMap);
        });

        newSocket.on("incoming-call", (data) => {
            setIncomingCall(data);
        });

        newSocket.on("call-accepted", ({ answer, fromUserId }) => {
            // Handled in VideoCall component normally, but we track state here if needed
            setActiveCall({ userId: fromUserId, isInitiator: true });
        });

        newSocket.on("call-rejected", () => {
            toast.error("Call rejected");
            setActiveCall(null);
        });

        newSocket.on("call-ended", (data) => {
            const reason = data.reason || "Call ended";
            toast.info(reason);
            setActiveCall(null);
            setIncomingCall(null);
        });

        newSocket.on("call-error", (data) => {
            toast.error(data.message);
        });

        return () => {
            newSocket.disconnect();
        };
    }, [token]);

    // Merge membership and presence data
    const displayUsers: DisplayUser[] = allMembers.map(member => ({
        ...member,
        status: presenceMap.get(member.id) || "OFFLINE"
    }));

    // Apply filters
    let filteredUsers = displayUsers;

    // Online-only filter
    if (showOnlineOnly) {
        filteredUsers = filteredUsers.filter(u => u.status === "ONLINE");
    }

    // Search filter
    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filteredUsers = filteredUsers.filter(u =>
            u.name.toLowerCase().includes(query) ||
            u.bio?.toLowerCase().includes(query) ||
            u.skills?.some(s => s.toLowerCase().includes(query)) ||
            u.interests?.some(i => i.toLowerCase().includes(query)) ||
            u.industry?.toLowerCase().includes(query)
        );
    }

    // Count online users
    const onlineCount = displayUsers.filter(u => u.status === "ONLINE").length;

    const handleConnect = (userId: string) => {
        if (!socketRef.current) return;
        socketRef.current.emit("call-request", { toUserId: userId });
        toast.info("Calling...");
    };

    const handleAcceptCall = () => {
        if (!socketRef.current || !incomingCall) return;
        socketRef.current.emit("call-accepted", { toUserId: incomingCall.id });
        setActiveCall({ userId: incomingCall.id, isInitiator: false });
        setIncomingCall(null);
    };

    const handleRejectCall = () => {
        if (!socketRef.current || !incomingCall) return;
        socketRef.current.emit("call-rejected", { toUserId: incomingCall.id });
        setIncomingCall(null);
    };

    const handleEndCall = () => {
        if (!socketRef.current || !activeCall) return;
        socketRef.current.emit("end-call", { toUserId: activeCall.userId });
        setActiveCall(null);
    };

    if (activeCall && socket) {
        const remoteUser = allMembers.find(u => u.id === activeCall.userId);

        return (
            <VideoCall
                socket={socket}
                remoteUserId={activeCall.userId}
                remoteUser={remoteUser}
                isInitiator={activeCall.isInitiator}
                onEndCall={handleEndCall}
                currentUser={currentUser}
                iceServers={activeCall.iceServers}
            />
        );
    }

    return (
        <div className="container mx-auto p-6 min-h-screen">
            <div className="flex flex-col items-center justify-center text-center mb-8">
                <div className="flex flex-col items-center justify-center text-center">
                    <span className="text-xs font-semibold tracking-[0.2em] text-emerald-600 uppercase mb-4">
                        YariConnect
                    </span>
                    <h1 className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight">
                        Find Your Next <span className="font-serif italic text-emerald-600">Meaningful Connection</span>
                    </h1>
                    <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
                        Connect with professionals who share your interests and can help
                        accelerate your career growth.
                    </p>

                    {/* Debug Info - Development Only */}
                    {process.env.NODE_ENV === 'development' && (
                        <div className="mt-4 p-3 bg-zinc-100 border border-zinc-200 rounded-lg text-xs font-mono text-left inline-block">
                            <div><strong>Debug Info:</strong></div>
                            <div>Status: <span className={socket?.connected ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                                {socket?.connected ? "CONNECTED" : "DISCONNECTED"}
                            </span></div>
                            <div>Socket ID: {socket?.id || "N/A"}</div>
                            <div>Target URL: {process.env.NEXT_PUBLIC_REALTIME_URL === ""
                                ? <span className="text-blue-600 font-bold">Relative (Proxy Mode)</span>
                                : (process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001")}
                            </div>
                            <div className="text-zinc-500 mt-1">
                                {process.env.NEXT_PUBLIC_REALTIME_URL === ""
                                    ? "Correct! Using Next.js Rewrite Proxy."
                                    : "If on mobile, ensure this is NOT localhost."}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Filter Section */}
            <div className="bg-white border text-card-foreground shadow-sm rounded-xl p-4 mb-8">
                <div className="flex flex-col gap-4">
                    {/* Top Row: Search and Filters */}
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by name, skills, or interests..."
                                className="pl-9 bg-gray-50/50 border-gray-200"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gray-100" />

                    {/* Bottom Row: Status and Toggle */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-2 self-start sm:self-center">
                            <Zap className="h-5 w-5 text-emerald-600 fill-emerald-600" />
                            <span className="font-semibold text-gray-700">Connect Now</span>
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 font-medium">
                                {onlineCount} online
                            </Badge>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                            <span className="text-sm text-muted-foreground">Show online only</span>
                            <button
                                onClick={() => setShowOnlineOnly(!showOnlineOnly)}
                                className={`w-11 h-6 rounded-full relative transition-colors duration-200 ${showOnlineOnly ? 'bg-emerald-600' : 'bg-gray-200'
                                    }`}
                                aria-label="Toggle online only filter"
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${showOnlineOnly ? 'translate-x-6' : 'translate-x-1'
                                    }`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Members Grid */}
            {isLoadingMembers ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin mb-4 opacity-50" />
                    <p>Loading YariConnect members...</p>
                </div>
            ) : !initialNetworkingAvailable ? (
                <div className="flex flex-col items-center justify-center py-20 text-center opacity-70">
                    <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mb-6">
                        <WifiOff className="h-10 w-10" />
                    </div>
                    <h2 className="text-2xl font-semibold">You haven't joined YariConnect yet</h2>
                    <p className="max-w-md mt-2 text-muted-foreground">
                        Enable YariConnect in your profile settings to discover professionals and start networking.
                    </p>
                </div>
            ) : filteredUsers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <p className="text-lg">
                        {showOnlineOnly
                            ? "No YariConnect members are currently online"
                            : searchQuery
                                ? "No members match your search"
                                : "No YariConnect members yet"}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredUsers.map((user) => (
                        <UserCard
                            key={user.id}
                            user={user}
                            onConnect={handleConnect}
                        />
                    ))}
                </div>
            )}

            {incomingCall && (
                <IncomingCallModal
                    caller={incomingCall}
                    onAccept={handleAcceptCall}
                    onReject={handleRejectCall}
                />
            )}
        </div>
    );
}
