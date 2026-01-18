"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

interface VideoCallProps {
    socket: Socket;
    remoteUserId: string;
    remoteUser?: any; // Contains name, bio, image, etc.
    isInitiator: boolean;
    onEndCall: () => void;
    currentUser: any;
    iceServers?: any[];
}

const DEFAULT_ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

export function VideoCall({ socket, remoteUserId, remoteUser, isInitiator, onEndCall, iceServers, currentUser }: VideoCallProps) {
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const localStream = useRef<MediaStream | null>(null);
    const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);

    useEffect(() => {
        let startupTimer: NodeJS.Timeout;

        async function startCall() {
            try {
                // Check for browser support and secure context (HTTPS)
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    setError("Camera/Mic access requires HTTPS. On mobile, use a secure connection or enable 'Insecure origins' flags.");
                    console.error("navigator.mediaDevices is undefined. Context might be insecure (HTTP).");
                    return;
                }

                let stream: MediaStream | null = null;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                } catch (err) {
                    console.warn("Failed to get video/audio, trying audio only...", err);
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        setIsVideoOff(true);
                        toast.warning("Camera not found. Switching to audio only.");
                    } catch (audioErr) {
                        console.error("Failed to get audio", audioErr);
                        setError("No camera or microphone found. Please connect a device.");
                        toast.error("No media devices found");
                        return;
                    }
                }

                if (!stream) return;

                localStream.current = stream;

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                const iceConfig = iceServers && iceServers.length > 0
                    ? { iceServers }
                    : DEFAULT_ICE_SERVERS;

                console.log("Using ICE servers:", iceConfig);
                const pc = new RTCPeerConnection(iceConfig);
                peerConnection.current = pc;

                // Add tracks
                stream.getTracks().forEach((track) => {
                    pc.addTrack(track, stream);
                });

                // Handle remote stream
                pc.ontrack = (event) => {
                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = event.streams[0];
                    }
                };

                // Handle ICE candidates
                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit("signal", { toUserId: remoteUserId, signal: { type: "candidate", candidate: event.candidate } });
                    }
                };

                // Signaling Handlers
                socket.on("signal", async (data) => {
                    if (data.fromUserId !== remoteUserId) return;
                    const signal = data.signal;

                    if (signal.type === "offer") {
                        if (pc.signalingState !== "stable") {
                            // Collision handling or unexpected state
                            console.warn("Received offer in non-stable state", pc.signalingState);
                            return;
                        }

                        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));

                        // Process queued candidates
                        while (iceCandidatesQueue.current.length > 0) {
                            const candidate = iceCandidatesQueue.current.shift();
                            if (candidate) {
                                try {
                                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                                } catch (e) {
                                    console.error("Error adding queued ICE candidate", e);
                                }
                            }
                        }

                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        socket.emit("signal", { toUserId: remoteUserId, signal: { type: "answer", answer } });

                    } else if (signal.type === "answer") {
                        if (pc.signalingState === "stable") {
                            console.warn("Received answer but connection is already stable. Ignoring.");
                            return;
                        }
                        await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
                        // Process queued candidates
                        while (iceCandidatesQueue.current.length > 0) {
                            const candidate = iceCandidatesQueue.current.shift();
                            if (candidate) {
                                try {
                                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                                } catch (e) {
                                    console.error("Error adding queued ICE candidate", e);
                                }
                            }
                        }

                    } else if (signal.type === "candidate") {
                        const candidate = signal.candidate;
                        if (pc.remoteDescription && pc.remoteDescription.type) {
                            try {
                                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                            } catch (e) {
                                console.error("Error adding ICE candidate", e);
                            }
                        } else {
                            // Queue it
                            iceCandidatesQueue.current.push(candidate);
                        }
                    }
                });

                // If initiator, create offer
                if (isInitiator) {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit("signal", { toUserId: remoteUserId, signal: { type: "offer", offer } });
                }

            } catch (err) {
                console.error("Error accessing media devices or setting up WebRTC:", err);
                setError("Failed to initialize call.");
            }
        }

        // Debounce call start to prevent double-firing in Strict Mode
        startupTimer = setTimeout(startCall, 100);

        return () => {
            clearTimeout(startupTimer);
            // Cleanup
            if (localStream.current) {
                localStream.current.getTracks().forEach((track) => track.stop());
            }
            if (peerConnection.current) {
                peerConnection.current.close();
            }
            socket.off("signal");
        };
    }, [socket, remoteUserId, isInitiator]);

    const toggleMute = () => {
        if (localStream.current) {
            localStream.current.getAudioTracks().forEach(track => track.enabled = !track.enabled);
            setIsMuted(!isMuted);
        }
    };

    const toggleVideo = () => {
        if (localStream.current) {
            localStream.current.getVideoTracks().forEach(track => track.enabled = !track.enabled);
            setIsVideoOff(!isVideoOff);
        }
    };

    const [showSidebar, setShowSidebar] = useState(false);
    const [currentTime, setCurrentTime] = useState("");

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Helper to get remote user initials
    // This assumes we might have remote user data passed in via currentUser context or we infer it
    // For now we'll use a placeholder or generic "U" if not available
    const remoteInitials = "U";

    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [showBio, setShowBio] = useState(false);
    const screenStreamRef = useRef<MediaStream | null>(null);

    const stopScreenShare = async () => {
        try {
            // Stop screen share tracks
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => track.stop());
                screenStreamRef.current = null;
            }

            // Revert to camera if available
            if (peerConnection.current) {
                const sender = peerConnection.current.getSenders().find(s => s.track?.kind === 'video');

                // Check if we have a valid video track to revert to
                const videoTracks = localStream.current?.getVideoTracks() || [];
                const hasValidVideoTrack = videoTracks.length > 0 && videoTracks[0].readyState === 'live';

                if (sender) {
                    if (hasValidVideoTrack) {
                        // Revert to camera track
                        await sender.replaceTrack(videoTracks[0]);
                        if (localVideoRef.current && localStream.current) {
                            localVideoRef.current.srcObject = localStream.current;
                        }
                    } else {
                        // No camera available, stop sending video
                        await sender.replaceTrack(null);
                        console.log("No camera available to revert to, stopping video transmission");
                    }
                }
            }

            setIsScreenSharing(false);
        } catch (err) {
            console.error("Error stopping screen share:", err);
            setIsScreenSharing(false); // Ensure state is updated even on error
        }
    };

    const startScreenShare = async () => {
        try {
            if (isScreenSharing) {
                await stopScreenShare();
            } else {
                // Start screen share
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                screenStreamRef.current = stream;

                const screenTrack = stream.getVideoTracks()[0];

                screenTrack.onended = () => {
                    // Handle user clicking "Stop Sharing" in browser UI
                    stopScreenShare();
                };

                if (peerConnection.current) {
                    const sender = peerConnection.current.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        await sender.replaceTrack(screenTrack);
                    }
                }

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                setIsScreenSharing(true);
            }
        } catch (err) {
            console.error("Error toggling screen share:", err);
            // Don't show error if user cancelled (NotAllowedError)
            if (err instanceof Error && err.name !== 'NotAllowedError') {
                toast.error("Failed to share screen");
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col text-white overflow-hidden font-sans">
            {/* Main Content Area */}
            <div className="flex-1 flex gap-4 p-4 overflow-hidden relative">

                {/* Video Grid Area */}
                <div className={`flex-1 flex items-center justify-center transition-all duration-300 ${showSidebar ? 'mr-0' : ''}`}>
                    <div className="relative w-full h-full flex items-center justify-center bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
                        {/* Remote Video (Main) */}
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-contain"
                        />

                        {/* Remote User Name Label */}
                        <div className="absolute bottom-4 left-4 flex items-center gap-2 z-10">
                            <button
                                onClick={() => setShowBio(!showBio)}
                                className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-black/60 transition-colors cursor-pointer"
                            >
                                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span>{remoteUser?.name || "Remote User"}</span>
                                <span className="text-xs text-zinc-400 ml-1">(Click for info)</span>
                            </button>

                            {/* Bio Popover */}
                            {showBio && remoteUser && (
                                <div className="absolute bottom-12 left-0 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-200">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700 overflow-hidden">
                                            {remoteUser.image ? (
                                                <img src={remoteUser.image} alt={remoteUser.name} className="h-full w-full object-cover" />
                                            ) : (
                                                <span className="text-lg font-bold">{remoteUser.name.slice(0, 1).toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-sm">{remoteUser.name}</h4>
                                            <p className="text-xs text-emerald-400">{remoteUser.industry || "Professional"}</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-zinc-300 leading-relaxed mb-3">
                                        {remoteUser.bio || "No bio available."}
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {remoteUser.skills?.slice(0, 3).map((skill: string, i: number) => (
                                            <span key={i} className="text-[10px] bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded-full text-zinc-300">
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Local Video (PiP) */}
                        <div className="absolute bottom-4 right-4 w-60 aspect-video bg-zinc-800 rounded-xl overflow-hidden border border-zinc-700 shadow-xl ring-1 ring-black/20 group hover:scale-[1.02] transition-transform cursor-move">
                            <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
                            />
                            {isVideoOff && (
                                <div className="absolute inset-0 flex items-center justify-center bg-zinc-800 text-zinc-400">
                                    <div className="h-12 w-12 rounded-full bg-zinc-700 flex items-center justify-center text-lg font-bold">
                                        {currentUser?.name?.slice(0, 2).toUpperCase() || "ME"}
                                    </div>
                                </div>
                            )}
                            <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded textxs font-medium text-white/90">
                                You
                            </div>
                        </div>

                        {/* Error Overlay */}
                        {error && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
                                <div className="bg-zinc-900 p-6 rounded-2xl border border-red-900/50 max-w-sm text-center">
                                    <div className="text-red-500 mb-2 font-semibold">Connection Error</div>
                                    <p className="text-zinc-400 text-sm mb-4">{error}</p>
                                    <Button variant="outline" size="sm" onClick={onEndCall} className="border-zinc-700 hover:bg-zinc-800">
                                        Close Call
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar (Google Meet Style) */}
                <div
                    className={`fixed right-4 top-4 bottom-24 w-80 bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${showSidebar ? 'translate-x-0' : 'translate-x-[120%]'}`}
                >
                    <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                        <h3 className="font-semibold text-lg">People</h3>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-zinc-800" onClick={() => setShowSidebar(false)}>
                            <span className="sr-only">Close</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                        </Button>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold ring-2 ring-zinc-900">
                                    {currentUser?.name?.slice(0, 1).toUpperCase()}
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium">{currentUser?.name || "You"} (You)</div>
                                    <div className="text-xs text-zinc-500">Meeting Host</div>
                                </div>
                                <div className="flex gap-1">
                                    <Mic className={`h-4 w-4 ${isMuted ? 'text-red-500' : 'text-zinc-400'}`} />
                                    <Video className={`h-4 w-4 ${isVideoOff ? 'text-red-500' : 'text-zinc-400'}`} />
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold ring-2 ring-zinc-900">
                                    {remoteUser?.name?.slice(0, 1).toUpperCase() || "U"}
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-medium">{remoteUser?.name || "Remote User"}</div>
                                    <div className="text-xs text-zinc-500">Participant</div>
                                </div>
                                <div className="flex gap-1">
                                    <Mic className="h-4 w-4 text-zinc-400" />
                                    <Video className="h-4 w-4 text-zinc-400" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Control Bar */}
            <div className="h-20 bg-zinc-950 flex items-center justify-between px-6 border-t border-zinc-900/50">

                {/* Left: Meeting Info */}
                <div className="flex items-center gap-4 min-w-[200px]">
                    <div className="text-zinc-300 font-medium text-sm flex items-center gap-2">
                        <span>{currentTime}</span>
                        <span className="w-px h-4 bg-zinc-700"></span>
                        <span>yari-connect-call</span>
                    </div>
                </div>

                {/* Center: Controls */}
                <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        size="icon"
                        className={`h-12 w-12 rounded-full transition-all duration-200 border border-zinc-700 ${isMuted ? 'bg-red-500 hover:bg-red-600 border-red-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-white'}`}
                        onClick={toggleMute}
                    >
                        {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </Button>

                    <Button
                        variant="secondary"
                        size="icon"
                        className={`h-12 w-12 rounded-full transition-all duration-200 border border-zinc-700 ${isVideoOff ? 'bg-red-500 hover:bg-red-600 border-red-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-white'}`}
                        onClick={toggleVideo}
                    >
                        {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                    </Button>

                    <Button
                        variant={isScreenSharing ? "destructive" : "secondary"}
                        size="icon"
                        className={`h-12 w-12 rounded-full transition-all duration-200 border border-zinc-700 ${isScreenSharing ? 'bg-green-600 hover:bg-green-700 border-green-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-white'}`}
                        onClick={startScreenShare}
                    >
                        {isScreenSharing ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><line x1="9" x2="15" y1="15" y2="9" /><line x1="15" x2="9" y1="15" y2="9" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3" /><path d="M8 21h8" /><path d="M12 17v4" /><path d="m17 8 5-5" /><path d="M17 3h5v5" /></svg>
                        )}
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-12 w-12 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white"
                        onClick={() => { /* Placeholder for more options */ }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                    </Button>

                    <Button
                        variant="destructive"
                        size="icon"
                        className="h-12 w-16 px-8 rounded-full bg-red-600 hover:bg-red-700 text-white ml-2 transition-transform active:scale-95"
                        onClick={onEndCall}
                    >
                        <PhoneOff className="h-6 w-6" />
                    </Button>
                </div>

                {/* Right: Sidebar Toggles */}
                <div className="flex items-center justify-end gap-3 min-w-[200px]">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`h-10 w-10 rounded-full hover:bg-zinc-800 ${showSidebar ? 'text-emerald-500 bg-zinc-800' : 'text-zinc-400'}`}
                        onClick={() => setShowSidebar(!showSidebar)}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 rounded-full hover:bg-zinc-800 text-zinc-400"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    </Button>
                </div>
            </div>
        </div>
    );
}
