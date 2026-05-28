// MAYAwe Imager: Streaming Logic
// This file handles the WebSocket connection to the Nexus/Aether.

let socket = null;
const deviceId = `device_${Math.random().toString(36).substr(2, 9)}`;

console.log("MAYAwe Streaming initialized.");

function connectToNexus(url) {
    console.log(`Connecting to Nexus at ${url}...`);
    socket = new WebSocket(url);

    socket.onopen = () => {
        console.log("Connected to Nexus.");
    };

    socket.onclose = () => {
        console.warn("Disconnected from Nexus. Retrying in 5s...");
        setTimeout(() => connectToNexus(url), 5000);
    };

    socket.onerror = (error) => {
        console.error("WebSocket Error:", error);
    };
}

function sendTelemetry(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const packet = {
            type: "telemetry",
            deviceId: deviceId,
            timestamp: Date.now(),
            data: data
        };
        socket.send(JSON.stringify(packet));
    }
}
