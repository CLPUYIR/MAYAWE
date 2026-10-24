# 🌐 MAYAwe V2 — Technical Architecture Blueprint
**Co-Located Dual-Camera Stereoscopic AR & Volumetric 3D AI Pet Ecosystem**

---

## 1. System Overview

MAYAwe V2 upgrades the original handheld magic-window MVP into a **hands-free, room-scale spatial computing system** using a **Google Cardboard headset**, a **Laptop GPU/CPU Hub**, and **Cloud Multimodal AI**. By fusing the phone's Inside-Out camera with the laptop's Outside-In webcam in a shared 3D coordinate frame, the virtual robot pet (**"MAYA"**) understands room geometry—climbing onto real chairs, jumping onto beds, and hiding under furniture with accurate physical depth occlusion.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: 📱 MOBILE IMAGER (Smartphone in Google Cardboard Headset)          │
│ • Stereoscopic Split-Screen WebGL Renderer (60 FPS) + Barrel Distortion    │
│ • Asynchronous TimeWarp (ATW) & WebXR / 6-DoF VIO Pose Tracking (<15ms)    │
│ • Invisible Depth-Occlusion Proxies (Clips MAYA behind real chairs/beds)   │
│ • 60 Hz IMU Telemetry + 15 Hz Egocentric CV Stream + 0.5 Hz Keyframes      │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ HTTPS / WSS:8443 (Low-Latency LAN)
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 2: 💻 NEXUS ENGINE (Laptop Spatial Broker & 3DGS/Plane Dashboard)     │
│ • Auto-Generated Self-Signed LAN TLS (cert.pem / key.pem)                  │
│ • Unified Spatial State Broker (phonePose6DoF, dualHandPose, roomPlanes)   │
│ • Sim(3) Extrinsic Calibration & Drift-Locking Coordinate Broker           │
│ • Real-Time 3D Spatial Dashboard (https://localhost:8443/dashboard)        │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ Local IPC / Bidirectional WS Loop
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 3: 🧠 AETHER SPATIAL INTELLIGENCE ENGINE (Python Multi-Loop Solver)   │
│ • FAST LOOP (30 Hz): Dual-Camera MediaPipe Hands (Phone Inside-Out +       │
│   Laptop Outside-In) with Kalman Confidence Blending (w_phone, w_pc)       │
│ • MEDIUM LOOP (5 Hz): Metric Depth Estimation + RANSAC 3D Plane Fitting    │
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

### 2.2 Dual-Camera Hand Tracking Handover (30 Hz)
To eliminate the narrow FOV ($65^\circ\text{--}75^\circ$) and wrist self-occlusion limits of a smartphone camera strapped to the head:
1. `aether/processor.py` runs MediaPipe Hands on **both** the laptop webcam (`Outside-In`) and the incoming 15 Hz phone camera stream (`Inside-Out`).
2. Each 21-joint hand skeleton is transformed into the World Frame and fused via confidence weights derived from MediaPipe visibility and frustum margin distance:
   $$\mathbf{P}_{\text{world}} = w_{\text{phone}} \left(\mathbf{T}_{\text{phone}\rightarrow\text{world}} \cdot \mathbf{P}_{\text{phone}}\right) + w_{\text{laptop}} \left(\mathbf{T}_{\text{laptop}\rightarrow\text{world}} \cdot \mathbf{P}_{\text{laptop}}\right)$$
   where $w_{\text{phone}} + w_{\text{laptop}} = 1$.
3. **Desk Mode:** When near the laptop, wide two-handed chest/desk gestures outside the phone's FOV are captured with $w_{\text{laptop}} \to 1.0$.
4. **Room-Scale Roaming Mode:** When the user walks away from the desk wearing Google Cardboard, $w_{\text{laptop}} \to 0.0$ and $w_{\text{phone}} \to 1.0$ seamlessly.
5. **VIO Scale Drift Correction:** Whenever the user enters the laptop webcam's view, `Aether` locks the phone's translational drift against the static laptop coordinate frame.

---

## 3. Volumetric Surface Classification & Depth Occlusion (5 Hz + 0.5 Hz)

### 3.1 RANSAC Plane Extraction & Elevation Taxonomy
`aether/processor.py` back-projects monocular depth maps into 3D point clouds and fits bounding planes via RANSAC, cross-referenced with **Gemini 2.5 Flash** structured 2D/3D semantic bounding boxes:

| Surface Class | Metric Elevation ($y$) | Normal $\vec{n}$ | AI Pet ("MAYA") Affordance & Physics Behavior |
| :--- | :--- | :--- | :--- |
| `FLOOR` | $0.00\text{ m} \pm 0.05\text{ m}$ | $[0, 1, 0]$ | Default walking, running, and landing surface. |
| `UNDER_BED_SHADOW_ZONE` | Cavity $y \in [0.00\text{ m}, 0.35\text{ m}]$ beneath overhang | $[0, 1, 0]$ | Target zone for `HIDE_UNDER_BED`; triggers low crouch posture + upper plane depth occlusion. |
| `CHAIR_OR_BED_SURFACE` | $0.40\text{ m} \text{ to } 0.60\text{ m}$ | $[0, 1, 0]$ | Target platform for `CLIMB_CHAIR` and `JUMP_ON_BED` ballistic trajectories. |
| `DESK_OR_TABLE` | $0.70\text{ m} \text{ to } 0.90\text{ m}$ | $[0, 1, 0]$ | High tabletop platform; acts as an obstacle or high perch. |
| `VERTICAL_OBSTACLE` | $y \in [0.00\text{ m}, 1.20\text{ m}]$ | $n_y \approx 0$ | Chair backs, bed frames, desk fronts; registered as Three.js depth-write occlusion masks. |

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

1. **`IDLE_SCAN`:** Breathes, blinks, and turns head toward the user's 6-DoF Cardboard head position.
2. **`WALK_ON_SURFACE`:** Moves toward target waypoint $(x, z)$ while clamping foot elevation $y$ to the active supporting plane (`FLOOR`, `CHAIR_OR_BED_SURFACE`, or `DESK_OR_TABLE`). If walking off a plane edge, gravity ($g = 9.81\text{ m/s}^2$) drops MAYA back to `FLOOR`.
3. **`CLIMB_CHAIR` / `JUMP_ON_BED`:** Triggered when `INDEX_POINT` raycasts onto a `CHAIR_OR_BED_SURFACE` or via semantic command. Solves a parabolic arc:
   $$y(t) = y_0 + v_{y0} t - \frac{1}{2} g t^2, \quad v_{y0} = \sqrt{2g(y_{\text{peak}} - y_0)}$$
   with pitch tilt during takeoff and landing compression upon touching the seat/bed plane.
4. **`HIDE_UNDER_BED` / `HIDE_BEHIND_OBSTACLE`:** Triggered by `TWO_HAND_SHOO` gesture, loud noise, or "hide" command. MAYA sprints to the nearest `UNDER_BED_SHADOW_ZONE` or behind a `VERTICAL_OBSTACLE`, lowers body height by 50%, and peeks out while occluded by the physical bed/chair geometry.
5. **`FOLLOW_USER` (`PINCH` / `GRAB`):** Tracks the fused 3D hand coordinate or follows 1.0 meter ahead of the user's Cardboard headset trajectory across the room.
6. **`SIT_STAY` (`FIST`):** Lowers hindquarters onto the current surface plane (whether on the floor, a chair, or the bed).
7. **`GREET_WAVE` (`OPEN_PALM`):** Raises front paw and displays contextual spatial HUD speech.

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
    "quaternion": { "x": 0.01, "y": -0.18, "z": 0.00, "w": 0.98 },
    "euler": { "alpha": 21.4, "beta": 82.1, "gamma": -1.2 },
    "trackingSource": "WEBXR_6DOF_OR_VIO"
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
    "weights": { "phone": 0.65, "laptop": 0.35 },
    "wristWorld": { "x": 0.15, "y": 1.10, "z": -0.85 },
    "raycastTarget": { "x": 0.80, "y": 0.45, "z": -1.60, "surfaceId": "plane_chair_1" }
  },
  "roomPlanes": [
    {
      "id": "plane_floor_0",
      "class": "FLOOR",
      "center": { "x": 0.0, "y": 0.0, "z": -1.5 },
      "extents": { "w": 4.0, "d": 4.0, "h": 0.02 }
    },
    {
      "id": "plane_chair_1",
      "class": "CHAIR_OR_BED_SURFACE",
      "semanticLabel": "wooden_chair",
      "center": { "x": 0.80, "y": 0.45, "z": -1.60 },
      "extents": { "w": 0.55, "d": 0.55, "h": 0.45 },
      "occluder": true
    },
    {
      "id": "zone_under_bed_1",
      "class": "UNDER_BED_SHADOW_ZONE",
      "semanticLabel": "under_bed",
      "center": { "x": -1.10, "y": 0.0, "z": -2.10 },
      "extents": { "w": 1.40, "d": 1.90, "h": 0.32 },
      "overhangElevation": 0.35,
      "occluder": true
    }
  ],
  "petDirective": {
    "state": "CLIMB_CHAIR",
    "targetSurfaceId": "plane_chair_1",
    "targetPosition": { "x": 0.80, "y": 0.45, "z": -1.60 },
    "speechHud": "Jumping up onto the wooden chair! 🐾🪑"
  }
}
```

---

## 6. Gemini 2.5 Flash Structured Scene Graph Schema (`aether/processor.py`)
In the 0.5 Hz Slow Loop, Aether sends the latest camera snapshot(s) to `gemini-2.5-flash` using `response_mime_type="application/json"` with the following schema:
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

<div align="center">
  <i>MAYAwe Technical Specification &bull; Distributed Spatial Systems</i>
</div>
