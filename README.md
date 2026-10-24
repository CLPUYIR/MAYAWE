<div align="center">
  <h1>🌐 MAYAwe V2</h1>
  <h3>Co-Located Dual-Camera Stereoscopic AR & Volumetric 3D AI Pet Ecosystem</h3>
  <p><i>Democratizing room-scale spatial computing using a Google Cardboard headset, a laptop webcam, and multimodal cloud AI.</i></p>
  
  <p>
    <img src="https://img.shields.io/badge/Version-MAYAwe_V2.0-blue" alt="Version" />
    <img src="https://img.shields.io/badge/Headset-Google_Cardboard_Stereo-orange" alt="Headset" />
    <img src="https://img.shields.io/badge/Dual_Camera-Inside_Out_+_Outside_In-green" alt="Dual Camera" />
    <img src="https://img.shields.io/badge/Physics-Heuristic_3D_Planes-purple" alt="Physics" />
    <img src="https://img.shields.io/badge/Tracking-60Hz_IMU_+_WebXR-cyan" alt="Tracking" />
  </p>
</div>

---

## 👁️ The MAYAwe V2 Vision

**MAYAwe V2** transforms everyday consumer hardware into a hands-free, room-scale spatial computing ecosystem. By pairing an Inside-Out smartphone camera strapped inside a **Google Cardboard headset** with an Outside-In **laptop webcam** in a shared 3D World Coordinate Frame, your articulated virtual companion (**"MAYA"**) physically inhabits your room:
- **Climbs Chairs & Jumps onto Beds:** Solves parabolic ballistic jump arcs ($y(t) = y_0 + v_{y0}t - \frac{1}{2}gt^2$) onto real detected furniture.
- **Hides Under the Bed & Behind Desks:** Pathfinds to detected under-bed shadow cavities, crouches low, and utilizes **Invisible Depth-Occlusion Masks** (`colorWrite: false, depthWrite: true`) so real-world furniture physically occludes her 3D body!
- **Dual-Camera Hand Tracking Handover:** MediaPipe runs on both the laptop webcam (tracking wide two-handed gestures at your desk) and the phone's rear camera (tracking interactions when roaming room-scale in Cardboard).

---

## 🏗️ 3-Tier Distributed Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: 📱 MOBILE IMAGER (Smartphone in Google Cardboard Headset)          │
│ • Stereoscopic Split-Screen WebGL (60 FPS dual scissor viewports)          │
│ • Low-Latency Orientation Tracking & 6-DoF VIO Fallback                   │
│ • Invisible Depth-Occlusion Proxies (Clips MAYA behind real furniture)     │
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
│ TIER 3: 🧠 AETHER SPATIAL INTELLIGENCE (Python Multi-Loop Solver)          │
│ • FAST LOOP (30 Hz): Dual-Camera MediaPipe Hands with Source Selection     │
│ • MEDIUM LOOP (5 Hz): Heuristic Contour & Elevation 3D Furniture Planes    │
│ • SLOW LOOP (0.5 Hz): Gemini 2.5 Flash Structured JSON Scene Graph         │
│   (or local OpenCV contour/saliency solver offline)                        │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Implementation Status

| Subsystem / Feature | Status | Implementation Notes |
| :--- | :--- | :--- |
| **Google Cardboard Stereo** | Implemented | Dual WebGL scissor viewports (`cameraLeft`, `cameraRight`) with 64mm IPD separation and physical center divider. |
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

## 🪑 Furniture Affordance & Physics State Machine

| State | Trigger | Physical Behavior |
| :--- | :--- | :--- |
| `IDLE_SCAN` | Default / Resting | Breathes, blinks, and turns head toward user's Cardboard headset. |
| `WALK_ON_SURFACE` | Target Waypoint | Clamps feet to supporting plane (`FLOOR`, `CHAIR`, `DESK`). Drops to floor if stepping off edge. |
| `CLIMB_CHAIR` / `JUMP_ON_BED` | Pointing at chair (`INDEX_POINT`) or command | Solves parabolic ballistic jump ($v_{y0} = \sqrt{2g \Delta y}$) and lands accurately on seat plane. |
| `HIDE_UNDER_BED` | "Hide" command or danger gesture | Sprints to under-bed zone, crouches 50%, and hides behind real bed frame depth occluder. |
| `FOLLOW_USER` | `PINCH` / `GRAB` gesture | Follows 1.0 meter in front of user's Cardboard trajectory across the room. |
| `SIT_STAY` | `FIST` gesture | Lowers hindquarters onto current surface plane. |
| `GREET_WAVE` | `OPEN_PALM` gesture | Raises front paw and displays contextual spatial HUD speech. |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** v18+ (tested on v24.x)
- **Python** 3.9 - 3.12 recommended for official MediaPipe wheels (3.13+ supported via experimental tasks wheel or synthetic mode)
- **Smartphone & Laptop** connected to the **same Wi-Fi network**
- *(Optional)* Google Cardboard headset or phone VR goggles

---

### Step 1: Start the Nexus Spatial Broker

```powershell
cd nexus
npm install
npm start
```

Nexus automatically creates a local self-signed TLS certificate and displays your local IP:
```text
================================================================
       MAYAwe V2 — Co-Located Spatial Broker & AR Hub            
================================================================
[*] TLS Certificate: Cached (cert.pem)
[*] PC LAN IP:       192.168.1.8
----------------------------------------------------------------
>>> MOBILE AR CLIENT (Open on Phone in Cardboard):
    https://192.168.1.8:8443/imager
----------------------------------------------------------------
>>> PC 3D SPATIAL DASHBOARD (Open on Laptop):
    https://localhost:8443/dashboard
================================================================
```

---

### Step 2: Start the Aether Spatial Intelligence Engine

In a second terminal:

```powershell
cd aether
pip install -r requirements.txt
python processor.py
```

> **Optional Gemini API Key:**  
> Set `$env:GEMINI_API_KEY="your-api-key"` (or `export GEMINI_API_KEY=...`) to enable Gemini 2.5 Flash Structured JSON scene descriptions. If unset, Aether runs 100% offline using an integrated OpenCV contour & color saliency solver!

---

### Step 3: Launch Mobile AR View (On Smartphone)

1. Open `https://<PC_LAN_IP>:8443/imager` in Chrome or Safari on your phone.
2. Accept the self-signed certificate (Tap **Advanced** → **Proceed (unsafe)**).
3. Tap **Start Spatial Experience**.
4. **Cardboard Mode:** Tap **"🥽 Cardboard Mode"** to toggle stereoscopic split-screen mode, slide your phone into your Google Cardboard headset, and look around your room!
5. **Debug Planes:** Tap **"📐 Debug Planes"** to visualize detected floor, chair, bed, and desk colliders.
6. **WebXR Tracking:** Tap **"📱 WebXR Tracking"** to opt in to native 6-DoF WebXR tracking (on supported Chrome Android devices). If unsupported, the app seamlessly uses 60Hz fused IMU orientation.

---

### Step 4: Open the PC 3D Spatial Dashboard

Open `https://localhost:8443/dashboard` on your laptop to observe:
- **Both Camera Frustums** in the shared room coordinate system.
- **Dual-Camera Hand Tracking** skeleton with dynamic confidence weights (`w_phone` vs `w_laptop`).
- **Detected 3D Furniture Planes** with live elevation metrics.
- **Behavior Buttons:** Click `🪑 Climb Chair` or `🫣 Hide Under Bed` to trigger animations!

---

## 🧪 Running Automated Tests

Run the full end-to-end test suite (Nexus endpoints, Aether smoke tests, directive flow integration):

```powershell
cd nexus
npm test
```

Or run via the test runner scripts:
- **Windows:** `.\tests\run_all.bat`
- **Linux / macOS:** `./tests/run_all.sh`

---

## 🔧 Troubleshooting

### Self-Signed TLS Certificate Warning (Mobile Chrome / Android)
- When navigating to `https://<PC_LAN_IP>:8443/imager`, mobile Chrome will warn *"Your connection is not private"*.
- Tap **Advanced** → **Proceed to `<PC_LAN_IP>` (unsafe)**. This one-time step is required because modern mobile browsers require HTTPS for camera (`getUserMedia`) and device orientation sensors.

### iOS Safari Limitations & Workarounds
- **WSS WebSocket Security:** iOS Safari blocks secure WebSocket (`wss://`) connections to self-signed origins unless the user has visited and trusted the HTTPS certificate on port 8443 in Safari first. Always open `https://<PC_LAN_IP>:8443/imager` in Safari directly.
- **WebXR Device API:** Standard iOS Safari does not natively support the WebXR Device API (`navigator.xr`). On iOS, MAYAwe automatically falls back to 60Hz fused IMU orientation tracking (`DeviceOrientationEvent` / `DeviceMotionEvent`), which runs smoothly in Google Cardboard. True 6-DoF WebXR on iOS requires a WebXR-compatible browser (e.g. WebXR Viewer).

### Python & MediaPipe Installation on Python 3.13 / 3.14
- Official `mediapipe` binary wheels on PyPI support Python 3.9 through 3.12.
- If running Python 3.13 or 3.14, `pip install mediapipe` may fail. You can install an experimental Tasks wheel, run in a Python 3.11/3.12 virtual environment, or allow Aether to run in autonomous `SYNTHETIC` mode.

---

## 📂 Repository Layout

```
MAYAwe/
├── GEMINI.md                     # Agent context & architectural rules
├── BLUEPRINT.md                  # Comprehensive V2 technical specification
├── README.md                     # Quick start & documentation
├── .gitignore                    # Ignores certificates, dependencies, models
├── tests/                        # Automated unit, smoke, and integration test suite
│   ├── test_nexus.js             # Nexus syntax and HTTP/HTTPS /api/status test
│   ├── test_aether_smoke.py      # Gestures, plane estimators, and component smoke test
│   ├── test_directive_flow.js    # Sequence-tracked directive integration test
│   ├── run_all.bat               # Windows batch test runner
│   └── run_all.sh                # Linux/macOS bash test runner
├── nexus/                        # PC Coordinator & Spatial Broker
│   ├── generate_cert.js          # Self-signed TLS certificate generator for LAN
│   ├── server.js                 # Unified HTTPS:8443 / WSS spatial broker
│   ├── package.json              # Express, ws, selfsigned
│   └── public/                   # PC 3D Spatial Dashboard
│       ├── index.html            # Three.js 3D visualizer (Frustums + Hands + Planes)
│       └── js/three.min.js       # Offline Three.js library
├── imager/                       # Mobile Cardboard AR Client
│   └── web-client/
│       ├── index.html            # Stereoscopic split-screen viewport & AR HUD
│       └── js/
│           ├── sensors.js        # 6-DoF VIO, WebXR pose, and IMU dead reckoning
│           ├── stream.js         # Bidirectional WSS:8443 streaming engine
│           ├── main.js           # Three.js Cardboard stereo, pose sync & furniture physics
│           └── three.min.js      # Offline Three.js library
└── aether/                       # Spatial AI & SLAM Layer
    ├── processor.py              # Multi-loop engine (30Hz dual-cam, 5Hz planes, 0.5Hz VLM)
    ├── requirements.txt          # websockets, numpy, opencv-python, mediapipe, google-genai
    └── models/
        └── hand_landmarker.task  # Pre-packaged MediaPipe hand landmark model
```

---

<div align="center">
  <i>Built with ❤️ by Abhishek Karthik PS &bull; MAYAwe V2 Spatial Systems</i>
</div>
