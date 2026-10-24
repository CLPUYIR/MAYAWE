# MAYAwe BLUEPRINT: Distributed Spatial Computing & AR AI Architecture (v2.0)

## 1. Vision & Architectural Philosophy
MAYAwe aims to democratize spatial computing (AR/VR/MR) by transforming ordinary consumer hardware—specifically spare smartphones and home PCs—into a modular, scalable, and low-latency distributed computing ecosystem.

### Core Tenets:
1. **Zero-Latency Rendering Principle:** Never stream full camera video to the PC and back for AR rendering (which incurs 100+ ms of motion-to-photon latency, causing severe disorientation). Render the AR overlay locally on the phone at 60 FPS.
2. **Hybrid Spatial Perception:** Combine **Inside-Out** tracking (phone IMU + camera) with **Outside-In** tracking (laptop webcam tracking user hand gestures in 3D).
3. **Dual-Loop Vision & AI:**
   - **Fast Loop (30 Hz):** High-speed local hand landmarking and gestural control via MediaPipe.
   - **Slow Loop (0.5 Hz):** Asynchronous semantic scene understanding via Gemini 2.5 Flash (or local contour saliency offline).

---

## 2. Distributed System Hierarchy

```
+-------------------------------------------------------------------------+
|                        TIER 1: MOBILE IMAGER (PHONE)                    |
|  - Hardware: Consumer Smartphone running modern Chrome or Safari        |
|  - Senses: Rear camera video stream + 60 Hz IMU (accelerometer/gyro)    |
|  - Display: Three.js transparent AR canvas overlay over camera feed     |
|  - Local Actor: Procedural articulated 3D Robot Pet ("MAYA")            |
+-----------------------------------▲-------------------------------------+
                                    │ Local Wi-Fi (HTTPS / WSS: 8443)
                                    ▼
+-------------------------------------------------------------------------+
|                         TIER 2: NEXUS BROKER (PC HUB)                   |
|  - Hardware: Local Laptop / Desktop PC                                  |
|  - Security: Dynamic Self-Signed TLS Certificate Generator (cert/key)   |
|  - Servers: Express HTTPS:8443 (WSS) + HTTP:8080 (WS fallback)          |
|  - State Broker: Maintains unified spatial state (devices, hands, pet)  |
|  - Dashboard: Interactive Three.js 3D Spatial Visualizer                |
+-----------------------------------▲-------------------------------------+
                                    │ Local Bidirectional WebSocket Loop
                                    ▼
+-------------------------------------------------------------------------+
|                  TIER 3: AETHER SPATIAL INTELLIGENCE                    |
|  - Fast Loop (30 Hz): Outside-In Laptop Webcam + MediaPipe Hand Tracker |
|  - Gestures: OPEN_PALM, INDEX_POINT, PINCH, FIST, WAVE                  |
|  - Slow Loop (0.5 Hz): Gemini 2.5 Flash / Offline OpenCV Saliency       |
|  - Sensor Fusion: Shortest-arc angular delta & EMA noise filtering      |
+-------------------------------------------------------------------------+
```

---

## 3. Mathematical Foundations & Sensor Fusion

### 3.1 DeviceOrientation Euler to Unit Quaternion Transformation
Mobile browsers deliver `DeviceOrientationEvent` in intrinsic Tait-Bryan Z-X'-Y'' angles:
- $\alpha \in [0, 360)^\circ$: Azimuth / Yaw (rotation around Z)
- $\beta \in [-180, 180)^\circ$: Pitch (rotation around X)
- $\gamma \in [-90, 90)^\circ$: Roll (rotation around Y)

To prevent gimbal lock and discontinuities, angles are transformed on-device into a unit quaternion $\mathbf{q} = (q_x, q_y, q_z, q_w)$:
Let $\theta_x = \beta / 2$, $\theta_y = \gamma / 2$, $\theta_z = \alpha / 2$.
Then:
$$q_x = \sin\theta_x \cos\theta_y \cos\theta_z - \cos\theta_x \sin\theta_y \sin\theta_z$$
$$q_y = \cos\theta_x \sin\theta_y \cos\theta_z + \sin\theta_x \cos\theta_y \sin\theta_z$$
$$q_z = \cos\theta_x \cos\theta_y \sin\theta_z - \sin\theta_x \sin\theta_y \cos\theta_z$$
$$q_w = \cos\theta_x \cos\theta_y \cos\theta_z + \sin\theta_x \sin\theta_y \sin\theta_z$$

Normalized such that $\|\mathbf{q}\| = 1$.

### 3.2 Shortest-Arc Angular Delta (Eliminating 0°/360° Wrap Spikes)
Raw subtractions like $|\alpha_t - \alpha_{t-1}|$ produce false $350^\circ+$ motion spikes when crossing north ($0^\circ / 360^\circ$). The shortest angular difference is calculated as:
$$\Delta\theta = |((\theta_t - \theta_{t-1} + 180^\circ) \pmod{360^\circ}) - 180^\circ|$$

### 3.3 Exponential Moving Average (EMA) Filter
Raw accelerometer readings contain significant high-frequency vibration noise. An EMA filter is applied to smooth vectors $\mathbf{v}$:
$$\mathbf{s}_t = \alpha \mathbf{v}_t + (1 - \alpha) \mathbf{s}_{t-1}$$
where $\alpha = 0.25$ for acceleration and $\alpha = 0.35$ for orientation smoothing.

---

## 4. Telemetry & Messaging Schemas

### 4.1 Synchronized Telemetry Packet (Imager -> Nexus -> Aether/Dashboard at 60 Hz)
```json
{
  "type": "telemetry",
  "deviceId": "phone_7a9f2b",
  "timestamp": 1729774800000,
  "data": {
    "rotation": { "alpha": 182.4, "beta": 12.5, "gamma": -4.2 },
    "quaternion": { "qx": 0.082, "qy": -0.024, "qz": 0.995, "qw": 0.041 },
    "acceleration": { "x": 0.12, "y": 9.81, "z": -0.45 },
    "interval": 16.67
  }
}
```

### 4.2 Camera Keyframe Packet (Imager -> Nexus -> Aether at 0.5 Hz)
```json
{
  "type": "camera_keyframe",
  "deviceId": "phone_7a9f2b",
  "timestamp": 1729774800000,
  "jpegBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

### 4.3 Spatial State Packet (Aether -> Nexus -> Imager/Dashboard at 30 Hz)
```json
{
  "type": "spatial_state",
  "source": "aether",
  "timestamp": 1729774800000,
  "handPose": {
    "landmarks": [
      { "x": 0.48, "y": 0.62, "z": -0.10 }
    ],
    "handedness": "Right",
    "confidence": 0.95
  },
  "gesture": "INDEX_POINT",
  "petState": {
    "mode": "WALK",
    "position": { "x": 0.15, "y": -0.15, "z": -1.35 },
    "targetPosition": { "x": 0.42, "y": -0.15, "z": -1.20 },
    "speechText": "Moving to indicated target! 🎯"
  },
  "speech": "Moving to indicated target! 🎯"
}
```

---

## 5. Security & Browser Reality Compliance
To satisfy modern browser security models:
1. **HTTPS and WSS Enforcement:** Mobile Web APIs (`navigator.mediaDevices.getUserMedia`, `DeviceOrientationEvent`, and `DeviceMotionEvent`) are strictly disabled over plain HTTP unless on `localhost`. Nexus solves this by dynamically creating an in-memory/cached self-signed TLS certificate matching the host's actual LAN IP address.
2. **User Gesture Activation:** All audio/video capture and sensor streams must be initiated via an explicit touch/click event on the mobile display (`Start Spatial AR Experience` button).
3. **Accepting Self-Signed Certificates on Mobile:**
   - Chrome for Android: Tap **Advanced** -> **Proceed to 192.168.x.x (unsafe)**.
   - Safari for iOS: Tap **Show Details** -> **visit this website**.

---

<div align="center">
  <i>MAYAwe Technical Specification &bull; Distributed Spatial Systems</i>
</div>
