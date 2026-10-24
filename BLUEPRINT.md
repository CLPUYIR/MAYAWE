# 🌐 MAYAwe V2 — Technical Architecture Blueprint
**Co-Located Dual-Camera Stereoscopic AR & Volumetric 3D AI Pet Ecosystem**

---

## 1. System Overview

MAYAwe V2 upgrades the original handheld magic-window MVP into a **hands-free, room-scale spatial computing system** using a **Google Cardboard headset**, a **Laptop GPU/CPU Hub**, and **Cloud Multimodal AI**. By combining the phone's Inside-Out camera with the laptop's Outside-In webcam in a shared 3D coordinate frame, the virtual robot pet (**"MAYA"**) understands room geometry—climbing onto real chairs, jumping onto beds, and hiding under furniture with accurate physical depth occlusion.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: 📱 MOBILE IMAGER (Smartphone in Google Cardboard Headset)          │
│ • Stereoscopic Split-Screen WebGL Renderer (60 FPS) + Center Divider       │
│ • Low-Latency Orientation Tracking & WebXR / 6-DoF VIO Fallback           │
│ • Invisible Depth-Occlusion Proxies (Clips MAYA behind real chairs/beds)   │
│ • 60 Hz IMU Telemetry + 15 Hz Egocentric CV Stream + 0.5 Hz Keyframes      │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ HTTPS / WSS:8443 (Low-Latency LAN)
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 2: 💻 NEXUS ENGINE (Laptop Spatial Broker & 3D Dashboard)             │
│ • Auto-Generated Self-Signed LAN TLS (cert.pem / key.pem)                  │
│ • Unified Spatial State Broker (phonePose6DoF, dualHandPose, roomPlanes)   │
│ • Visualizes both camera frustums (T_laptop_to_world, T_phone_to_world)    │
│ • Real-Time 3D Spatial Dashboard (https://localhost:8443/dashboard)        │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ Local IPC / Bidirectional WS Loop
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 3: 🧠 AETHER SPATIAL INTELLIGENCE ENGINE (Python Multi-Loop Solver)   │
│ • FAST LOOP (30 Hz): Dual-Camera MediaPipe Hands (Phone Inside-Out +       │
│   Laptop Outside-In) with Source Selection (w_phone, w_laptop)             │
│ • MEDIUM LOOP (5 Hz): Heuristic Contour & Elevation 3D Furniture Planes    │
│   (FLOOR, CHAIR_OR_BED_SURFACE, DESK_OR_TABLE, UNDER_BED_ZONE)             │
│ • SLOW LOOP (0.5 Hz): Gemini 2.5 Flash Structured JSON Spatial Scene Graph │
│   + Offline OpenCV Contour/Disparity Fallback                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Coordinate Frames & Dual-Camera Sensor Fusion

### 2.1 Shared World Origin `(0, 0, 0)`
All three modules communicate using a right-handed metric **World Coordinate System** (in meters, `+Y` Up, `-Z` Forward from the initial calibration anchor on the floor below the laptop):
- **Floor Elevation:** $y = 0.0\text{ m}$ (Normal vector $\vec{n} = [0, 1, 0]^T$)
- **Laptop Webcam Transform:** $\mathbf{T}_{\text{laptop}\rightarrow\text{world}} \in \text{SE}(3)$ (Static anchor at desk elevation $y \approx 0.75\text{ m}$)
- **Phone Headset Transform:** $\mathbf{T}_{\text{phone}\rightarrow\text{world}}(t) \in \text{SE}(3)$ (Dynamic 6-DoF ego-pose updated at 60 Hz)

### 2.2 Dual-Camera Hand Tracking Handover & Source Selection (30 Hz)
To eliminate the narrow FOV ($65^\circ\text{--}75^\circ$) and wrist self-occlusion limits of a smartphone camera strapped to the head:
1. `aether/processor.py` runs MediaPipe Hands on **both** the laptop webcam (`Outside-In`) and the incoming 15 Hz phone camera stream (`Inside-Out`).
2. **Current Implementation Note:** Without an active optical calibration pattern or co-visible ArUco marker, true metric extrinsic fusion between the phone and laptop camera spaces is uncalibrated. Aether performs dynamic source selection:
   - When the laptop webcam detects hand landmarks, it selects the laptop tracker with high confidence ($w_{\text{laptop}} = 0.95, w_{\text{phone}} = 0.05$).
   - When roaming away from the desk, the phone camera stream is selected ($w_{\text{phone}} = 0.95, w_{\text{laptop}} = 0.05$).
   - If neither camera detects landmarks, synthetic landmark telemetry is generated so downstream state machines run reliably offline.
   - Metric extrinsic Sim(3) co-registration is planned for V2.1.

---

## 3. Volumetric Surface Classification & Depth Occlusion (5 Hz + 0.5 Hz)

### 3.1 Heuristic Plane Estimation & Elevation Taxonomy
In `aether/processor.py`, `HeuristicPlaneEstimator` establishes default room planes and refines plane elevations dynamically using Canny contour bounding boxes and geometric priors (`source: 'heuristic'`). When multimodal Gemini 2.5 Flash outputs are available, detected bounding boxes are cross-referenced to promote matching planes to `source: 'vlm'`:

| Surface Class | Metric Elevation ($y$) | Normal $\vec{n}$ | AI Pet ("MAYA") Affordance & Physics Behavior | Source Tags |
| :--- | :--- | :--- | :--- | :--- |
| `FLOOR` | $0.00\text{ m} \pm 0.05\text{ m}$ | $[0, 1, 0]$ | Default walking, running, and landing surface. | `default`, `heuristic` |
| `UNDER_BED_SHADOW_ZONE` | Cavity $y \in [0.00\text{ m}, 0.35\text{ m}]$ beneath overhang | $[0, 1, 0]$ | Target zone for `HIDE_UNDER_BED`; triggers low crouch posture + upper plane depth occlusion. | `default`, `vlm` |
| `CHAIR_OR_BED_SURFACE` | $0.40\text{ m} \text{ to } 0.60\text{ m}$ | $[0, 1, 0]$ | Target platform for `CLIMB_CHAIR` and `JUMP_ON_BED` ballistic trajectories. | `default`, `heuristic`, `vlm` |
| `DESK_OR_TABLE` | $0.70\text{ m} \text{ to } 0.90\text{ m}$ | $[0, 1, 0]$ | High tabletop platform; acts as an obstacle or high perch. | `default`, `heuristic` |
| `VERTICAL_OBSTACLE` | $y \in [0.00\text{ m}, 1.20\text{ m}]$ | $n_y \approx 0$ | Chair backs, bed frames, desk fronts; registered as Three.js depth-write occlusion masks. | `default`, `vlm` |

### 3.2 Real-Time Three.js Depth Occlusion (`imager`)
To make MAYA convincingly hide *under* a physical bed or *behind* a chair without rendering expensive dense meshes on the phone:
- `Nexus` broadcasts lightweight 3D oriented bounding boxes (`OBB`) and plane polygons in the `roomPlanes` WebSocket payload.
- `imager/web-client/js/main.js` instantiates invisible occluder meshes:
  ```javascript
  const occluderMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true
  });
  ```
- Every frame, occluder meshes render at `renderOrder = 0` before MAYA (`renderOrder = 1`). Any part of MAYA's body physically behind a chair leg or underneath a bed frame fails the WebGL Z-buffer depth test, letting the live rear-camera video show through naturally.

---

## 4. AI Pet ("MAYA") Physics & Spatial State Machine
MAYA transitions smoothly between 7 spatial states driven by hand gestures, surface affordances, and voice/dashboard commands:

1. **`IDLE_SCAN`:** Breathes, blinks, and turns head toward the user's Cardboard head position.
2. **`WALK_ON_SURFACE`:** Moves toward target waypoint $(x, z)$ while clamping foot elevation $y$ to the active supporting plane (`FLOOR`, `CHAIR_OR_BED_SURFACE`, or `DESK_OR_TABLE`). If walking off a plane edge, gravity drops MAYA back to `FLOOR`.
3. **`CLIMB_CHAIR` / `JUMP_ON_BED`:** Triggered when `INDEX_POINT` raycasts onto a `CHAIR_OR_BED_SURFACE` or via semantic command. Solves a parabolic arc:
   $$y(t) = y_0 + (y_{\text{target}} - y_0)p + 4 h_{\text{peak}} p (1 - p)$$
   with pitch tilt during ascent and landing compression upon touching the seat/bed plane.
4. **`HIDE_UNDER_BED` / `HIDE_BEHIND_OBSTACLE`:** Triggered by hide command or gesture. MAYA sprints to the nearest `UNDER_BED_SHADOW_ZONE`, lowers body height by 50%, and peeks out while occluded by physical bed geometry.
5. **`FOLLOW_USER` (`PINCH`):** Follows 1.0 meter ahead of the user's Cardboard trajectory across the room.
6. **`SIT_STAY` (`FIST`):** Lowers hindquarters onto the current surface plane.
7. **`GREET_WAVE` (`OPEN_PALM`):** Raises front paw and displays contextual spatial HUD speech.

**Sequence-Tracked Directive Protocol:** Directives broadcast from Nexus carry a monotonic `directiveSeq`. Both Aether and Imager only apply directives with newer sequence numbers, preventing 30Hz idle frames from overwriting one-shot commands.

---

## 5. WebSocket Protocol Specification (WSS:8443)

### 5.1 `imager` $\rightarrow$ `nexus` (60 Hz Telemetry + 15 Hz CV Frame + 0.5 Hz Snapshot)
```json
{
  "type": "IMAGER_TELEMETRY_V2",
  "timestamp": 1761314000123,
  "mode": "CARDBOARD_STEREO",
  "pose6DoF": {
    "position": { "x": 0.12, "y": 1.58, "z": -0.45 },
    "quaternion": { "qx": 0.01, "qy": -0.18, "qz": 0.00, "qw": 0.98 },
    "rotation": { "alpha": 21.4, "beta": 82.1, "gamma": -1.2 },
    "trackingSource": "IMU_VIO_FALLBACK"
  },
  "cvFrameBase64": "<optional_15Hz_640x360_jpeg>",
  "semanticSnapshotBase64": "<optional_0.5Hz_jpeg>"
}
```

### 5.2 `aether` $\rightarrow$ `nexus` $\rightarrow$ `imager` (30 Hz State & 5 Hz Geometry Update)
```json
{
  "type": "SPATIAL_WORLD_UPDATE_V2",
  "timestamp": 1761314000140,
  "dualHandPose": {
    "active": true,
    "gesture": "INDEX_POINT",
    "weights": { "phone": 0.05, "laptop": 0.95, "selectedSource": "laptop", "calibrated": false },
    "wristWorld": { "x": 0.15, "y": 1.10, "z": -0.85 },
    "raycastTarget": { "x": 0.80, "y": 0.45, "z": -1.60, "surfaceId": "plane_chair_1" }
  },
  "roomPlanes": [
    {
      "id": "plane_floor_0",
      "class": "FLOOR",
      "center": { "x": 0.0, "y": 0.0, "z": -1.5 },
      "extents": { "w": 5.0, "d": 5.0, "h": 0.02 },
      "source": "default"
    },
    {
      "id": "plane_chair_1",
      "class": "CHAIR_OR_BED_SURFACE",
      "semanticLabel": "wooden_chair",
      "center": { "x": 0.80, "y": 0.45, "z": -1.60 },
      "extents": { "w": 0.55, "d": 0.55, "h": 0.45 },
      "occluder": true,
      "source": "heuristic"
    }
  ],
  "petDirective": {
    "state": "CLIMB_CHAIR",
    "targetSurfaceId": "plane_chair_1",
    "targetPosition": { "x": 0.80, "y": 0.45, "z": -1.60 },
    "speechHud": "Jumping up onto the wooden chair! 🐾🪑",
    "directiveSeq": 42
  }
}
```

---

## 6. Gemini 2.5 Flash Structured Scene Graph Schema (`aether/processor.py`)
In the 0.5 Hz Slow Loop, Aether sends keyframe snapshots to `gemini-2.5-flash` using `response_mime_type="application/json"` with the following schema:
```json
{
  "sceneSummary": "Bedroom workspace with a wooden chair next to a desk and a raised bed frame on the left.",
  "detectedSurfaces": [
    {
      "label": "chair_seat",
      "category": "CHAIR_OR_BED_SURFACE",
      "box_2d": [420, 580, 710, 820],
      "estimatedElevationMeters": 0.45,
      "canPetClimb": true
    },
    {
      "label": "under_bed_cavity",
      "category": "UNDER_BED_SHADOW_ZONE",
      "box_2d": [650, 110, 890, 460],
      "estimatedElevationMeters": 0.0,
      "canPetHide": true
    }
  ],
  "assistantReply": "MAYA can jump onto the chair on your right or hide underneath the bed on your left."
}
```

---

## 7. Subsystem Implementation Status

| Subsystem / Feature | Status | Implementation Notes |
| :--- | :--- | :--- |
| **Google Cardboard Stereo** | Implemented | Dual scissor viewports (`cameraLeft`, `cameraRight`) with 64mm IPD separation and physical center divider. |
| **WebXR 6-DoF Tracking** | Implemented | Opt-in button (`toggle-webxr-btn`) requesting `immersive-ar` session with `local-floor` space; falls back cleanly to 60Hz IMU. |
| **IMU Dead Reckoning** | Implemented | 60Hz Euler-to-quaternion integration with gravity subtraction and exponential velocity damping. |
| **Dual-Camera Hand Tracking** | Implemented | Source selection (laptop webcam preferred when at desk, phone stream when roaming); extrinsic calibration between cameras is uncalibrated. |
| **Heuristic Plane Estimator** | Implemented | `HeuristicPlaneEstimator` infers 3D planes from geometric priors and Canny contour bounding boxes (`source="heuristic"` / `source="default"`). |
| **VLM Scene Graph** | Implemented | Gemini 2.5 Flash Structured JSON scene descriptions merged with heuristic planes (`source="vlm"`); offline OpenCV contour fallback. |
| **Invisible Depth Occluders** | Implemented | Real-world furniture masks rendered with `colorWrite: false, depthWrite: true` (`renderOrder=0`) before pet geometry. |
| **Pet State Machine** | Implemented | 7 behavioral states with parabolic jumping kinematics and crouch postures; sequence-tracked directives (`directiveSeq`) prevent overwriting. |
| **3D Spatial Dashboard** | Implemented | PC browser visualizer showing camera frustums, hand landmarks, detected planes, and interactive directive buttons. |
| **Optical Drift Correction** | Stubbed | `applyDriftCorrection` stub defined in `sensors.js` reserved for future outside-in marker triangulation. |
| **Extrinsic Sim(3) Fusion** | Planned | Automated visual calibration pattern / ArUco marker locking between phone and laptop cameras planned for V2.1. |

---

## 8. Mobile & Network Troubleshooting Guide

### 8.1 Self-Signed TLS Certificate Warning (Mobile Chrome / Android)
- When navigating to `https://<PC_LAN_IP>:8443/imager`, Chrome will display *"Your connection is not private"*.
- Tap **Advanced** → **Proceed to `<PC_LAN_IP>` (unsafe)**. This is mandatory because modern mobile browsers require HTTPS for camera (`getUserMedia`) and device orientation sensors.

### 8.2 iOS Safari Limitations & Workarounds
- **WSS WebSocket Security:** iOS Safari blocks secure WebSocket (`wss://`) connections to self-signed origins unless the user has visited and explicitly trusted the certificate on port 8443 in Safari first. Always open `https://<PC_LAN_IP>:8443/imager` in Safari directly.
- **WebXR Device API:** Standard iOS Safari does not natively support the WebXR Device API (`navigator.xr`). On iOS, MAYAwe automatically falls back to 60Hz fused IMU orientation tracking (`DeviceOrientationEvent` / `DeviceMotionEvent`), which runs smoothly in Google Cardboard. True 6-DoF WebXR on iOS requires a WebXR-compatible browser (e.g. WebXR Viewer).

### 8.3 Python & MediaPipe Installation on Python 3.13 / 3.14
- Official `mediapipe` binary wheels on PyPI support Python 3.9 through 3.12.
- If using Python 3.13 or 3.14, `pip install mediapipe` may fail. You can install an experimental Tasks wheel, run in a Python 3.11/3.12 virtual environment, or allow Aether to run in autonomous `SYNTHETIC` mode.

---

<div align="center">
  <i>MAYAwe Technical Specification &bull; Distributed Spatial Systems</i>
</div>
