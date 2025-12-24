"use client";

import { io } from "socket.io-client";

// Connect to the same origin (Next.js server), which proxies to port 3001
export const socket = io(undefined, {
    path: '/socket.io',
    autoConnect: false,
});
