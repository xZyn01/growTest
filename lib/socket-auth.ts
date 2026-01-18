import jwt from "jsonwebtoken";
import { User } from "@/generated/prisma";

const REALTIME_SECRET = process.env.REALTIME_SECRET || "super-secret-key_CHANGE_ME";

export async function generateSocketToken(user: User) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    bio: user.bio,
    industry: user.industry || null,
    skills: user.skills || [],
    networkingAvailable: user.networkingAvailable,
  };

  // Sign with valid duration (30 minutes for security)
  return jwt.sign(payload, REALTIME_SECRET, { expiresIn: "30m" });
}
