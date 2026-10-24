# MAYAwe V2 — Gemini CLI Agent Context & Engineering Rules

@./BLUEPRINT.md

## Project Identity
- **Repository:** `abhishekkarthikps/MAYAWE` (Upgrading from V1 MVP to **MAYAwe V2**)
- **Architecture:** 3-Tier Distributed Spatial Computing & Stereoscopic Google Cardboard AR Pet Ecosystem (`imager` + `nexus` + `aether`).
- **Core Goal:** Enable the 3D articulated robot pet ("MAYA") to physically inhabit the user's room—climbing onto real chairs/beds, hiding under beds/behind desks with real-time depth occlusion, and responding to fused Inside-Out (Phone) + Outside-In (Laptop) hand gestures.

## Commands & Validation Workflow
- **Install Nexus (Node.js Hub):** `cd nexus && npm install`
- **Start Nexus Server:** `cd nexus && npm start` (Runs HTTPS/WSS on port `8443`)
- **Syntax-Check Nexus:** `node --check nexus/server.js && node --check nexus/generate_cert.js`
- **Install Aether (Python Spatial AI):** `cd aether && pip install -r requirements.txt`
- **Syntax-Check Aether:** `python -m py_compile aether/processor.py`
- **Verify Loaded Context in CLI:** Run `/memory show` or `/memory refresh` after modifying `GEMINI.md` or `BLUEPRINT.md`.

## Strict Architectural & Code Guardrails (DO NOT VIOLATE)
1. **Preserve Self-Signed LAN TLS (`nexus/generate_cert.js`):** Mobile browsers block `DeviceOrientationEvent`, `DeviceMotionEvent`, WebXR, and `navigator.mediaDevices.getUserMedia` over insecure LAN IPs. Never downgrade `HTTPS`/`WSS:8443` to plain HTTP/WS.
2. **Preserve Zero-Latency Local Passthrough:** Never route the 60 FPS video display stream through the PC and back to the phone screen. The phone (`imager/`) must render the camera feed and Three.js stereoscopic scene locally on-device (<15ms motion-to-photon latency), sending only 60 Hz IMU quaternions, 15 Hz low-res (`640x360`) CV keyframes, and 0.5 Hz semantic snapshots to `Nexus`.
3. **Preserve Gimbal & Quaternion Math:** Always retain the shortest-arc angular wrap-around solver `(angle - last_angle + 180) % 360 - 180`, Quaternion dot-product hemisphere checks, and EMA noise filtering in `imager/web-client/js/sensors.js` and `aether/processor.py`.
4. **Offline & Hardware Fallbacks Required:**
   - If `GEMINI_API_KEY` is not set in the environment, `aether/processor.py` MUST automatically fall back to the local OpenCV contour, disparity, and color-saliency solver without crashing.
   - If `Depth-Anything-V2` ONNX/PyTorch weights are unavailable, fall back to a geometric homography + floor-horizon elevation estimator so `roomPlanes` packets are always emitted.
   - Use the new `google-genai` SDK (`from google import genai`) targeting `gemini-2.5-flash` with Structured JSON Schema outputs.
5. **No External CDN Lock-In for Core Rendering:** Keep `three.min.js` working offline in `imager/web-client/js/three.min.js` and `nexus/public/js/three.min.js`.

## Module-Specific Implementation Rules
- **`imager/web-client/` (Mobile Client):**
  - Implement a UI toggle button (`[Cardboard Stereo Mode: OFF/ON]`) that splits the WebGL renderer into left/right stereo viewports using `THREE.ScissorTest`, applies barrel distortion compensation, and updates eye camera matrices via Asynchronous TimeWarp (ATW) using the latest 60 Hz gyro quaternion.
  - Render received `roomPlanes` and `obstacles` in two modes: (a) **Invisible Depth-Occlusion Masks** (`colorWrite: false, depthWrite: true`, `renderOrder = 0`) during AR gameplay so MAYA is clipped behind real chairs/beds, and (b) **Wireframe Debug View** when toggled by the user.
- **`nexus/` (PC Broker & Dashboard):**
  - Maintain a unified state object containing `devices`, `phonePose6DoF`, `dualHandPose`, `roomPlanes`, and `petState`.
  - Render both the Laptop Camera Frustum and Phone Camera Frustum in `nexus/public/index.html`, plus 3D translucent surface planes (`FLOOR`, `CHAIR_OR_BED_SURFACE`, `DESK_OR_TABLE`, `UNDER_BED_SHADOW_ZONE`).
- **`aether/` (Spatial Intelligence Engine):**
  - Run three asynchronous loops:
    1. **Fast Loop (30 Hz):** Dual-camera MediaPipe Hands (`laptop_cam` Outside-In + `phone_stream` Inside-Out) fused via confidence weights `w_laptop` and `w_phone` into a shared World Frame.
    2. **Medium Loop (5 Hz):** Monocular metric depth + RANSAC 3D plane extraction classifying surfaces by metric height `y` (meters) above the floor.
    3. **Slow Loop (0.5 Hz):** `gemini-2.5-flash` multimodal scene graph & spatial affordance analyzer returning structured JSON bounding boxes and natural-language view assistance.
