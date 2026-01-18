"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Video } from "lucide-react";

interface User {
    id: string;
    name: string;
    image?: string;
    bio?: string;
    industry?: string;
    skills?: string[];
    status: "ONLINE" | "BUSY" | "OFFLINE";
}

interface UserCardProps {
    user: User;
    onConnect: (userId: string) => void;
}

export function UserCard({ user, onConnect }: UserCardProps) {
    const isConnectable = user.status === "ONLINE";

    // Determine status indicator
    const statusConfig = {
        ONLINE: { color: "bg-green-500", text: "Online", textColor: "text-green-700" },
        BUSY: { color: "bg-red-500", text: "Busy", textColor: "text-red-700" },
        OFFLINE: { color: "bg-gray-400", text: "Offline", textColor: "text-gray-600" }
    };

    const status = statusConfig[user.status];

    return (
        <Card className="w-full max-w-sm hover:shadow-lg transition-shadow bg-white border-gray-200">
            <CardHeader className="flex flex-row items-start gap-4 pb-2">
                <div className="relative">
                    <Avatar className="h-12 w-12 border-2 border-primary/20">
                        <AvatarImage src={user.image} alt={user.name} />
                        <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {/* Status indicator dot */}
                    <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 ${status.color} rounded-full border-2 border-white`} />
                </div>
                <div className="flex flex-col flex-1">
                    <h3 className="font-semibold text-lg leading-none text-gray-900">{user.name}</h3>
                    <span className="text-sm text-muted-foreground mt-1">{user.industry || "Tech Enthusiast"}</span>
                    <Badge
                        variant="outline"
                        className={`mt-2 w-fit text-xs ${status.textColor} border-current`}
                    >
                        {status.text}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="pb-2">
                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                    {user.bio || "No bio available."}
                </p>
                {user.skills && user.skills.length > 0 && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                        {user.skills.slice(0, 3).map((skill, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                                {skill}
                            </Badge>
                        ))}
                        {user.skills.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                                +{user.skills.length - 3}
                            </Badge>
                        )}
                    </div>
                )}
            </CardContent>
            <CardFooter className="pt-2">
                <Button
                    className="w-full gap-2"
                    onClick={() => onConnect(user.id)}
                    disabled={!isConnectable}
                    variant={isConnectable ? "default" : "secondary"}
                >
                    <Video className="h-4 w-4" />
                    {user.status === "BUSY" ? "Busy" : user.status === "OFFLINE" ? "Offline" : "Connect"}
                </Button>
            </CardFooter>
        </Card>
    );
}
