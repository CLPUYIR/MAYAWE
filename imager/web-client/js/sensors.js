// MAYAwe Imager: Sensor Logic
// Handles DeviceOrientation, DeviceMotion, and fixed-rate 60Hz Telemetry Fusion

const sensorState = {
    rotation: { alpha: 0, beta: 0, gamma: 0 },
    quaternion: { qx: 0, qy: 0, qz: 0, qw: 1 },
    acceleration: { x: 0, y: 0, z: 0 },
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
    interval: 16.67,
    lastMotionTimestamp: 0,
    lastOrientationTimestamp: 0,
    isListening: false
};

let onSensorTickCallback = null;
let tickTimerId = null;
let lastTickTime = performance.now();

/**
 * Converts device orientation Euler angles (alpha, beta, gamma in degrees)
 * into a normalized unit quaternion (qx, qy, qz, qw) using Tait-Bryan Z-X'-Y'' conventions.
 */
function eulerToQuaternion(alphaDeg = 0, betaDeg = 0, gammaDeg = 0) {
    const deg2rad = Math.PI / 180.0;
    const a = (alphaDeg || 0) * deg2rad;
    const b = (betaDeg || 0) * deg2rad;
    const g = (gammaDeg || 0) * deg2rad;

    const cX = Math.cos(b / 2);
    const sX = Math.sin(b / 2);
    const cY = Math.cos(g / 2);
    const sY = Math.sin(g / 2);
    const cZ = Math.cos(a / 2);
    const sZ = Math.sin(a / 2);

    // ZXY intrinsic order
    let qx = sX * cY * cZ - cX * sY * sZ;
    let qy = cX * sY * cZ + sX * cY * sZ;
    let qz = cX * cY * sZ - sX * sY * cZ;
    let qw = cX * cY * cZ + sX * sY * sZ;

    // Normalize quaternion
    const norm = Math.hypot(qx, qy, qz, qw);
    if (norm > 0.000001) {
        qx /= norm;
        qy /= norm;
        qz /= norm;
        qw /= norm;
    } else {
        qx = 0; qy = 0; qz = 0; qw = 1;
    }

    return { qx, qy, qz, qw };
}

/**
 * Initializes sensor event listeners with iOS 13+ permission support.
 */
async function requestSensorPermissions() {
    console.log("[MAYAwe Sensors] Requesting device sensor permissions...");

    let granted = true;

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const orientationPermission = await DeviceOrientationEvent.requestPermission();
            granted = granted && (orientationPermission === 'granted');
        } catch (err) {
            console.warn("[MAYAwe Sensors] Orientation permission request error:", err);
            granted = false;
        }
    }

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const motionPermission = await DeviceMotionEvent.requestPermission();
            granted = granted && (motionPermission === 'granted');
        } catch (err) {
            console.warn("[MAYAwe Sensors] Motion permission request error:", err);
            granted = false;
        }
    }

    if (granted) {
        startSensorListeners();
        startTelemetryLoop();
        return true;
    } else {
        console.error("[MAYAwe Sensors] Permissions denied by user.");
        return false;
    }
}

/**
 * Attaches low-level event listeners with safe null-checking.
 */
function startSensorListeners() {
    if (sensorState.isListening) return;
    sensorState.isListening = true;

    // 1. Device Orientation Listener
    window.addEventListener('deviceorientation', (event) => {
        const alpha = event.alpha ?? 0;
        const beta = event.beta ?? 0;
        const gamma = event.gamma ?? 0;

        sensorState.rotation.alpha = alpha;
        sensorState.rotation.beta = beta;
        sensorState.rotation.gamma = gamma;
        sensorState.quaternion = eulerToQuaternion(alpha, beta, gamma);
        sensorState.lastOrientationTimestamp = performance.now();
    }, true);

    // 2. Device Motion Listener with robust null checks for desktop/unsupported hardware
    window.addEventListener('devicemotion', (event) => {
        const acc = event.accelerationIncludingGravity || event.acceleration;
        if (acc) {
            sensorState.acceleration.x = acc.x ?? 0;
            sensorState.acceleration.y = acc.y ?? 0;
            sensorState.acceleration.z = acc.z ?? 0;
        } else {
            sensorState.acceleration.x = 0;
            sensorState.acceleration.y = 0;
            sensorState.acceleration.z = 0;
        }

        const rotRate = event.rotationRate;
        if (rotRate) {
            sensorState.rotationRate.alpha = rotRate.alpha ?? 0;
            sensorState.rotationRate.beta = rotRate.beta ?? 0;
            sensorState.rotationRate.gamma = rotRate.gamma ?? 0;
        }

        if (event.interval) {
            sensorState.interval = event.interval;
        }
        sensorState.lastMotionTimestamp = performance.now();
    }, true);

    console.log("[MAYAwe Sensors] Sensor listeners active.");
}

/**
 * Emits a single synchronized telemetry tick at fixed 60 Hz.
 */
function startTelemetryLoop() {
    if (tickTimerId) return;

    const TARGET_FPS = 60;
    const FRAME_DURATION = 1000 / TARGET_FPS;

    function tick() {
        const now = performance.now();
        const delta = now - lastTickTime;

        if (delta >= FRAME_DURATION - 2) {
            lastTickTime = now;
            if (onSensorTickCallback) {
                // Clone state snapshot
                const payload = {
                    rotation: { ...sensorState.rotation },
                    quaternion: { ...sensorState.quaternion },
                    acceleration: { ...sensorState.acceleration },
                    rotationRate: { ...sensorState.rotationRate },
                    interval: delta
                };
                onSensorTickCallback(payload);
            }
        }
        tickTimerId = requestAnimationFrame(tick);
    }

    tickTimerId = requestAnimationFrame(tick);
    console.log("[MAYAwe Sensors] Synchronized 60Hz telemetry loop started.");
}

function stopTelemetryLoop() {
    if (tickTimerId) {
        cancelAnimationFrame(tickTimerId);
        tickTimerId = null;
    }
    sensorState.isListening = false;
}

function setSensorTickCallback(callback) {
    onSensorTickCallback = callback;
}

// Export for module/global use
window.MAYAweSensors = {
    state: sensorState,
    requestPermissions: requestSensorPermissions,
    setCallback: setSensorTickCallback,
    eulerToQuaternion,
    stop: stopTelemetryLoop
};
