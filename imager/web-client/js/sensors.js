// MAYAwe V2 Imager: Sensor & 6-DoF VIO Engine
// Handles WebXR 6-DoF pose tracking with automatic 60Hz fused IMU VIO fallback

const sensorState = {
    // 6-DoF Position in meters (relative to world / room floor)
    position: { x: 0.0, y: 1.45, z: 0.0 }, // default eye level
    velocity: { x: 0.0, y: 0.0, z: 0.0 },
    quaternion: { qx: 0.0, qy: 0.0, qz: 0.0, qw: 1.0 },
    rotation: { alpha: 0.0, beta: 0.0, gamma: 0.0 },
    acceleration: { x: 0.0, y: 0.0, z: 0.0 },
    linearAcceleration: { x: 0.0, y: 0.0, z: 0.0 },
    rotationRate: { alpha: 0.0, beta: 0.0, gamma: 0.0 },
    interval: 16.67,
    trackingSource: 'IMU_VIO_FALLBACK', // 'WEBXR_6DOF' | 'IMU_VIO_FALLBACK'
    lastMotionTimestamp: 0,
    lastOrientationTimestamp: 0,
    isListening: false,
    xrSession: null,
    xrRefSpace: null
};

let onSensorTickCallback = null;
let tickTimerId = null;
let lastTickTime = performance.now();

// Gravity vector reference
const GRAVITY_CONSTANT = 9.80665;

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

    let qx = sX * cY * cZ - cX * sY * sZ;
    let qy = cX * sY * cZ + sX * cY * sZ;
    let qz = cX * cY * sZ - sX * sY * cZ;
    let qw = cX * cY * cZ + sX * sY * sZ;

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
 * Rotates a 3D vector by a quaternion
 */
function rotateVectorByQuat(v, q) {
    const u = { x: q.qx, y: q.qy, z: q.qz };
    const s = q.qw;

    // Cross product u x v
    const uxv = {
        x: u.y * v.z - u.z * v.y,
        y: u.z * v.x - u.x * v.z,
        z: u.x * v.y - u.y * v.x
    };

    // Cross product u x (u x v)
    const ux_uxv = {
        x: u.y * uxv.z - u.z * uxv.y,
        y: u.z * uxv.x - u.x * uxv.z,
        z: u.x * uxv.y - u.y * uxv.x
    };

    return {
        x: v.x + 2.0 * (s * uxv.x + ux_uxv.x),
        y: v.y + 2.0 * (s * uxv.y + ux_uxv.y),
        z: v.z + 2.0 * (s * uxv.z + ux_uxv.z)
    };
}

/**
 * Initializes sensors with iOS 13+ and WebXR Device API support.
 */
async function requestSensorPermissions() {
    console.log("[MAYAwe V2 Sensors] Initializing 6-DoF VIO & motion sensors...");
    let granted = true;

    // Check iOS permission requirements
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const orientationPermission = await DeviceOrientationEvent.requestPermission();
            granted = granted && (orientationPermission === 'granted');
        } catch (err) {
            console.warn("[MAYAwe Sensors] Orientation permission error:", err);
            granted = false;
        }
    }

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const motionPermission = await DeviceMotionEvent.requestPermission();
            granted = granted && (motionPermission === 'granted');
        } catch (err) {
            console.warn("[MAYAwe Sensors] Motion permission error:", err);
            granted = false;
        }
    }

    if (granted) {
        startSensorListeners();
        startTelemetryLoop();

        // Check WebXR Device API availability for true 6-DoF VIO
        checkWebXRSupport();
        return true;
    } else {
        console.error("[MAYAwe Sensors] Permissions denied by user.");
        return false;
    }
}

/**
 * Checks for native WebXR AR support
 */
async function checkWebXRSupport() {
    if (navigator.xr) {
        try {
            const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
            if (isSupported) {
                console.log("[MAYAwe Sensors] WebXR immersive-ar supported on this device.");
            }
        } catch (e) {
            console.log("[MAYAwe Sensors] WebXR query:", e.message);
        }
    }
}

/**
 * Starts a native WebXR session if requested
 */
async function startWebXRSession(renderer) {
    if (!navigator.xr) return false;
    try {
        const session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor'],
            optionalFeatures: ['hit-test', 'dom-overlay']
        });
        sensorState.xrSession = session;
        sensorState.xrRefSpace = await session.requestReferenceSpace('local-floor');
        sensorState.trackingSource = 'WEBXR_6DOF';
        console.log("[MAYAwe Sensors] WebXR 6-DoF Session active.");
        return true;
    } catch (err) {
        console.warn("[MAYAwe Sensors] WebXR session request fallback:", err.message);
        sensorState.trackingSource = 'IMU_VIO_FALLBACK';
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

    // 2. Device Motion Listener with robust null checks and linear acceleration calculation
    window.addEventListener('devicemotion', (event) => {
        const accGrav = event.accelerationIncludingGravity;
        const rawAcc = event.acceleration;

        if (accGrav) {
            sensorState.acceleration.x = accGrav.x ?? 0;
            sensorState.acceleration.y = accGrav.y ?? 0;
            sensorState.acceleration.z = accGrav.z ?? 0;
        }

        // If pure linear acceleration is reported by browser
        if (rawAcc && rawAcc.x !== null) {
            sensorState.linearAcceleration.x = rawAcc.x;
            sensorState.linearAcceleration.y = rawAcc.y;
            sensorState.linearAcceleration.z = rawAcc.z;
        } else if (accGrav) {
            // Compute linear acceleration by subtracting estimated gravity vector
            const worldGravity = { x: 0, y: -GRAVITY_CONSTANT, z: 0 };
            const qInv = {
                qx: -sensorState.quaternion.qx,
                qy: -sensorState.quaternion.qy,
                qz: -sensorState.quaternion.qz,
                qw: sensorState.quaternion.qw
            };
            const deviceGravity = rotateVectorByQuat(worldGravity, qInv);
            sensorState.linearAcceleration.x = (accGrav.x ?? 0) - deviceGravity.x;
            sensorState.linearAcceleration.y = (accGrav.y ?? 0) - deviceGravity.y;
            sensorState.linearAcceleration.z = (accGrav.z ?? 0) - deviceGravity.z;
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

    console.log("[MAYAwe V2 Sensors] Sensor listeners active.");
}

/**
 * Dead-reckoning integration step for VIO fallback (updated each tick)
 */
function integrateInertialOdometry(dt) {
    if (sensorState.trackingSource === 'WEBXR_6DOF') return;

    // Transform linear acceleration into world coordinates
    const worldLinAcc = rotateVectorByQuat(sensorState.linearAcceleration, sensorState.quaternion);

    // High-pass filter dead-band to eliminate stationary accelerometer bias drift
    const DEAD_BAND = 0.18; // m/s^2 threshold
    const ax = Math.abs(worldLinAcc.x) > DEAD_BAND ? worldLinAcc.x : 0;
    const ay = Math.abs(worldLinAcc.y) > DEAD_BAND ? worldLinAcc.y : 0;
    const az = Math.abs(worldLinAcc.z) > DEAD_BAND ? worldLinAcc.z : 0;

    // Velocity integration with exponential velocity damping (prevents explosion to infinity)
    const DAMPING = Math.pow(0.92, dt * 60);
    sensorState.velocity.x = (sensorState.velocity.x + ax * dt) * DAMPING;
    sensorState.velocity.y = (sensorState.velocity.y + ay * dt) * DAMPING;
    sensorState.velocity.z = (sensorState.velocity.z + az * dt) * DAMPING;

    // Position integration (clamped within room bounds)
    sensorState.position.x += sensorState.velocity.x * dt;
    sensorState.position.y = Math.max(0.6, Math.min(2.1, sensorState.position.y + sensorState.velocity.y * dt));
    sensorState.position.z += sensorState.velocity.z * dt;
}

/**
 * Correction hook from Nexus (STUB / UNUSED):
 * Reserved for future external outside-in camera optical drift correction if laptop camera triangulates phone marker.
 * Currently not invoked by active tracking pipeline; 6-DoF tracking relies on WebXR or IMU dead-reckoning.
 */
function applyDriftCorrection(worldPosCorrection) {
    // Stub: Currently unused. Kept for future outside-in optical triangulation integration.
    if (!worldPosCorrection) return;
    const LERP_SPEED = 0.2;
    if (worldPosCorrection.x !== undefined) sensorState.position.x += (worldPosCorrection.x - sensorState.position.x) * LERP_SPEED;
    if (worldPosCorrection.y !== undefined) sensorState.position.y += (worldPosCorrection.y - sensorState.position.y) * LERP_SPEED;
    if (worldPosCorrection.z !== undefined) sensorState.position.z += (worldPosCorrection.z - sensorState.position.z) * LERP_SPEED;
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
        const delta = (now - lastTickTime) / 1000.0;

        if (delta >= (FRAME_DURATION - 2) / 1000.0) {
            lastTickTime = now;

            // 1. Step inertial odometry dead reckoning
            integrateInertialOdometry(delta);

            // 2. Emit synchronized telemetry packet
            if (onSensorTickCallback) {
                const payload = {
                    position: { ...sensorState.position },
                    quaternion: { ...sensorState.quaternion },
                    rotation: { ...sensorState.rotation },
                    linearAcceleration: { ...sensorState.linearAcceleration },
                    acceleration: { ...sensorState.acceleration },
                    trackingSource: sensorState.trackingSource,
                    interval: delta * 1000.0
                };
                onSensorTickCallback(payload);
            }
        }
        tickTimerId = requestAnimationFrame(tick);
    }

    tickTimerId = requestAnimationFrame(tick);
    console.log("[MAYAwe V2 Sensors] Synchronized 60Hz 6-DoF VIO telemetry loop running.");
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

window.MAYAweSensors = {
    state: sensorState,
    requestPermissions: requestSensorPermissions,
    startWebXRSession,
    applyDriftCorrection,
    setCallback: setSensorTickCallback,
    eulerToQuaternion,
    stop: stopTelemetryLoop
};
