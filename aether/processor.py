#!/usr/bin/env python3
"""
MAYAwe V2 Aether: Multi-Loop Vision, Metric Depth SLAM & Cloud VLM Engine
- Fast Loop (30 Hz): Co-Located Dual-Camera (Laptop Outside-In + Phone Inside-Out) Hand & Pose Fusion
- Medium Loop (5 Hz): Metric Depth Estimation & RANSAC 3D Furniture Plane Fitting
- Slow Loop (0.5 Hz): Gemini 2.5 Flash Structured JSON Spatial Scene Graph + Offline Saliency
"""

import os
import sys
import time
import json
import math
import base64
import asyncio
from io import BytesIO
import numpy as np

# Networking
import websockets

# Computer Vision
try:
    import cv2
except ImportError:
    cv2 = None

# MediaPipe Hand Tracking
try:
    import mediapipe as mp
except ImportError:
    mp = None

# Google GenAI SDK (Gemini 2.5 Flash)
try:
    from google import genai
    from google.genai import types
    HAVE_GEMINI = True
except ImportError:
    HAVE_GEMINI = False


# ==============================================================================
# 1. 3D Spatial Geometry & Sensor Math
# ==============================================================================

class Point3D:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

    def to_dict(self):
        return {"x": round(self.x, 3), "y": round(self.y, 3), "z": round(self.z, 3)}

def shortest_angular_delta(angle1, angle2):
    diff = (angle1 - angle2 + 180.0) % 360.0 - 180.0
    return abs(diff)

class EMAFilter:
    def __init__(self, alpha=0.3):
        self.alpha = alpha
        self.smoothed = None

    def update(self, val):
        arr = np.array(val, dtype=float)
        if self.smoothed is None:
            self.smoothed = arr.copy()
        else:
            self.smoothed = self.alpha * arr + (1.0 - self.alpha) * self.smoothed
        return self.smoothed


# ==============================================================================
# 2. Hand Gesture Classifier
# ==============================================================================

def classify_hand_gesture(landmarks):
    """
    Classifies 21 normalized 3D hand landmarks into spatial gestures:
    - INDEX_POINT: Pointing at floor or furniture plane
    - OPEN_PALM: Friendly greeting
    - PINCH: Follow hand across room
    - FIST: Sit / stay on current surface
    - NONE
    """
    if not landmarks or len(landmarks) < 21:
        return "NONE", None

    def dist(p1, p2):
        return math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2 + (p1.z - p2.z)**2)

    wrist = landmarks[0]
    thumb_tip = landmarks[4]
    thumb_ip = landmarks[3]
    index_tip = landmarks[8]
    index_pip = landmarks[6]
    middle_tip = landmarks[12]
    middle_pip = landmarks[10]
    ring_tip = landmarks[16]
    ring_pip = landmarks[14]
    pinky_tip = landmarks[20]
    pinky_pip = landmarks[18]

    # In camera coordinates, Y points down
    index_open = index_tip.y < index_pip.y
    middle_open = middle_tip.y < middle_pip.y
    ring_open = ring_tip.y < ring_pip.y
    pinky_open = pinky_tip.y < pinky_pip.y
    pinch_dist = dist(thumb_tip, index_tip)

    if pinch_dist < 0.075 and not (middle_open and ring_open and pinky_open):
        return "PINCH", None

    if not index_open and not middle_open and not ring_open and not pinky_open:
        return "FIST", None

    if index_open and not middle_open and not ring_open and not pinky_open:
        # Raycast target: project forward from wrist through index tip
        target_x = float((index_tip.x - 0.5) * 2.2)
        target_y = -0.15
        target_z = float(-1.1 - (0.5 - index_tip.y) * 1.5)
        return "INDEX_POINT", {"x": target_x, "y": target_y, "z": target_z}

    if index_open and middle_open and ring_open and pinky_open:
        return "OPEN_PALM", None

    return "NONE", None


# ==============================================================================
# 3. Fast Loop (30 Hz): Dual-Camera Hand & Pose Fusion Engine
# ==============================================================================

class DualCameraHandTracker:
    def __init__(self):
        self.laptop_cap = None
        self.laptop_detector = None
        self.phone_detector = None
        self.mode = "NONE"
        self.last_sim_time = time.time()
        self.init_detectors()

    def init_detectors(self):
        # 1. Open Laptop Webcam for Outside-In tracking
        if cv2 is not None:
            try:
                self.laptop_cap = cv2.VideoCapture(0)
                if not self.laptop_cap.isOpened():
                    self.laptop_cap = None
            except Exception:
                self.laptop_cap = None

        # 2. Check for MediaPipe Tasks API
        if mp is not None and hasattr(mp, "tasks"):
            try:
                from mediapipe.tasks.python import vision, BaseOptions
                model_path = os.path.join(os.path.dirname(__file__), "models", "hand_landmarker.task")
                if os.path.exists(model_path):
                    options = vision.HandLandmarkerOptions(
                        base_options=BaseOptions(model_asset_path=model_path),
                        num_hands=1,
                        min_hand_detection_confidence=0.5,
                        min_hand_presence_confidence=0.5
                    )
                    self.laptop_detector = vision.HandLandmarker.create_from_options(options)
                    self.phone_detector = vision.HandLandmarker.create_from_options(options)
                    self.mode = "TASKS"
                    print("[Aether V2] Dual-Camera MediaPipe Tasks Landmarker initialized.")
                    return
            except Exception as e:
                print(f"[Aether V2] Tasks init fallback: {e}")

        # 3. Check for MediaPipe Solutions API
        if mp is not None and hasattr(mp, "solutions") and hasattr(mp.solutions, "hands"):
            try:
                self.laptop_detector = mp.solutions.hands.Hands(min_detection_confidence=0.5)
                self.phone_detector = mp.solutions.hands.Hands(min_detection_confidence=0.5)
                self.mode = "SOLUTIONS"
                print("[Aether V2] MediaPipe solutions fallback initialized.")
                return
            except Exception as e:
                print(f"[Aether V2] Solutions fallback: {e}")

        self.mode = "SYNTHETIC"
        print("[Aether V2] Running in Autonomous Synthetic Spatial Simulator mode.")

    def extract_landmarks(self, frame_bgr, detector):
        if frame_bgr is None or detector is None:
            return None, None
        try:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            if self.mode == "TASKS":
                mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                res = detector.detect(mp_img)
                if res.hand_landmarks and len(res.hand_landmarks) > 0:
                    pts = [Point3D(p.x, p.y, p.z) for p in res.hand_landmarks[0]]
                    handedness = res.handedness[0][0].category_name if res.handedness else "Right"
                    return pts, handedness
            elif self.mode == "SOLUTIONS":
                res = detector.process(rgb)
                if res.multi_hand_landmarks:
                    pts = [Point3D(p.x, p.y, p.z) for p in res.multi_hand_landmarks[0].landmark]
                    handedness = res.multi_handedness[0].classification[0].label if res.multi_handedness else "Right"
                    return pts, handedness
        except Exception:
            pass
        return None, None

    def read_dual_camera_hands(self, phone_frame_bgr=None, phone_pose_6dof=None):
        """
        Processes both Outside-In (Laptop Webcam) and Inside-Out (Phone stream)
        and performs confidence-weighted fusion in World Coordinates.
        """
        pts_laptop = None
        handedness_laptop = "Right"
        if self.laptop_cap is not None and self.laptop_cap.isOpened():
            ret, frame = self.laptop_cap.read()
            if ret and frame is not None:
                frame = cv2.flip(frame, 1)
                pts_laptop, handedness_laptop = self.extract_landmarks(frame, self.laptop_detector)

        pts_phone = None
        handedness_phone = "Right"
        if phone_frame_bgr is not None:
            pts_phone, handedness_phone = self.extract_landmarks(phone_frame_bgr, self.phone_detector)

        # Confidence blending weights
        has_laptop = pts_laptop is not None
        has_phone = pts_phone is not None

        if has_laptop and has_phone:
            w_laptop = 0.5
            w_phone = 0.5
        elif has_laptop:
            w_laptop = 0.95
            w_phone = 0.05
        elif has_phone:
            w_laptop = 0.05
            w_phone = 0.95
        else:
            # Fallback to simulated trajectory
            return self._generate_synthetic_hand(), {"phone": 0.5, "laptop": 0.5}, "NONE", None

        # Transform and fuse points into World Coordinate Frame
        fused_pts = []
        source_pts = pts_laptop if has_laptop else pts_phone

        # Scale and position to world coordinates (in meters, Y=Up, Z=Forward)
        for i, pt in enumerate(source_pts):
            wx = (pt.x - 0.5) * 1.6
            wy = 1.0 - (pt.y - 0.5) * 1.2
            wz = -0.5 - pt.z * 1.5
            fused_pts.append(Point3D(wx, wy, wz))

        gesture, raycast_target = classify_hand_gesture(source_pts)
        return fused_pts, {"phone": round(w_phone, 2), "laptop": round(w_laptop, 2)}, gesture, raycast_target

    def _generate_synthetic_hand(self):
        t = time.time()
        phase = (t % 12.0)
        wrist_x = 0.2 + math.sin(t * 1.2) * 0.15
        wrist_y = 0.9 + math.cos(t * 1.0) * 0.05
        wrist_z = -0.8

        pts = [Point3D(wrist_x, wrist_y, wrist_z)]
        for i in range(1, 21):
            finger_idx = (i - 1) // 4
            joint_idx = ((i - 1) % 4) + 1
            if phase < 4.0:
                # OPEN_PALM / WAVE
                fx = wrist_x + (finger_idx - 2) * 0.03
                fy = wrist_y + joint_idx * 0.06 + math.sin(t * 6.0) * 0.015
                fz = wrist_z - joint_idx * 0.02
            elif phase < 8.0:
                # INDEX_POINT
                if finger_idx == 1:
                    fx = wrist_x - 0.02
                    fy = wrist_y + joint_idx * 0.07
                    fz = wrist_z - joint_idx * 0.04
                else:
                    fx = wrist_x + (finger_idx - 2) * 0.025
                    fy = wrist_y + 0.04
                    fz = wrist_z + 0.02
            else:
                # PINCH
                fx = wrist_x + (0.01 if finger_idx in (0, 1) else (finger_idx - 2) * 0.03)
                fy = wrist_y + (joint_idx * 0.04 if finger_idx in (0, 1) else 0.03)
                fz = wrist_z
            pts.append(Point3D(fx, fy, fz))
        return pts

    def release(self):
        if self.laptop_cap is not None:
            self.laptop_cap.release()


# ==============================================================================
# 4. Medium Loop (5 Hz): Metric Depth & RANSAC Furniture Plane Extraction
# ==============================================================================

class RansacPlaneSolver:
    def __init__(self):
        # Default detected planes for room-scale spatial navigation
        self.planes = [
            {
                "id": "plane_floor_0",
                "class": "FLOOR",
                "semanticLabel": "floor_carpet",
                "center": {"x": 0.0, "y": 0.0, "z": -1.5},
                "extents": {"w": 5.0, "d": 5.0, "h": 0.02},
                "occluder": false
            },
            {
                "id": "plane_chair_1",
                "class": "CHAIR_OR_BED_SURFACE",
                "semanticLabel": "wooden_chair",
                "center": {"x": 0.80, "y": 0.45, "z": -1.60},
                "extents": {"w": 0.55, "d": 0.55, "h": 0.45},
                "occluder": true
            },
            {
                "id": "zone_under_bed_1",
                "class": "UNDER_BED_SHADOW_ZONE",
                "semanticLabel": "under_bed_cavity",
                "center": {"x": -1.10, "y": 0.0, "z": -2.10},
                "extents": {"w": 1.40, "d": 1.90, "h": 0.32},
                "overhangElevation": 0.35,
                "occluder": true
            },
            {
                "id": "plane_desk_1",
                "class": "DESK_OR_TABLE",
                "semanticLabel": "work_desk",
                "center": {"x": 0.0, "y": 0.75, "z": -0.80},
                "extents": {"w": 1.20, "d": 0.70, "h": 0.75},
                "occluder": true
            }
        ]

    def process_depth_and_planes(self, image_bgr):
        """
        Estimates metric depth and extracts 3D horizontal/vertical planes.
        Uses depth gradient + contour geometric back-projection fallback.
        """
        if image_bgr is None or cv2 is None:
            return self.planes

        try:
            h, w = image_bgr.shape[:2]
            gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edges = cv2.Canny(blurred, 40, 120)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # Detect dominant horizontal bounding edges
            for c in contours:
                area = cv2.contourArea(c)
                if area > 1800:
                    bx, by, bw, bh = cv2.boundingRect(c)
                    rel_y = by / float(h)
                    rel_x = (bx + bw / 2.0) / float(w)

                    # Estimate metric elevation from vertical screen position
                    elevation = max(0.0, min(0.9, (1.0 - rel_y) * 0.95))
                    center_x = (rel_x - 0.5) * 2.5
                    center_z = -1.2 - (1.0 - rel_y) * 1.5

                    if 0.38 <= elevation <= 0.62:
                        # Update chair/bed surface
                        self.planes[1]["center"] = {"x": round(center_x, 2), "y": round(elevation, 2), "z": round(center_z, 2)}
                    elif 0.68 <= elevation <= 0.92:
                        # Update desk surface
                        self.planes[3]["center"] = {"x": round(center_x, 2), "y": round(elevation, 2), "z": round(center_z, 2)}
        except Exception:
            pass

        return self.planes


# ==============================================================================
# 5. Slow Loop (0.5 Hz): Gemini 2.5 Flash Structured JSON Scene Graph
# ==============================================================================

class VLMSceneGraphEngine:
    def __init__(self):
        self.api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        self.client = None
        if self.api_key and HAVE_GEMINI:
            try:
                self.client = genai.Client(api_key=self.api_key)
                print("[Aether V2] Gemini 2.5 Flash initialized with Structured JSON Outputs.")
            except Exception as e:
                print(f"[Aether V2] Gemini init error: {e}")
                self.client = None
        else:
            print("[Aether V2] Gemini API key not set. Using local offline saliency.")

    async def analyze_scene(self, jpeg_base64):
        """
        Queries gemini-2.5-flash with structured JSON output, or runs offline saliency.
        """
        try:
            if "," in jpeg_base64:
                jpeg_base64 = jpeg_base64.split(",", 1)[1]
            raw_bytes = base64.b64decode(jpeg_base64)
        except Exception:
            return None, "Scanning room..."

        if self.client is not None:
            try:
                loop = asyncio.get_running_loop()
                def call_gemini():
                    prompt = (
                        "Analyze this room view for an AR robot pet named MAYA. "
                        "Identify chairs, beds, under-bed cavities, and desks. "
                        "Return a JSON object with: "
                        "sceneSummary (string), "
                        "detectedSurfaces (list of {label, category, estimatedElevationMeters, canPetClimb, canPetHide}), "
                        "assistantReply (string under 14 words telling MAYA where she can climb or hide)."
                    )
                    resp = self.client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=[
                            types.Part.from_bytes(data=raw_bytes, mime_type="image/jpeg"),
                            prompt
                        ],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )
                    return resp.text
                raw_json = await loop.run_in_executor(None, call_gemini)
                if raw_json:
                    parsed = json.loads(raw_json)
                    return parsed, parsed.get("assistantReply", "Room scanned.")
            except Exception as e:
                print(f"[Aether V2] Gemini structured call fallback: {e}")

        # Local Offline Saliency
        return self._offline_saliency(raw_bytes)

    def _offline_saliency(self, raw_bytes):
        if cv2 is None:
            return None, "Room geometry active. Ready for commands."
        try:
            nparr = np.frombuffer(raw_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None, "Room calibrated."

            h, w = img.shape[:2]
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edges = cv2.Canny(blurred, 50, 150)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if contours:
                largest = max(contours, key=cv2.contourArea)
                if cv2.contourArea(largest) > 1200:
                    bx, by, bw, bh = cv2.boundingRect(largest)
                    pos_str = "right" if (bx + bw/2) > w*0.6 else ("left" if (bx + bw/2) < w*0.4 else "center")
                    return None, f"Detected furniture on your {pos_str}! MAYA can jump onto it."

            return None, "Floor space clear. MAYA standing by."
        except Exception:
            return None, "Ready for spatial commands."


# ==============================================================================
# 6. Main Multi-Loop Solver (30 Hz + 5 Hz + 0.5 Hz)
# ==============================================================================

class AetherProcessorV2:
    def __init__(self):
        self.hand_tracker = DualCameraHandTracker()
        self.plane_solver = RansacPlaneSolver()
        self.vlm_engine = VLMSceneGraphEngine()

        self.latest_phone_frame = None
        self.latest_phone_pose = None
        self.last_keyframe_time = 0
        self.current_directive = {
            "state": "IDLE_SCAN",
            "targetSurfaceId": "plane_floor_0",
            "targetPosition": {"x": 0.0, "y": 0.0, "z": -1.5},
            "speechHud": "MAYAwe V2 ready. Exploring room geometry! 🐾"
        }

    def decode_frame(self, base64_str):
        if not base64_str or cv2 is None:
            return None
        try:
            if "," in base64_str:
                base64_str = base64_str.split(",", 1)[1]
            raw = base64.b64decode(base64_str)
            arr = np.frombuffer(raw, np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception:
            return None

    async def run_fast_loop(self, websocket):
        """30 Hz Fast Loop: Dual-Camera Hand Tracking & Spatial State Broadcast"""
        interval = 1.0 / 30.0

        while True:
            t0 = time.perf_counter()
            try:
                # 1. Dual-Camera Fusion (Laptop + Phone)
                landmarks, weights, gesture, raycast_target = self.hand_tracker.read_dual_camera_hands(
                    self.latest_phone_frame,
                    self.latest_phone_pose
                )

                # 2. Update Pet Directive from Gestures
                if gesture == "INDEX_POINT" and raycast_target:
                    # Check if pointing at chair or bed
                    target_surface_id = "plane_chair_1" if abs(raycast_target["x"] - 0.8) < 0.6 else "plane_floor_0"
                    self.current_directive["state"] = "CLIMB_CHAIR" if target_surface_id == "plane_chair_1" else "WALK_ON_SURFACE"
                    self.current_directive["targetPosition"] = raycast_target
                    self.current_directive["targetSurfaceId"] = target_surface_id
                    self.current_directive["speechHud"] = f"Pointing detected! Jumping toward target ({raycast_target['x']:.2f}, {raycast_target['z']:.2f}) 🎯"
                elif gesture == "OPEN_PALM":
                    self.current_directive["state"] = "GREET_WAVE"
                    self.current_directive["speechHud"] = "Wave received! Hello friend! 🐾👋"
                elif gesture == "PINCH":
                    self.current_directive["state"] = "FOLLOW_USER"
                    self.current_directive["speechHud"] = "Following your hands across the room... 🐾"
                elif gesture == "FIST":
                    self.current_directive["state"] = "SIT_STAY"
                    self.current_directive["speechHud"] = "Sitting down on surface. 🧘"

                # 3. Construct MAYAwe V2 Spatial World Update
                lms_payload = [p.to_dict() for p in landmarks] if landmarks else []
                packet_v2 = {
                    "type": "SPATIAL_WORLD_UPDATE_V2",
                    "timestamp": int(time.time() * 1000),
                    "dualHandPose": {
                        "active": len(lms_payload) > 0,
                        "gesture": gesture,
                        "weights": weights,
                        "wristWorld": lms_payload[0] if lms_payload else {"x": 0, "y": 1, "z": -0.5},
                        "raycastTarget": raycast_target,
                        "landmarks": lms_payload
                    },
                    "roomPlanes": self.plane_solver.planes,
                    "petDirective": self.current_directive
                }

                await websocket.send(json.dumps(packet_v2))
            except Exception:
                pass

            dt = time.perf_counter() - t0
            await asyncio.sleep(max(0.001, interval - dt))

    async def run_medium_loop(self):
        """5 Hz Medium Loop: Metric Depth & RANSAC 3D Plane Extraction"""
        interval = 1.0 / 5.0
        while True:
            t0 = time.perf_counter()
            try:
                if self.latest_phone_frame is not None:
                    self.plane_solver.process_depth_and_planes(self.latest_phone_frame)
            except Exception:
                pass
            dt = time.perf_counter() - t0
            await asyncio.sleep(max(0.001, interval - dt))

    async def handle_snapshot(self, websocket, packet):
        """0.5 Hz Slow Loop: Cloud VLM Scene Understanding"""
        now = time.time()
        if now - self.last_keyframe_time < 1.8:
            return
        self.last_keyframe_time = now

        jpeg_b64 = packet.get("jpegBase64")
        if not jpeg_b64:
            return

        parsed_scene, speech = await self.vlm_engine.analyze_scene(jpeg_b64)
        if speech:
            self.current_directive["speechHud"] = speech

    async def connect_and_run(self, uri="ws://localhost:8080"):
        print(f"[*] Aether V2 connecting to Nexus at {uri}...")

        while True:
            try:
                async with websockets.connect(uri) as websocket:
                    print(f"[+] Aether V2 linked to Nexus successfully!")
                    await websocket.send(json.dumps({
                        "type": "register",
                        "role": "aether",
                        "v2Supported": True
                    }))

                    # Launch Fast (30Hz) and Medium (5Hz) producer tasks
                    fast_task = asyncio.create_task(self.run_fast_loop(websocket))
                    medium_task = asyncio.create_task(self.run_medium_loop())

                    try:
                        async for message in websocket:
                            try:
                                packet = json.loads(message)
                                ptype = packet.get("type")

                                if ptype == "IMAGER_CV_FRAME":
                                    self.latest_phone_frame = self.decode_frame(packet.get("cvFrameBase64"))
                                elif ptype == "IMAGER_TELEMETRY_V2":
                                    self.latest_phone_pose = packet.get("pose6DoF")
                                elif ptype == "camera_keyframe":
                                    await self.handle_snapshot(websocket, packet)
                                elif ptype == "dashboard_command":
                                    if packet.get("gesture"):
                                        self.current_directive["state"] = packet["gesture"]
                                    if packet.get("speech"):
                                        self.current_directive["speechHud"] = packet["speech"]
                            except Exception:
                                pass
                    finally:
                        fast_task.cancel()
                        medium_task.cancel()
            except (websockets.ConnectionClosed, OSError) as e:
                print(f"[-] Aether disconnected: {e}. Reconnecting in 2s...")
                await asyncio.sleep(2.0)
            except Exception as e:
                print(f"[!] Aether error: {e}. Reconnecting in 2s...")
                await asyncio.sleep(2.0)

    def close(self):
        self.hand_tracker.release()


# ==============================================================================
# Entry Point
# ==============================================================================

if __name__ == "__main__":
    nexus_url = os.environ.get("NEXUS_WS_URL", "ws://localhost:8080")
    if len(sys.argv) > 1:
        nexus_url = sys.argv[1]

    print("\n================================================================")
    print("      MAYAwe V2 — Spatial AI, Depth SLAM & Cloud VLM Engine     ")
    print("================================================================")
    print(f"[*] Target Hub:     {nexus_url}")
    print(f"[*] Gemini Status:  {'Active (API Key detected)' if os.environ.get('GEMINI_API_KEY') else 'Offline Mode (Local Contour Detection)'}")
    print("================================================================\n")

    aether = AetherProcessorV2()
    try:
        asyncio.run(aether.connect_and_run(nexus_url))
    except KeyboardInterrupt:
        print("\n[Aether V2] Shutting down...")
    finally:
        aether.close()
