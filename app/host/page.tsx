"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "../lib/socket";
import SimplePeer from "simple-peer";
import { storage } from "../../lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

type Client = {
    id: string;
    name: string;
    status: "waiting" | "connected";
    muted: boolean;
};

export default function HostPage() {
    const [isLive, setIsLive] = useState(false);
    const [clients, setClients] = useState<Client[]>([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const peersRef = useRef<Map<string, SimplePeer>>(new Map());
    const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const hostStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        socket.connect();
        socket.emit("register-host");

        socket.on("state-update", (state) => {
            setIsLive(state.isLive);
            setClients(state.clients);
        });

        socket.on("dial-in", ({ clientId, offer, name }) => {
            console.log("Client dialing in:", name, clientId);
            const peer = new SimplePeer({
                initiator: false,
                trickle: false,
            });

            peer.on("signal", (answer) => {
                socket.emit("answer", { clientId, answer });
            });

            peer.on("stream", (stream) => {
                console.log("Received stream from", clientId);
                handleIncomingAudio(clientId, stream);
            });

            peer.signal(offer);
            peersRef.current.set(clientId, peer);
        });

        socket.on("ice-candidate", ({ source, candidate }) => {
            const peer = peersRef.current.get(source);
            if (peer) peer.signal(candidate);
        });

        return () => {
            socket.disconnect();
            peersRef.current.forEach(p => p.destroy());
        };
    }, []);

    const handleIncomingAudio = (clientId: string, stream: MediaStream) => {
        // 1. Play locally via hidden audio tag (or AudioContext directly)
        // 2. Route to Recording Destination

        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            destinationRef.current = audioContextRef.current.createMediaStreamDestination();
        }

        const ctx = audioContextRef.current;
        const dest = destinationRef.current;

        const source = ctx.createMediaStreamSource(stream);
        // Connect to destination (recording)
        if (dest) source.connect(dest);
        // Connect to local output (hearing them)
        source.connect(ctx.destination);
    };

    const toggleLive = () => {
        if (isLive) {
            socket.emit("go-offline");
            stopRecording();
        } else {
            socket.emit("go-live");
            startRecording();
        }
    };

    const startRecording = async () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            destinationRef.current = audioContextRef.current.createMediaStreamDestination();
        }

        const ctx = audioContextRef.current;
        // Ensure context is running (sometimes it suspends requires user gesture resume)
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }

        const dest = destinationRef.current;
        if (!dest) return;

        // Capture Host Audio
        try {
            const hostStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            hostStreamRef.current = hostStream; // Keep persistent ref

            // Add to recording but NOT to speakers (avoid feedback)
            const hostSource = ctx.createMediaStreamSource(hostStream);
            hostSource.connect(dest);
        } catch (err) {
            console.error("Failed to capture host audio:", err);
            alert("Could not access microphone for host audio recording.");
        }

        const recorder = new MediaRecorder(dest.stream, {
            mimeType: 'audio/webm;codecs=opus',
        });

        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
            const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
            const filename = `recording-${Date.now()}.webm`;

            setIsUploading(true);
            setUploadProgress(0);

            try {
                const storageRef = ref(storage, `raw-recordings/${filename}`);
                const uploadTask = uploadBytesResumable(storageRef, blob, {
                    contentType: 'audio/webm'
                });

                uploadTask.on('state_changed',
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        setUploadProgress(progress);
                        console.log('Upload is ' + progress + '% done');
                    },
                    (error) => {
                        console.error("Upload failed", error);
                        alert("Upload failed: " + error.message);
                        setIsUploading(false);
                    },
                    () => {
                        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                            console.log('File available at', downloadURL);
                            alert("Upload Complete! Cloud processing will begin shortly.");
                            setIsUploading(false);
                        });
                    }
                );
            } catch (err) {
                console.error("Error starting upload:", err);
                setIsUploading(false);
            }

            // Cleanup host stream
            if (hostStreamRef.current) {
                hostStreamRef.current.getTracks().forEach(t => t.stop());
                hostStreamRef.current = null;
            }
        };

        recorder.start();
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        // Cleanup host stream microphone access
        if (hostStreamRef.current) {
            hostStreamRef.current.getTracks().forEach(t => t.stop());
            hostStreamRef.current = null;
        }
    };

    const toggleMute = (clientId: string, currentMute: boolean) => {
        socket.emit("toggle-mute", { clientId, muted: !currentMute });
    };

    const kickClient = (clientId: string) => {
        if (confirm("Are you sure you want to kick this client?")) {
            socket.emit("kick-client", { clientId });
        }
    };

    return (
        <div className="min-h-screen p-8 font-sans bg-gray-900 text-white">
            <header className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold">Host Dashboard</h1>
                <div className="flex gap-4 items-center">
                    {isUploading && (
                        <div className="text-yellow-400 font-bold animate-pulse">
                            Uploading... {Math.round(uploadProgress)}%
                        </div>
                    )}
                    <div className={`px-4 py-2 rounded-full font-bold ${isLive ? 'bg-red-600 animate-pulse' : 'bg-gray-600'}`}>
                        {isLive ? "LIVE RECORDING" : "OFFLINE"}
                    </div>
                </div>
            </header>

            <main className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section className="bg-gray-800 p-6 rounded-lg">
                    <h2 className="text-xl mb-4 text-gray-400">Controls</h2>
                    <button
                        onClick={toggleLive}
                        className={`w-full py-4 rounded font-bold text-xl transition ${isLive ? 'bg-gray-700 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-500'}`}
                    >
                        {isLive ? "End Broadcast" : "GO LIVE"}
                    </button>
                </section>

                <section className="bg-gray-800 p-6 rounded-lg">
                    <h2 className="text-xl mb-4 text-gray-400">Clients ({clients.length})</h2>
                    <div className="space-y-4">
                        {clients.map(client => (
                            <div key={client.id} className="flex items-center justify-between bg-gray-700 p-4 rounded">
                                <div>
                                    <p className="font-bold text-lg">{client.name}</p>
                                    <p className="text-sm text-gray-400 capitalize">{client.status}</p>
                                </div>
                                {client.status === 'connected' && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => toggleMute(client.id, client.muted)}
                                            className={`px-4 py-2 rounded font-bold ${client.muted ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}
                                        >
                                            {client.muted ? "MUTED" : "ON AIR"}
                                        </button>
                                        <button
                                            onClick={() => kickClient(client.id)}
                                            className="px-4 py-2 rounded font-bold bg-gray-600 hover:bg-red-600 text-white transition-colors"
                                            title="Kick Client"
                                        >
                                            ❌
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {clients.length === 0 && <p className="text-gray-500">No clients waiting.</p>}
                    </div>
                </section>
            </main>
        </div>
    );
}
