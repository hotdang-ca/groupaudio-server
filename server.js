const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const state = require("./state");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const httpServer = createServer(async (req, res) => {
        try {
            // Be sure to pass `true` as the second argument to `url.parse`.
            // This tells it to parse the query portion of the URL.
            const parsedUrl = parse(req.url, true);
            const { pathname, query } = parsedUrl;

            if (pathname === "/a") {
                await app.render(req, res, "/a", query);
            } else if (pathname === "/b") {
                await app.render(req, res, "/b", query);
            } else {
                await handle(req, res, parsedUrl);
            }
        } catch (err) {
            console.error("Error occurred handling", req.url, err);
            res.statusCode = 500;
            res.end("internal server error");
        }
    });

    const io = new Server(httpServer);

    io.on("connection", (socket) => {
        console.log('User connected:', socket.id);

        // Send initial state
        socket.emit('state-update', state.getState());

        // REGISTER
        socket.on('register-host', () => {
            state.setHost(socket.id);
            console.log('Host registered:', socket.id);
            io.emit('state-update', state.getState());
        });

        socket.on('register-client', ({ name }) => {
            state.addClient(socket.id, name);
            console.log('Client registered:', name, socket.id);
            // Notify host specifically or just broadcast state
            io.emit('state-update', state.getState());
        });

        // HOST CONTROLS
        socket.on('go-live', () => {
            if (state.hostSocketId !== socket.id) return;
            state.setLive(true);
            io.emit('state-update', state.getState());
            io.emit('status-change', { isLive: true });
        });

        socket.on('go-offline', () => {
            if (state.hostSocketId !== socket.id) return;
            state.setLive(false);
            io.emit('state-update', state.getState());
            io.emit('status-change', { isLive: false });
        });

        // SIGNALING
        // Client initiates 'dial-in' -> sends offer to Host
        socket.on('dial-in', ({ offer }) => {
            // Forward to Host
            if (state.hostSocketId && state.isLive) {
                state.updateClientStatus(socket.id, 'connected'); // Optimistic
                io.to(state.hostSocketId).emit('dial-in', {
                    clientId: socket.id,
                    offer,
                    name: state.getClient(socket.id)?.name
                });
                io.emit('state-update', state.getState());
            }
        });

        socket.on('answer', ({ clientId, answer }) => {
            // Host answers Client
            io.to(clientId).emit('answer', { answer });
        });

        socket.on('ice-candidate', ({ target, candidate }) => {
            let targetId = target;
            if (target === 'host') {
                targetId = state.hostSocketId;
            }
            if (targetId) {
                io.to(targetId).emit('ice-candidate', { source: socket.id, candidate });
            }
        });

        socket.on('client-hangup', () => {
            const client = state.getClient(socket.id);
            if (client) {
                console.log('Client hung up:', client.name);
                state.updateClientStatus(socket.id, 'waiting');
                client.muted = true; // Reset mute state
                io.emit('state-update', state.getState());
            }
        });

        // HOST MUTE & KICK CONTROLS
        socket.on('toggle-mute', ({ clientId, muted }) => {
            if (state.hostSocketId !== socket.id) return;
            const client = state.getClient(clientId);
            if (client) {
                client.muted = muted;
                // Notify client to mute/unmute their track
                io.to(clientId).emit('mute-command', { muted });
                io.emit('state-update', state.getState());
            }
        });

        socket.on('kick-client', ({ clientId }) => {
            if (state.hostSocketId !== socket.id) return;

            // Notify client they are being kicked
            io.to(clientId).emit('force-disconnect', { reason: 'host-kick' });

            // Remove from state immediately
            state.removeClient(clientId);

            io.emit('state-update', state.getState());
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
            if (socket.id === state.hostSocketId) {
                state.removeHost();
            } else {
                state.removeClient(socket.id);
            }
            io.emit('state-update', state.getState());
        });
    });

    httpServer
        .once("error", (err) => {
            console.error(err);
            process.exit(1);
        })
        .listen(port, () => {
            console.log(`> Ready on http://${hostname}:${port}`);
        });
});
