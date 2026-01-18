"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

export async function toggleNetworking(available: boolean) {
  // Try NextAuth first
  const session = await auth();
  let userId = session?.user?.id;

  // Fall back to custom JWT
  if (!userId) {
    const cookieStore = await cookies();
    const token = cookieStore.get("user_token")?.value || cookieStore.get("admin_token")?.value;
    
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET) as { userId: string };
        userId = decoded.userId;
      } catch (error) {
        console.error("Invalid JWT in toggleNetworking:", error);
      }
    }
  }

  if (!userId) {
    throw new Error("Unauthorized");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { networkingAvailable: available },
  });

  revalidatePath("/yariconnect");
  
  // Note: Socket.IO will handle presence removal automatically on next connect
  // The client should emit "networking-disabled" event if currently connected
  
  return { success: true };
}

