"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import { Phone, X, Video } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Caller {
    id: string;
    name: string;
    image?: string;
    bio?: string;
    industry?: string;
}

interface IncomingCallModalProps {
    caller: Caller | null;
    onAccept: () => void;
    onReject: () => void;
}

export function IncomingCallModal({ caller, onAccept, onReject }: IncomingCallModalProps) {
    if (!caller) return null;

    return (
        <Dialog open={!!caller} onOpenChange={() => onReject()}>
            {/* Lighter backdrop with more blur instead of dark black */}
            <DialogOverlay className="bg-white/10 backdrop-blur-md" />
            <DialogContent className="sm:max-w-[400px] p-0 border-none shadow-2xl bg-transparent sm:rounded-3xl overflow-hidden focus:outline-none ring-0 outline-none">
                {/* Accessible Title (Visually Hidden) */}
                <div className="sr-only">
                    <DialogTitle>Incoming Call from {caller.name}</DialogTitle>
                </div>

                <div className="relative bg-white/80 backdrop-blur-2xl p-8 flex flex-col items-center justify-center gap-6 rounded-3xl border border-white/40 ring-1 ring-black/5 shadow-xl">

                    {/* Status Indicator */}
                    <div className="flex items-center gap-2 mb-2">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </span>
                        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/80">
                            Incoming Call...
                        </span>
                    </div>

                    {/* Caller Info */}
                    <div className="flex flex-col items-center gap-4 text-center w-full">
                        <div className="relative">
                            <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-emerald-500 to-blue-500 opacity-30 blur-sm animate-pulse" />
                            <Avatar className="h-24 w-24 border-4 border-white shadow-xl">
                                <AvatarImage src={caller.image} className="object-cover" />
                                <AvatarFallback className="text-3xl font-medium bg-zinc-100">
                                    {caller.name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                        </div>

                        <div className="space-y-1.5">
                            <h3 className="text-2xl font-bold tracking-tight text-foreground">
                                {caller.name}
                            </h3>
                            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                {caller.industry || "Professional Connection"}
                            </p>
                            {caller.bio && (
                                <p className="text-xs text-muted-foreground line-clamp-1 max-w-[200px] mx-auto mt-2">
                                    {caller.bio}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-4 w-full mt-4">
                        <Button
                            variant="outline"
                            size="lg"
                            className="h-14 rounded-2xl border-2 border-red-100 bg-red-50/50 hover:bg-red-100 hover:border-red-200 text-red-600 transition-all duration-300"
                            onClick={onReject}
                        >
                            <X className="h-5 w-5 mr-2" />
                            Decline
                        </Button>

                        <Button
                            variant="default"
                            size="lg"
                            className="h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/25 text-white transition-all duration-300 border-none"
                            onClick={onAccept}
                        >
                            <Video className="h-5 w-5 mr-2 fill-current" />
                            Accept
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
