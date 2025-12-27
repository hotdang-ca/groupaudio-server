# Ionized Crater: Web & Server

This directory contains the Next.js application that serves two purposes:
1.  **Frontend**: The Host Dashboard and Web Client UI.
2.  **Signaling Server**: A Custom Node.js server (integrated with Next.js) that manages WebRTC signaling via Socket.io.

## Prerequisites

*   Node.js 18+
*   npm

## Getting Started

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Run Development Server**:
    ```bash
    npm run dev
    ```

    This starts the server on `http://localhost:3000`.

## Usage

### Host Mode
Navigate to `/host`.
*   Click **"GO LIVE"** to open the room.
*   Allow microphone access to enable recording mix-in.
*   Manage clients (Mute/Kick) from the dashboard.
*   Recording is saved locally as a `.webm` file when you go offline.

### Client Mode
Navigate to `/client`.
*   Enter your name.
*   Wait for the Host to go live.
*   Click **"DIAL IN"** to connect via WebRTC.

## HTTPS / Mobile Access (Tunneling)

To access this from a mobile device (for microphone permissions), you need HTTPS. We recommend `ngrok`:

```bash
ngrok http 3000
```
Use the provided `https://...` URL on your mobile device. The app is configured to automatically use the current hostname for socket connections.
