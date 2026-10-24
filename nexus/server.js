// MAYAwe V2 Nexus: Distributed Spatial Broker & Unified HTTPS/WSS Server
const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { getOrCreateCert, getPrimaryLanIp, getAllIpv4Addresses } = require('./generate_cert');

const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
const HTTP_PORT = process.env.HTTP_PORT || 8080;

const app = express();
app.use(express.json({ limit: '25mb' }));

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
        version: '2.0.0',
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

// Unified Spatial State Store (MAYAwe V2)
const spatialState = {
    // 1. Phone 6-DoF Pose & Headset State
    phonePose6DoF: {
        position: { x: 0.0, y: 1.45, z: 0.0 }, // Head height in meters
        quaternion: { qx: 0.0, qy: 0.0, qz: 0.0, qw: 1.0 },
        euler: { alpha: 0.0, beta: 0.0, gamma: 0.0 },
        mode: 'CARDBOARD_STEREO', // 'CARDBOARD_STEREO' | 'MONOCULAR_AR'
        trackingSource: 'IMU_VIO_FALLBACK',
        lastUpdated: Date.now()
    },

    // 2. Dual-Camera Hand Tracking & Extrinsic Blending
    dualHandPose: {
        active: false,
        gesture: 'NONE',
        weights: { phone: 0.5, laptop: 0.5 },
        wristWorld: { x: 0.0, y: 1.0, z: -0.5 },
        raycastTarget: { x: 0.0, y: 0.0, z: -1.5, surfaceId: 'plane_floor_0' },
        landmarks: []
    },

    // 3. Room Surface Planes & Depth-Occlusion Proxies
    roomPlanes: [
        {
            id: 'plane_floor_0',
            class: 'FLOOR',
            semanticLabel: 'floor_carpet',
            center: { x: 0.0, y: 0.0, z: -1.5 },
            extents: { w: 5.0, d: 5.0, h: 0.02 },
            occluder: false
        },
        {
            id: 'plane_chair_1',
            class: 'CHAIR_OR_BED_SURFACE',
            semanticLabel: 'wooden_chair',
            center: { x: 0.80, y: 0.45, z: -1.60 },
            extents: { w: 0.55, d: 0.55, h: 0.45 },
            occluder: true
        },
        {
            id: 'zone_under_bed_1',
            class: 'UNDER_BED_SHADOW_ZONE',
            semanticLabel: 'under_bed_cavity',
            center: { x: -1.10, y: 0.0, z: -2.10 },
            extents: { w: 1.40, d: 1.90, h: 0.32 },
            overhangElevation: 0.35,
            occluder: true
        },
        {
            id: 'plane_desk_1',
            class: 'DESK_OR_TABLE',
            semanticLabel: 'work_desk',
            center: { x: 0.0, y: 0.75, z: -0.80 },
            extents: { w: 1.20, d: 0.70, h: 0.75 },
            occluder: true
        }
    ],

    // 4. AI Pet State Machine
    petState: {
        mode: 'IDLE_SCAN', // 'IDLE_SCAN'|'WALK_ON_SURFACE'|'CLIMB_CHAIR'|'HIDE_UNDER_BED'|'FOLLOW_USER'|'SIT_STAY'|'GREET_WAVE'
        position: { x: 0.0, y: 0.0, z: -1.5 },
        targetPosition: { x: 0.0, y: 0.0, z: -1.5 },
        targetSurfaceId: 'plane_floor_0',
        speechText: 'MAYAwe V2 ready. Exploring room geometry!',
        speechTimestamp: Date.now()
    },

    devices: {},
    latestKeyframe: null,
    metrics: {
        telemetryFps: 0,
        cvFrameFps: 0,
        worldUpdatesCount: 0
    }
};

// Connected client registry
const clients = new Map(); // ws -> { id, role: 'imager' | 'aether' | 'dashboard' | 'unknown', ip }

let telemetryCountWindow = 0;
let cvFrameCountWindow = 0;
setInterval(() => {
    spatialState.metrics.telemetryFps = telemetryCountWindow;
    spatialState.metrics.cvFrameFps = cvFrameCountWindow;
    telemetryCountWindow = 0;
    cvFrameCountWindow = 0;
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

    console.log(`[Nexus V2] ${protocolName} client connected: ${clientId} (${clientIp})`);

    // Send initial unified state snapshot
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'spatial_state_snapshot',
            version: '2.0.0',
            state: spatialState
        }));
    }

    ws.on('message', (message) => {
        try {
            const packet = JSON.parse(message);
            const clientInfo = clients.get(ws) || {};

            if (packet.role && clientInfo.role !== packet.role) {
                clientInfo.role = packet.role;
            }

            switch (packet.type) {
                case 'register': {
                    clientInfo.role = packet.role || clientInfo.role;
                    if (packet.deviceId) clientInfo.deviceId = packet.deviceId;
                    console.log(`[Nexus V2] Client ${clientInfo.id} registered as: ${clientInfo.role}`);
                    break;
                }

                // V2 60 Hz 6-DoF Telemetry from Phone
                case 'IMAGER_TELEMETRY_V2': {
                    clientInfo.role = 'imager';
                    telemetryCountWindow++;

                    if (packet.pose6DoF) {
                        spatialState.phonePose6DoF = {
                            ...spatialState.phonePose6DoF,
                            ...packet.pose6DoF,
                            mode: packet.mode || spatialState.phonePose6DoF.mode,
                            lastUpdated: Date.now()
                        };
                    }

                    // Forward to Aether (for pose tracking/scale drift) & Dashboard
                    broadcastToRoles(['aether', 'dashboard'], message.toString(), ws);
                    break;
                }

                // Backward-compatible V1 telemetry
                case 'telemetry': {
                    clientInfo.role = 'imager';
                    telemetryCountWindow++;
                    const deviceId = packet.deviceId || 'mobile_imager';
                    spatialState.devices[deviceId] = {
                        deviceId: deviceId,
                        lastSeen: Date.now(),
                        rotation: packet.data?.rotation || { alpha: 0, beta: 0, gamma: 0 },
                        quaternion: packet.data?.quaternion || { qx: 0, qy: 0, qz: 0, qw: 1 },
                        acceleration: packet.data?.acceleration || { x: 0, y: 0, z: 0 }
                    };
                    broadcastToRoles(['aether', 'dashboard'], message.toString(), ws);
                    break;
                }

                // 15 Hz CV Keyframe (640x360) from Phone for Inside-Out MediaPipe
                case 'IMAGER_CV_FRAME': {
                    cvFrameCountWindow++;
                    // Stream directly to Aether for inside-out hand tracking
                    broadcastToRoles(['aether'], message.toString(), ws);
                    break;
                }

                // 0.5 Hz High-Quality Snapshot for Cloud Gemini VLM
                case 'camera_keyframe': {
                    spatialState.latestKeyframe = {
                        deviceId: packet.deviceId,
                        timestamp: packet.timestamp || Date.now(),
                        jpegBase64: packet.jpegBase64
                    };
                    broadcastToRoles(['aether', 'dashboard'], message.toString(), ws);
                    break;
                }

                // V2 Spatial World Update from Aether (30Hz hands + 5Hz planes + pet directive)
                case 'SPATIAL_WORLD_UPDATE_V2': {
                    clientInfo.role = 'aether';
                    spatialState.metrics.worldUpdatesCount++;

                    if (packet.dualHandPose) {
                        spatialState.dualHandPose = packet.dualHandPose;
                    }
                    if (packet.roomPlanes && Array.isArray(packet.roomPlanes)) {
                        spatialState.roomPlanes = packet.roomPlanes;
                    }
                    if (packet.petDirective) {
                        const dir = packet.petDirective;
                        if (dir.state) spatialState.petState.mode = dir.state;
                        if (dir.targetPosition) spatialState.petState.targetPosition = dir.targetPosition;
                        if (dir.targetSurfaceId) spatialState.petState.targetSurfaceId = dir.targetSurfaceId;
                        if (dir.speechHud) {
                            spatialState.petState.speechText = dir.speechHud;
                            spatialState.petState.speechTimestamp = Date.now();
                        }
                    }

                    // Broadcast V2 updates to Phone (for AR render & occlusion) and Dashboard
                    broadcastToRoles(['imager', 'dashboard', 'unknown'], message.toString(), ws);
                    break;
                }

                // Backward-compatible spatial state
                case 'spatial_state': {
                    clientInfo.role = 'aether';
                    if (packet.gesture) spatialState.dualHandPose.gesture = packet.gesture;
                    if (packet.petState) spatialState.petState = { ...spatialState.petState, ...packet.petState };
                    if (packet.speech) spatialState.petState.speechText = packet.speech;
                    broadcastToRoles(['imager', 'dashboard', 'unknown'], message.toString(), ws);
                    break;
                }

                // Commands from Dashboard (e.g. Climb Chair, Hide Under Bed, Recenter)
                case 'dashboard_command': {
                    if (packet.petState) {
                        spatialState.petState = { ...spatialState.petState, ...packet.petState };
                    }
                    const worldDirective = {
                        type: 'SPATIAL_WORLD_UPDATE_V2',
                        timestamp: Date.now(),
                        petDirective: {
                            state: packet.gesture || packet.petState?.mode || 'IDLE_SCAN',
                            targetPosition: packet.petState?.targetPosition || spatialState.petState.targetPosition,
                            speechHud: packet.speech || spatialState.petState.speechText
                        }
                    };
                    broadcastToRoles(['imager', 'aether'], JSON.stringify(worldDirective));
                    break;
                }

                default:
                    broadcastToRoles(['imager', 'aether', 'dashboard'], message.toString(), ws);
                    break;
            }
        } catch (err) {
            console.error('[Nexus V2] Message processing error:', err.message);
        }
    });

    ws.on('close', () => {
        const info = clients.get(ws);
        console.log(`[Nexus V2] Client disconnected: ${info?.id} (${info?.role})`);
        clients.delete(ws);
    });

    ws.on('error', (err) => {
        console.warn(`[Nexus V2] Socket error: ${err.message}`);
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

wssSecure.on('connection', (ws, req) => handleConnection(ws, req, 'WSS'));
wssInsecure.on('connection', (ws, req) => handleConnection(ws, req, 'WS'));

const lanIp = getPrimaryLanIp();
const allIps = getAllIpv4Addresses();

httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log('\n================================================================');
        console.log('       MAYAwe V2 — Co-Located Spatial Broker & AR Hub            ');
        console.log('================================================================');
        console.log(`[*] TLS Certificate: ${cached ? 'Cached (cert.pem)' : 'Newly Generated'}`);
        console.log(`[*] PC LAN IP:       ${lanIp}`);
        console.log(`[*] All Local IPs:   ${allIps.join(', ')}`);
        console.log('----------------------------------------------------------------');
        console.log(`>>> MOBILE AR CLIENT (Open on Phone in Cardboard):`);
        console.log(`    https://${lanIp}:${HTTPS_PORT}/imager`);
        console.log('----------------------------------------------------------------');
        console.log(`>>> PC 3D SPATIAL DASHBOARD (Open on Laptop):`);
        console.log(`    https://localhost:${HTTPS_PORT}/dashboard`);
        console.log('----------------------------------------------------------------');
        console.log(`[*] Secure WSS:      wss://0.0.0.0:${HTTPS_PORT}`);
        console.log(`[*] Insecure WS:     ws://0.0.0.0:${HTTP_PORT}`);
        console.log('================================================================\n');
    });
});
