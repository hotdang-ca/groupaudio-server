"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "../lib/socket";
import SimplePeer from "simple-peer";

type ConnectionStatus = "idle" | "waiting_for_host" | "dialing" | "connected";

export default function ClientPage() {
    const [name, setName] = useState("");
    const [isRegistered, setIsRegistered] = useState(false);
    const [hostLive, setHostLive] = useState(false);
    const [status, setStatus] = useState<ConnectionStatus>("idle");
    const [mutedByHost, setMutedByHost] = useState(true);
    const [cooldown, setCooldown] = useState(0);

    const peerRef = useRef<SimplePeer | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const handleHangup = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        socket.emit("client-hangup");
        setStatus("waiting_for_host");
        setMutedByHost(true);
    };

    useEffect(() => {
        const savedName = localStorage.getItem("clientName");
        if (savedName) {
            setName(savedName);
            setIsRegistered(true); // If we have a name stored, assume we want to be registered/entered view
            setStatus("waiting_for_host");
        }

        socket.connect();

        socket.on("connect", () => {
            console.log("Socket connected");
            // If we have a name (from state or connection restore), register again
            const currentName = localStorage.getItem("clientName"); // Use localStorage as truth
            if (currentName) {
                // We don't want to override 'isRegistered' state blindly, but if the socket reconnected
                // the server forgot us. So we must re-register.
                // However, we only do this if we were already 'entered'.
                // The 'name' state might be empty on initial load before effect runs, 
                // but this listener is attached inside the effect.
                socket.emit("register-client", { name: currentName });
            }
        });

        socket.on("state-update", (state) => {
            setHostLive(state.isLive);
        });

        socket.on("answer", ({ answer }) => {
            peerRef.current?.signal(answer);
        });

        socket.on("ice-candidate", ({ candidate }) => {
            peerRef.current?.signal(candidate);
        });

        socket.on("mute-command", ({ muted }) => {
            setMutedByHost(muted);
            if (streamRef.current) {
                streamRef.current.getAudioTracks().forEach(track => {
                    track.enabled = !muted;
                });
            }
        });

        socket.on("force-disconnect", () => {
            handleHangup();
            setCooldown(30);
        });

        return () => {
            socket.disconnect();
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
            }
            peerRef.current?.destroy();
        };
    }, []); // eslint-disable-next-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (cooldown > 0) {
            const timer = setInterval(() => setCooldown(c => c - 1), 1000);
            return () => clearInterval(timer);
        }
    }, [cooldown]);

    const register = () => {
        if (!name) return;
        localStorage.setItem("clientName", name);
        socket.emit("register-client", { name });
        setIsRegistered(true);
        setStatus("waiting_for_host");
    };

    const dialIn = async () => {
        setStatus("dialing");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            streamRef.current = stream;
            stream.getAudioTracks().forEach(t => t.enabled = false);

            const peer = new SimplePeer({
                initiator: true,
                trickle: false,
                stream: stream,
            });

            peer.on("signal", (offer) => {
                socket.emit("dial-in", { offer });
            });

            peer.on("connect", () => {
                setStatus("connected");
            });

            peerRef.current = peer;

        } catch (err) {
            console.error("Failed to get media", err);
            setStatus("waiting_for_host");
            alert("Could not access microphone.");
        }
    };

    if (!isRegistered) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
                <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
                    <h1 className="text-2xl font-bold mb-6">Join Audio Platform</h1>
                    <input
                        type="text"
                        placeholder="Enter your name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full p-3 rounded bg-gray-700 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={register}
                        className="w-full bg-blue-600 py-3 rounded font-bold hover:bg-blue-500 transition"
                    >
                        enter
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen p-8 bg-gray-900 text-white flex flex-col items-center">
            <header className="w-full max-w-md mb-12 flex justify-between items-center">
                <h1 className="text-xl font-bold">Client: <span className="text-blue-400">{name}</span></h1>
                <div className={`px-3 py-1 rounded text-sm ${hostLive ? 'bg-green-600' : 'bg-gray-600'}`}>
                    {hostLive ? "HOST LIVE" : "HOST OFFLINE"}
                </div>
            </header>

            <main className="w-full max-w-md bg-gray-800 p-8 rounded-lg text-center">

                {status === "waiting_for_host" && (
                    <div>
                        <p className="mb-6 text-gray-300">
                            {cooldown > 0
                                ? `You were disconnected. Please wait ${cooldown}s.`
                                : hostLive ? "The line is open. You can dial in." : "Please wait for the host to go live."}
                        </p>
                        <button
                            onClick={dialIn}
                            disabled={!hostLive || cooldown > 0}
                            className={`w-full py-4 rounded font-bold text-lg transition ${hostLive && cooldown === 0
                                ? 'bg-green-600 hover:bg-green-500 text-white'
                                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                        >
                            {cooldown > 0 ? `Wait ${cooldown}s` : "📞 DIAL IN"}
                        </button>
                    </div>
                )}

                {status === "dialing" && (
                    <div className="animate-pulse">
                        <p className="text-xl font-bold text-yellow-500">Connecting...</p>
                    </div>
                )}

                {status === "connected" && (
                    <div>
                        <div className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center mb-6 transition-colors ${mutedByHost ? 'bg-red-500/20' : 'bg-green-500/20 shadow-lg shadow-green-500/50'}`}>
                            <span className="text-4xl">{mutedByHost ? '🔇' : '🎙️'}</span>
                        </div>
                        <h2 className="text-2xl font-bold mb-2">
                            {mutedByHost ? "YOU ARE MUTED" : "YOU ARE LIVE"}
                        </h2>
                        <div className="flex flex-col gap-4 mt-8">
                            <button
                                onClick={handleHangup}
                                className="px-6 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white font-bold"
                            >
                                HANG UP
                            </button>
                        </div>
                    </div>
                )}

            </main>
        </div>
    );
}
