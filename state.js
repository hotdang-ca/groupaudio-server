// state.js
class State {
    constructor() {
        this.hostSocketId = null;
        this.isLive = false;
        this.clients = new Map(); // socketId -> { name, status: 'waiting' | 'connected', muted: true }
    }

    setHost(socketId) {
        this.hostSocketId = socketId;
    }

    removeHost() {
        this.hostSocketId = null;
        this.isLive = false;
        // Potentially disconnect all clients or reset their status
        this.clients.forEach(c => c.status = 'waiting');
    }

    addClient(socketId, name) {
        this.clients.set(socketId, { name, status: 'waiting', muted: true });
    }

    removeClient(socketId) {
        this.clients.delete(socketId);
    }

    getClient(socketId) {
        return this.clients.get(socketId);
    }

    updateClientStatus(socketId, status) {
        const client = this.clients.get(socketId);
        if (client) {
            client.status = status;
        }
    }

    setLive(live) {
        this.isLive = live;
    }

    getState() {
        return {
            isLive: this.isLive,
            hostConnected: !!this.hostSocketId,
            clients: Array.from(this.clients.entries()).map(([id, data]) => ({ id, ...data }))
        };
    }
}

module.exports = new State();
