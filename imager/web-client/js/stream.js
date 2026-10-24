// MAYAwe V2 Imager: Streaming Logic
// Manages secure WSS/WS connections, 60Hz 6-DoF telemetry, 15Hz CV keyframes, and 0.5Hz semantic snapshots

const deviceId = `cardboard_${Math.random().toString(36).substr(2, 7)}`;
let socket = null;
let reconnectTimer = null;
let isStereoActive = false;

const listeners = {
    spatial_world_update: [],
    spatial_state: [],
    open: [],
    close: []
};

function getWebSocketUrl() {
    const isHttps = window.location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}`;
}

function connectToNexus(url) {
    const wsUrl = url || getWebSocketUrl();
    console.log(`[MAYAwe V2 Stream] Connecting to Nexus at ${wsUrl}...`);

    if (socket) {
        try { socket.close(); } catch (e) {}
    }

    try {
        socket = new WebSocket(wsUrl);
    } catch (err) {
        console.error('[MAYAwe Stream] WebSocket construction failed:', err);
        scheduleReconnect(wsUrl);
        return;
    }

    socket.onopen = () => {
        console.log(`[MAYAwe V2 Stream] Connected to Nexus broker. Device ID: ${deviceId}`);
        sendJson({
            type: 'register',
            role: 'imager',
            deviceId: deviceId,
            v2Supported: true,
            timestamp: Date.now()
        });

        listeners.open.forEach(cb => cb());
    };

    socket.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);

            // 1. MAYAwe V2 Spatial World Update (Dual-Camera Hands + Room Planes + Pet Directives)
            if (packet.type === 'SPATIAL_WORLD_UPDATE_V2') {
                listeners.spatial_world_update.forEach(cb => cb(packet));
            }

            // 2. Backward-compatible spatial state
            if (packet.type === 'spatial_state' || packet.type === 'spatial_state_snapshot') {
                listeners.spatial_state.forEach(cb => cb(packet));
            }

            // 3. Drift correction from external camera tracking
            if (packet.type === 'drift_correction' && window.MAYAweSensors) {
                window.MAYAweSensors.applyDriftCorrection(packet.worldPosCorrection);
            }
        } catch (err) {
            console.warn('[MAYAwe Stream] Error parsing packet:', err);
        }
    };

    socket.onclose = (event) => {
        console.warn(`[MAYAwe Stream] Connection closed (${event.code}). Retrying in 2.5s...`);
        listeners.close.forEach(cb => cb());
        scheduleReconnect(wsUrl);
    };

    socket.onerror = (err) => {
        console.error('[MAYAwe Stream] WebSocket error:', err);
    };
}

function scheduleReconnect(url) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        connectToNexus(url);
    }, 2500);
}

function sendJson(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
    }
}

/**
 * Sends 60 Hz 6-DoF VIO Telemetry
 */
function sendTelemetry(data) {
    // V2 formatted packet
    const v2Packet = {
        type: 'IMAGER_TELEMETRY_V2',
        deviceId: deviceId,
        timestamp: Date.now(),
        mode: isStereoActive ? 'CARDBOARD_STEREO' : 'MONOCULAR_AR',
        pose6DoF: {
            position: data.position,
            quaternion: data.quaternion,
            euler: data.rotation,
            trackingSource: data.trackingSource
        },
        data: {
            rotation: data.rotation,
            quaternion: data.quaternion,
            acceleration: data.acceleration,
            interval: data.interval
        }
    };
    sendJson(v2Packet);
}

/**
 * Sends 15 Hz CV Keyframe (640x360) for MediaPipe Inside-Out Hand Tracking
 */
function sendCvKeyframe(jpegBase64) {
    sendJson({
        type: 'IMAGER_CV_FRAME',
        deviceId: deviceId,
        timestamp: Date.now(),
        cvFrameBase64: jpegBase64
    });
}

/**
 * Sends 0.5 Hz High-Quality Semantic Snapshot for Cloud Gemini VLM
 */
function sendSemanticSnapshot(jpegBase64) {
    sendJson({
        type: 'camera_keyframe',
        deviceId: deviceId,
        timestamp: Date.now(),
        jpegBase64: jpegBase64
    });
}

function setStereoModeFlag(active) {
    isStereoActive = !!active;
}

function onSpatialWorldUpdate(callback) {
    listeners.spatial_world_update.push(callback);
}

function onSpatialState(callback) {
    listeners.spatial_state.push(callback);
}

function onConnectionChange(onOpen, onClose) {
    if (onOpen) listeners.open.push(onOpen);
    if (onClose) listeners.close.push(onClose);
}

function isConnected() {
    return socket && socket.readyState === WebSocket.OPEN;
}

window.MAYAweStream = {
    deviceId,
    connect: connectToNexus,
    sendTelemetry,
    sendCvKeyframe,
    sendSemanticSnapshot,
    setStereoModeFlag,
    onSpatialWorldUpdate,
    onSpatialState,
    onConnectionChange,
    isConnected,
    getWebSocketUrl
};
