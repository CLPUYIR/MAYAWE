<div align="center">
  <h1>🌐 MAYAwe</h1>
  <h3>Distributed Spatial Computing & AR AI Companion MVP</h3>
  <p><i>Democratizing spatial computing by transforming everyday smartphones and laptops into an interactive, synchronized AR ecosystem.</i></p>
  
  <p>
    <img src="https://img.shields.io/badge/Architecture-Distributed_Hybrid-blue" alt="Architecture" />
    <img src="https://img.shields.io/badge/Mobile_AR-Three.js_60FPS-cyan" alt="Mobile AR" />
    <img src="https://img.shields.io/badge/Hand_Tracking-MediaPipe_30Hz-green" alt="Hand Tracking" />
    <img src="https://img.shields.io/badge/AI_Core-Gemini_2.5_Flash-purple" alt="AI Core" />
    <img src="https://img.shields.io/badge/Security-Local_TLS_WSS-orange" alt="Security" />
  </p>
</div>

---

## 👁️ The Vision

**MAYAwe** is a distributed edge-cloud spatial computing ecosystem. Instead of requiring proprietary $3,500 AR headsets, MAYAwe orchestrates consumer hardware you already own:
1. **Your Smartphone**: Lightweight, zero-latency on-device AR rendering engine & 6DOF IMU spatial sensor.
2. **Your Laptop / PC**: Coordinate broker, high-frequency spatial hub, and outside-in 3D hand tracker.
3. **Aether Intelligence Layer**: Real-time gestural solver and dual-tier vision intelligence (Gemini 2.5 Flash + offline OpenCV).

---

## 🏗️ Architecture: Hybrid Distributed Hierarchy

```
   ┌───────────────────────────────────────────────────────────────┐
   │                  📱 Mobile Imager (Phone)                     │
   │  • On-Device Three.js AR View over live rear camera (60 FPS)   │
   │  • Articulated 3D Robot Pet ("MAYA") anchored in 3D Space      │
   │  • 60 Hz Telemetry (Fused Euler -> Unit Quaternion + Accel)   │
   │  • 0.5 Hz Camera Keyframe Snapshots for Semantic Analysis     │
   └───────────────────────────────┬───────────────────────────────┘
                                   │  Local Wi-Fi (HTTPS / WSS:8443)
                                   ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                   💻 Nexus Engine (PC Hub)                     │
   │  • Auto-Generated Self-Signed TLS Certificate for LAN          │
   │  • Unified Spatial State Broker (devices, handPose, petState) │
   │  • High-Speed WebSocket Relay (60 Hz IMU, 30 Hz Hand Pose)    │
   │  • Real-Time 3D Spatial Dashboard (https://localhost:8443)    │
   └───────────────────────────────┬───────────────────────────────┘
                                   │  Bidirectional WS Loop
                                   ▼
   ┌───────────────────────────────────────────────────────────────┐
   │              🧠 Aether Spatial Intelligence Engine             │
   │  • Fast Loop (30 Hz): MediaPipe Hands / Outside-In Webcam     │
   │    Gestures: OPEN_PALM, INDEX_POINT, PINCH/GRAB, FIST        │
   │  • Slow Loop (0.5 Hz): Gemini 2.5 Flash or Offline OpenCV     │
   │  • EMA Noise Filtering & Shortest-Arc Wrap-Around Solver      │
   └───────────────────────────────────────────────────────────────┘
```

---

## 🎮 Natural Gestures & AI Pet Reactions

Interact with the procedural 3D AI Pet ("MAYA") through your laptop webcam using outside-in hand tracking:

| Gesture | Vision Classification | Pet Behavior | Speech HUD Output |
| :--- | :--- | :--- | :--- |
| 🖐 **Wave / Open Palm** | All 5 fingers extended | Pet tilts and waves front paw in friendly greeting | *"Wave received! Hello friend! 🐾"* |
| 👉 **Index Point** | Index finger extended, others curled | Raycasts 3D pointing direction to project waypoint | *"Navigating to indicated target (X, Z) 🎯"* |
| 🤏 **Pinch / Grab** | Thumb & Index finger tips touching | Pet approaches and follows user's hand coordinates | *"Following user hand... 🐾"* |
| ✊ **Fist** | All fingers curled into fist | Pet lowers down to desk and sits obediently | *"Sitting down and staying. 🧘"* |
| 🚀 **High Jump** | Tap button or spatial trigger | Parabolic bounce with celebratory spin | *"Wheee! Excited leap! 🚀"* |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** v18+ (Node v20+ recommended)
- **Python** 3.10+
- **Smartphone & Laptop** connected to the **same local Wi-Fi network**

---

### Step 1: Start the Nexus Engine (Hub & Dashboard)

```bash
cd nexus
npm install
npm start
```

Upon startup, Nexus automatically generates a self-signed TLS certificate for your LAN IP and prints the connection banner:

```text
================================================================
            MAYAwe Nexus Distributed Spatial Engine              
================================================================
[*] TLS Certificate: Cached (cert.pem)
[*] PC LAN IP:       192.168.1.8
----------------------------------------------------------------
>>> MOBILE AR CLIENT (Open on Phone over Wi-Fi):
    https://192.168.1.8:8443/imager
----------------------------------------------------------------
>>> PC 3D SPATIAL DASHBOARD (Open on Laptop):
    https://localhost:8443/dashboard
================================================================
```

---

### Step 2: Start the Aether Spatial AI Engine

In a second terminal:

```bash
cd aether
pip install -r requirements.txt
python processor.py
```

> **Optional Gemini API Key:**  
> If you have a Gemini API key, set `export GEMINI_API_KEY="your-api-key"` (or `set GEMINI_API_KEY=your-api-key` on Windows) to enable semantic scene descriptions powered by `gemini-2.5-flash`.  
> *If no key is set, Aether runs 100% offline using an integrated OpenCV contour & color saliency detector.*

---

### Step 3: Launch the AR Imager on Your Smartphone

1. Open the URL printed by Nexus on your phone browser (e.g. `https://192.168.1.8:8443/imager`).
2. **Accepting Self-Signed Certificate:**
   - **Chrome on Android:** Tap **"Advanced"** → **"Proceed to 192.168.x.x (unsafe)"**.
   - **Safari on iOS:** Tap **"Show Details"** → **"visit this website"** → confirm passcode/FaceID.
3. Tap **"Start Spatial AR Experience"** to grant camera and motion sensor permissions.
4. Aim your phone at your desk or room. The 3D robot pet ("MAYA") will appear anchored in your space!

---

### Step 4: Open the PC 3D Spatial Dashboard

Open `https://localhost:8443/dashboard` on your laptop to view:
- **Real-time 3D Phone Twin**: Rotates live matching your smartphone's IMU Quaternion stream.
- **Real-time 3D Hand Skeleton**: 21-joint MediaPipe visualization with pointing laser raycast.
- **Camera Keyframe Preview**: Live 0.5 Hz image stream from your phone with semantic scene notes.
- **Spatial Command Injector**: Click buttons to test pet animations even without a camera.

---

## 🛡️ Browser Security & Physical Reality Compliance

Modern mobile browsers strictly enforce security rules for spatial sensors:
- **HTTPS & WSS Required**: `DeviceOrientationEvent`, `DeviceMotionEvent`, and `navigator.mediaDevices.getUserMedia` are completely blocked on non-localhost IP addresses unless served over HTTPS. Nexus resolves this with its built-in self-signed LAN certificate generator.
- **Zero-Latency Rendering**: Rather than compressing video, streaming it to the PC, and streaming it back (incurring 100+ ms of motion-to-photon latency), MAYAwe renders the AR overlay locally on the phone at 60 FPS using Three.js.
- **Shortest-Arc Angular Math**: Angle deltas are solved via `(angle - last_angle + 180) % 360 - 180` and Quaternion dot products, preventing false motion spikes at the 0°/360° boundary.

---

## 📂 Repository Layout

```
MAYAwe/
├── .gitignore                    # Ignores certificates, dependencies, virtualenvs
├── README.md                     # System documentation & setup guide
├── BLUEPRINT.md                  # Comprehensive architectural specification
├── nexus/                        # PC Coordinator & Spatial Broker
│   ├── generate_cert.js          # Self-signed TLS certificate generator for LAN
│   ├── server.js                 # Express + HTTPS/WSS unified server
│   ├── package.json              # Express, ws, selfsigned
│   └── public/                   # PC 3D Spatial Dashboard
│       ├── index.html            # Three.js 3D visualizer (Phone + Hand + Pet)
│       └── js/three.min.js       # Offline Three.js library
├── imager/                       # Mobile AR Client
│   └── web-client/
│       ├── index.html            # AR viewport with camera background & HUD
│       └── js/
│           ├── sensors.js        # 60 Hz synchronized IMU telemetry & Quaternion conversion
│           ├── stream.js         # Bidirectional WSS/WS streaming client
│           ├── main.js           # Three.js 3D AI Pet & camera orientation controller
│           └── three.min.js      # Offline Three.js library
└── aether/                       # Spatial AI & Vision Intelligence Layer
    ├── processor.py              # Dual-loop engine (30 Hz hand tracker + 0.5 Hz semantic AI)
    ├── requirements.txt          # websockets, numpy, opencv-python, mediapipe, google-genai
    └── models/
        └── hand_landmarker.task  # Pre-packaged MediaPipe hand landmark model
```

---

<div align="center">
  <i>MAYAwe — Distributed Spatial Systems</i>
</div>
