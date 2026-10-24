// MAYAwe Nexus: Distributed Spatial Broker & Unified HTTPS/WSS Server
const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { getOrCreateCert, getPrimaryLanIp, getAllIpv4Addresses } = require('./generate_cert');

const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
const HTTP_PORT = process.env.HTTP_PORT || 8080;

const app = express();
app.use(express.json({ limit: '15mb' }));

// Paths to web assets
const IMAGER_DIR = path.resolve(__dirname, '..', 'imager', 'web-client');
const DASHBOARD_DIR = path.resolve(__dirname, 'public');

// Static file serving
app.use('/imager', express.static(IMAGER_DIR));
app.use('/dashboard', express.static(DASHBOARD_DIR));

// Redirect root to dashboard
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// Health & Status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        connectedClients: clients.size,
        state: spatialState
    });
});

// Load / Generate TLS Certificate
const { cert, key, cached } = getOrCreateCert(__dirname);
const httpsServer = https.createServer({ cert, key }, app);
const httpServer = http.createServer(app);

// WebSocket Servers attached to HTTPS (wss) and HTTP (ws)
const wssSecure = new WebSocket.Server({ server: httpsServer });
const wssInsecure = new WebSocket.Server({ server: httpServer });

// Unified Spatial State Store
const spatialState = {
    devices: {},          // deviceId -> { quaternion, rotation, acceleration, lastSeen, fps }
    handTracking: null,   // { landmarks: [...21 points], handedness: "Right"|"Left" }
    petState: {
        position: { x: 0, y: 0, z: -1.5 },
        targetPosition: { x: 0, y: 0, z: -1.5 },
        mode: 'IDLE',     // 'IDLE' | 'WALK' | 'JUMP' | 'WAVE' | 'APPROACH' | 'STAY'
        speechText: 'MAYAwe spatial link active. Ready for commands!',
        speechTimestamp: Date.now()
    },
    activeGesture: 'NONE', // 'OPEN_PALM' | 'INDEX_POINT' | 'PINCH' | 'FIST' | 'WAVE' | 'NONE'
    environmentObjects: [],
    latestKeyframe: null,
    metrics: {
        telemetryPacketsCount: 0,
        telemetryFps: 0,
        spatialStatePacketsCount: 0,
        keyframePacketsCount: 0
    }
};

// Connected client management
const clients = new Map(); // ws -> { id, role: 'imager' | 'aether' | 'dashboard' | 'unknown', ip, connectedAt }

// Calculate live FPS for telemetry
let telemetryCountWindow = 0;
setInterval(() => {
    spatialState.metrics.telemetryFps = telemetryCountWindow;
    telemetryCountWindow = 0;
}, 1000);

function handleConnection(ws, req, protocolName) {
    const clientIp = req.socket.remoteAddress || 'unknown';
    const clientId = `client_${Math.random().toString(36).substr(2, 9)}`;

    clients.set(ws, {
        id: clientId,
        role: 'unknown',
        ip: clientIp,
        protocol: protocolName,
        connectedAt: Date.now()
    });

    console.log(`[Nexus WS] ${protocolName} client connected: ${clientId} (${clientIp})`);

    // Send initial spatial state snapshot to new client
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'spatial_state_snapshot',
            state: spatialState
        }));
    }

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            const clientInfo = clients.get(ws) || {};

            // Auto-detect or explicit role assignment
            if (packet.role && clientInfo.role !== packet.role) {
                clientInfo.role = packet.role;
            }

            switch (packet.type) {
                case 'register': {
                    clientInfo.role = packet.role || clientInfo.role;
                    if (packet.deviceId) clientInfo.deviceId = packet.deviceId;
                    console.log(`[Nexus WS] Client ${clientInfo.id} registered as role: ${clientInfo.role}`);
                    break;
                }

                case 'telemetry': {
                    // Origin: Phone (imager)
                    clientInfo.role = 'imager';
                    const deviceId = packet.deviceId || clientInfo.deviceId || 'mobile_imager';
                    clientInfo.deviceId = deviceId;

                    telemetryCountWindow++;
                    spatialState.metrics.telemetryPacketsCount++;

                    // Update device tracking state
                    spatialState.devices[deviceId] = {
                        deviceId: deviceId,
                        lastSeen: Date.now(),
                        rotation: packet.data?.rotation || { alpha: 0, beta: 0, gamma: 0 },
                        quaternion: packet.data?.quaternion || { qx: 0, qy: 0, qz: 0, qw: 1 },
                        acceleration: packet.data?.acceleration || { x: 0, y: 0, z: 0 },
                        interval: packet.data?.interval || 16.67
                    };

                    // Broadcast high-frequency telemetry to aether and dashboard nodes
                    broadcastToRoles(['aether', 'dashboard'], message.toString(), ws);
                    break;
                }

                case 'camera_keyframe': {
                    // Low-frequency keyframe (0.5 Hz) from phone
                    clientInfo.role = 'imager';
                    spatialState.metrics.keyframePacketsCount++;
                    spatialState.latestKeyframe = {
                        deviceId: packet.deviceId,
                        timestamp: packet.timestamp || Date.now(),
                        jpegBase64: packet.jpegBase64
                    };

                    // Forward keyframe to aether (for Gemini / contour detection) & dashboard
                    broadcastToRoles(['aether', 'dashboard'], message.toString(), ws);
                    break;
                }

                case 'spatial_state': {
                    // Origin: Aether AI / Vision engine
                    clientInfo.role = 'aether';
                    spatialState.metrics.spatialStatePacketsCount++;

                    if (packet.handPose !== undefined) {
                        spatialState.handTracking = packet.handPose;
                    }
                    if (packet.gesture !== undefined) {
                        spatialState.activeGesture = packet.gesture;
                    }
                    if (packet.petState !== undefined) {
                        spatialState.petState = {
                            ...spatialState.petState,
                            ...packet.petState
                        };
                    }
                    if (packet.speech) {
                        spatialState.petState.speechText = packet.speech;
                        spatialState.petState.speechTimestamp = Date.now();
                    }
                    if (packet.environmentObjects) {
                        spatialState.environmentObjects = packet.environmentObjects;
                    }

                    // Broadcast spatial state back to imager (for AR render) and dashboard (for debug 3D)
                    broadcastToRoles(['imager', 'dashboard', 'unknown'], message.toString(), ws);
                    break;
                }

                case 'dashboard_command': {
                    // Command from dashboard (e.g. waypoint click, reset, gesture trigger)
                    if (packet.petState) {
                        spatialState.petState = { ...spatialState.petState, ...packet.petState };
                    }
                    broadcastToRoles(['imager', 'aether'], JSON.stringify({
                        type: 'spatial_state',
                        gesture: packet.gesture || spatialState.activeGesture,
                        petState: spatialState.petState,
                        speech: packet.speech || spatialState.petState.speechText
                    }));
                    break;
                }

                default:
                    // Generic broadcast
                    broadcastToRoles(['imager', 'aether', 'dashboard'], message.toString(), ws);
                    break;
            }
        } catch (err) {
            console.error('[Nexus WS] Error handling message:', err.message);
        }
    });

    ws.on('close', () => {
        const info = clients.get(ws);
        console.log(`[Nexus WS] Client disconnected: ${info?.id} (${info?.role})`);
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.warn(`[Nexus WS] Socket error: ${err.message}`);
    });
}

function broadcastToRoles(targetRoles, messageStr, senderWs = null) {
    clients.forEach((info, clientWs) => {
        if (clientWs !== senderWs && clientWs.readyState === WebSocket.OPEN) {
            if (targetRoles.includes(info.role) || info.role === 'unknown') {
                clientWs.send(messageStr);
            }
        }
    });
}

// Bind connections
wssSecure.on('connection', (ws, req) => handleConnection(ws, req, 'WSS'));
wssInsecure.on('connection', (ws, req) => handleConnection(ws, req, 'WS'));

// Start servers
const lanIp = getPrimaryLanIp();
const allIps = getAllIpv4Addresses();

httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log('\n================================================================');
        console.log('            MAYAwe Nexus Distributed Spatial Engine              ');
        console.log('================================================================');
        console.log(`[*] TLS Certificate: ${cached ? 'Cached (cert.pem)' : 'Newly Generated'}`);
        console.log(`[*] PC LAN IP:       ${lanIp}`);
        console.log(`[*] All Local IPs:   ${allIps.join(', ')}`);
        console.log('----------------------------------------------------------------');
        console.log(`>>> MOBILE AR CLIENT (Open on Phone over Wi-Fi):`);
        console.log(`    https://${lanIp}:${HTTPS_PORT}/imager`);
        console.log('----------------------------------------------------------------');
        console.log(`>>> PC 3D SPATIAL DASHBOARD (Open on Laptop):`);
        console.log(`    https://localhost:${HTTPS_PORT}/dashboard`);
        console.log(`    or https://${lanIp}:${HTTPS_PORT}/dashboard`);
        console.log('----------------------------------------------------------------');
        console.log(`[*] Secure WSS:      wss://0.0.0.0:${HTTPS_PORT}`);
        console.log(`[*] Insecure WS:     ws://0.0.0.0:${HTTP_PORT} (Local testing fallback)`);
        console.log('================================================================\n');
    });
});
