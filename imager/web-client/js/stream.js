// MAYAwe Imager: Streaming Logic
// Manages secure WSS/WS connections, bidirectional telemetry, and keyframe streaming

const deviceId = `phone_${Math.random().toString(36).substr(2, 7)}`;
let socket = null;
let reconnectTimer = null;
let keyframeTimer = null;
const listeners = {
    spatial_state: [],
    open: [],
    close: []
};

function getWebSocketUrl() {
    const isHttps = window.location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.host; // includes port if specified
    return `${proto}//${host}`;
}

function connectToNexus(url) {
    const wsUrl = url || getWebSocketUrl();
    console.log(`[MAYAwe Stream] Connecting to Nexus at ${wsUrl}...`);

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
        console.log(`[MAYAwe Stream] Connected to Nexus! Device ID: ${deviceId}`);
        // Register role with Nexus
        sendJson({
            type: 'register',
            role: 'imager',
            deviceId: deviceId,
            timestamp: Date.now()
        });

        listeners.open.forEach(cb => cb());
    };

    socket.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);
            if (packet.type === 'spatial_state' || packet.type === 'spatial_state_snapshot') {
                listeners.spatial_state.forEach(cb => cb(packet));
            }
        } catch (err) {
            console.warn('[MAYAwe Stream] Error parsing incoming packet:', err);
        }
    };

    socket.onclose = (event) => {
        console.warn(`[MAYAwe Stream] Connection closed (${event.code}). Retrying in 3s...`);
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
    }, 3000);
}

function sendJson(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
    }
}

function sendTelemetry(data) {
    sendJson({
        type: 'telemetry',
        deviceId: deviceId,
        timestamp: Date.now(),
        data: data
    });
}

function sendCameraKeyframe(jpegBase64) {
    sendJson({
        type: 'camera_keyframe',
        deviceId: deviceId,
        timestamp: Date.now(),
        jpegBase64: jpegBase64
    });
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
    sendCameraKeyframe,
    onSpatialState,
    onConnectionChange,
    isConnected,
    getWebSocketUrl
};
