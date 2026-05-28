// MAYAwe Nexus: Lightweight Receiver & Hub Server
const WebSocket = require('ws');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`MAYAwe Nexus started on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
    console.log('New Node connected.');

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            
            // Log telemetry for debugging
            if (packet.type === 'telemetry') {
                const { alpha, beta, gamma } = packet.data.rotation;
                // console.log(`[${packet.deviceId}] Pose: A=${alpha.toFixed(1)}, B=${beta.toFixed(1)}, G=${gamma.toFixed(1)}`);
            }

            // BROADCAST: Send the packet to all OTHER connected clients (Subscribers like Aether)
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(message.toString());
                }
            });

        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Node disconnected.');
    });
});
