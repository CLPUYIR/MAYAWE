// MAYAwe Imager: Sensor Logic
// This file handles DeviceOrientation and DeviceMotion event listeners.

let sensorData = {
    rotation: { alpha: 0, beta: 0, gamma: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    interval: 0
};

let onSensorUpdate = null;

console.log("MAYAwe Sensors initialized.");

/**
 * Initializes sensors. On iOS, this MUST be triggered by a user gesture.
 */
async function requestPermissions() {
    console.log("Requesting sensor permissions...");
    
    // Check for iOS 13+ permission requirement
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const orientationPermission = await DeviceOrientationEvent.requestPermission();
            const motionPermission = await DeviceMotionEvent.requestPermission();
            
            if (orientationPermission === 'granted' && motionPermission === 'granted') {
                startListeners();
                return true;
            } else {
                console.error("Sensor permissions denied.");
                return false;
            }
        } catch (error) {
            console.error("Error requesting sensor permissions:", error);
            return false;
        }
    } else {
        // Non-iOS or older iOS versions
        startListeners();
        return true;
    }
}

function startListeners() {
    console.log("Starting sensor listeners...");

    window.addEventListener('deviceorientation', (event) => {
        sensorData.rotation = {
            alpha: event.alpha, // Z-axis rotation [0, 360]
            beta: event.beta,   // X-axis rotation [-180, 180]
            gamma: event.gamma  // Y-axis rotation [-90, 90]
        };
        if (onSensorUpdate) onSensorUpdate(sensorData);
    });

    window.addEventListener('devicemotion', (event) => {
        sensorData.acceleration = {
            x: event.accelerationIncludingGravity.x,
            y: event.accelerationIncludingGravity.y,
            z: event.accelerationIncludingGravity.z
        };
        sensorData.interval = event.interval;
        if (onSensorUpdate) onSensorUpdate(sensorData);
    });
}

/**
 * Register a callback for when sensor data is updated.
 */
function setSensorCallback(callback) {
    onSensorUpdate = callback;
}
