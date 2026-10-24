#!/usr/bin/env python3
"""
MAYAwe Aether: Dual-Loop Vision & Spatial AI Engine
Fast Loop (30 Hz): Outside-In Hand & Gesture Tracking via Laptop Webcam & MediaPipe
Slow Loop (0.5 Hz): Semantic Scene Understanding via Gemini 2.5 Flash / Offline OpenCV
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

# Computer Vision & Machine Learning
try:
    import cv2
except ImportError:
    cv2 = None

# MediaPipe Hand Tracking (Tasks API + Solutions fallback)
try:
    import mediapipe as mp
except ImportError:
    mp = None

# Optional Gemini Generative AI SDK
try:
    from google import genai
    from google.genai import types
    HAVE_GEMINI = True
except ImportError:
    HAVE_GEMINI = False


# ==============================================================================
# 1. Sensor Fusion & Filter Math
# ==============================================================================

def shortest_angular_delta(angle1, angle2):
    """
    Computes shortest-arc angular delta in degrees, eliminating 0°/360° wrap spikes.
    """
    diff = (angle1 - angle2 + 180.0) % 360.0 - 180.0
    return abs(diff)

def quaternion_dot_distance(q1, q2):
    """
    Computes angular distance between two unit quaternions: 2 * acos(|q1 . q2|).
    """
    dot = abs(q1[0]*q2[0] + q1[1]*q2[1] + q1[2]*q2[2] + q1[3]*q2[3])
    dot = min(1.0, max(-1.0, dot))
    return 2.0 * math.acos(dot)

class EMAFilter:
    """Exponential Moving Average (EMA) filter for noise smoothing."""
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
# 2. Hand Gesture Classification
# ==============================================================================

class Point3D:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x = float(x)
        self.y = float(y)
        self.z = float(z)

def classify_hand_gesture(landmarks):
    """
    Classifies 21 normalized 3D hand landmarks into spatial gestures:
    - OPEN_PALM / WAVE
    - INDEX_POINT
    - PINCH / GRAB
    - FIST
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
    index_mcp = landmarks[5]
    middle_tip = landmarks[12]
    middle_pip = landmarks[10]
    ring_tip = landmarks[16]
    ring_pip = landmarks[14]
    pinky_tip = landmarks[20]
    pinky_pip = landmarks[18]

    # In camera coordinates, Y goes down (0 = top, 1 = bottom)
    index_open = index_tip.y < index_pip.y
    middle_open = middle_tip.y < middle_pip.y
    ring_open = ring_tip.y < ring_pip.y
    pinky_open = pinky_tip.y < pinky_pip.y
    thumb_open = dist(thumb_tip, wrist) > dist(thumb_ip, wrist)

    pinch_distance = dist(thumb_tip, index_tip)

    # 1. PINCH / GRAB: Thumb & Index tips close together, others not widely open
    if pinch_distance < 0.075 and not (middle_open and ring_open and pinky_open):
        return "PINCH", None

    # 2. FIST: All 4 main fingers curled inwards
    if not index_open and not middle_open and not ring_open and not pinky_open:
        return "FIST", None

    # 3. INDEX_POINT: Index open, other 3 fingers closed
    if index_open and not middle_open and not ring_open and not pinky_open:
        # Raycast target: project forward from wrist through index knuckle & tip
        target_x = float((index_tip.x - 0.5) * 2.2)
        target_y = -0.15  # Desk ground plane
        target_z = float(-1.1 - (0.5 - index_tip.y) * 1.5)
        return "INDEX_POINT", {"x": target_x, "y": target_y, "z": target_z}

    # 4. OPEN_PALM / WAVE: All fingers extended
    if index_open and middle_open and ring_open and pinky_open:
        return "OPEN_PALM", None

    return "NONE", None


# ==============================================================================
# 3. Hand Tracker Engine (MediaPipe + Webcam + Synthetic Fallback)
# ==============================================================================

class HandTrackerEngine:
    def __init__(self):
        self.cap = None
        self.mode = "NONE" # "TASKS" | "SOLUTIONS" | "SYNTHETIC"
        self.detector = None
        self.last_sim_time = time.time()
        self.init_detector()

    def init_detector(self):
        # 1. Try opening webcam
        if cv2 is not None:
            try:
                self.cap = cv2.VideoCapture(0)
                if not self.cap.isOpened():
                    print("[Aether Vision] Webcam 0 unavailable. Switching to Synthetic Tracking.")
                    self.cap = None
            except Exception as e:
                print(f"[Aether Vision] Error opening webcam: {e}")
                self.cap = None

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
                    self.detector = vision.HandLandmarker.create_from_options(options)
                    self.mode = "TASKS"
                    print("[Aether Vision] Initialized MediaPipe HandLandmarker Tasks API.")
                    return
            except Exception as e:
                print(f"[Aether Vision] MediaPipe Tasks init fallback: {e}")

        # 3. Check for legacy MediaPipe Solutions API
        if mp is not None and hasattr(mp, "solutions") and hasattr(mp.solutions, "hands"):
            try:
                self.detector = mp.solutions.hands.Hands(
                    static_image_mode=False,
                    max_num_hands=1,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5
                )
                self.mode = "SOLUTIONS"
                print("[Aether Vision] Initialized legacy MediaPipe Hands solutions.")
                return
            except Exception as e:
                print(f"[Aether Vision] MediaPipe solutions fallback: {e}")

        # 4. Fallback to Synthetic / Simulated tracking
        self.mode = "SYNTHETIC"
        print("[Aether Vision] Operating in Autonomous Synthetic Spatial Simulator mode.")

    def read_landmarks(self):
        """Reads hand landmarks from webcam or generates synthetic spatial trajectory."""
        if self.cap is not None and self.cap.isOpened():
            ret, frame = self.cap.read()
            if ret and frame is not None:
                # Flip horizontally for natural mirror view
                frame = cv2.flip(frame, 1)
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                if self.mode == "TASKS" and self.detector:
                    try:
                        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                        res = self.detector.detect(mp_img)
                        if res.hand_landmarks and len(res.hand_landmarks) > 0:
                            raw_pts = res.hand_landmarks[0]
                            handedness = "Right"
                            if res.handedness and len(res.handedness) > 0:
                                handedness = res.handedness[0][0].category_name
                            pts = [Point3D(p.x, p.y, p.z) for p in raw_pts]
                            return pts, handedness
                    except Exception as e:
                        pass

                elif self.mode == "SOLUTIONS" and self.detector:
                    try:
                        res = self.detector.process(rgb)
                        if res.multi_hand_landmarks:
                            raw_pts = res.multi_hand_landmarks[0].landmark
                            handedness = "Right"
                            if res.multi_handedness:
                                handedness = res.multi_handedness[0].classification[0].label
                            pts = [Point3D(p.x, p.y, p.z) for p in raw_pts]
                            return pts, handedness
                    except Exception as e:
                        pass

        # Synthetic generator fallback
        return self._generate_synthetic_hand()

    def _generate_synthetic_hand(self):
        """Generates realistic 21-point hand skeleton for testing/simulation."""
        t = time.time()
        phase = (t % 12.0)
        wrist_x = 0.5 + math.sin(t * 1.5) * 0.18
        wrist_y = 0.65 + math.cos(t * 1.2) * 0.08
        wrist_z = -0.1

        pts = [Point3D(wrist_x, wrist_y, wrist_z)] # 0: Wrist

        # Simulate periodic gestures: 0-4s: Wave, 4-8s: Point, 8-12s: Pinch
        if phase < 4.0:
            # OPEN PALM / WAVE
            for i in range(1, 21):
                finger_idx = (i - 1) // 4
                joint_idx = ((i - 1) % 4) + 1
                fx = wrist_x + (finger_idx - 2) * 0.035
                fy = wrist_y - joint_idx * 0.075 + math.sin(t * 6.0) * 0.02
                fz = wrist_z - joint_idx * 0.015
                pts.append(Point3D(fx, fy, fz))
        elif phase < 8.0:
            # INDEX POINT
            for i in range(1, 21):
                finger_idx = (i - 1) // 4
                joint_idx = ((i - 1) % 4) + 1
                if finger_idx == 1: # Index finger extended
                    fx = wrist_x - 0.03
                    fy = wrist_y - joint_idx * 0.085
                    fz = wrist_z - joint_idx * 0.02
                else: # Other fingers curled
                    fx = wrist_x + (finger_idx - 2) * 0.03
                    fy = wrist_y - 0.06 - math.sin(joint_idx * 0.5) * 0.03
                    fz = wrist_z + 0.04
                pts.append(Point3D(fx, fy, fz))
        else:
            # PINCH
            for i in range(1, 21):
                finger_idx = (i - 1) // 4
                joint_idx = ((i - 1) % 4) + 1
                if finger_idx in (0, 1):
                    # Thumb and index meet
                    fx = wrist_x + (0.01 if finger_idx == 0 else -0.01)
                    fy = wrist_y - 0.18
                    fz = wrist_z
                else:
                    fx = wrist_x + (finger_idx - 2) * 0.03
                    fy = wrist_y - 0.06
                    fz = wrist_z + 0.03
                pts.append(Point3D(fx, fy, fz))

        return pts, "Right"

    def release(self):
        if self.cap is not None:
            self.cap.release()
        if self.detector is not None and hasattr(self.detector, "close"):
            self.detector.close()


# ==============================================================================
# 4. Semantic Scene Understanding (Gemini 2.5 Flash + OpenCV Offline Fallback)
# ==============================================================================

class SemanticSceneEngine:
    def __init__(self):
        self.api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        self.client = None
        if self.api_key and HAVE_GEMINI:
            try:
                self.client = genai.Client(api_key=self.api_key)
                print("[Aether Semantic] Google GenAI client initialized with Gemini 2.5 Flash.")
            except Exception as e:
                print(f"[Aether Semantic] GenAI init error: {e}")
                self.client = None
        else:
            print("[Aether Semantic] Running in 100% Offline Salient-Object Vision Mode.")

    async def analyze_keyframe(self, jpeg_base64):
        """
        Processes keyframe:
        Calls gemini-2.5-flash if API key is configured,
        or performs local OpenCV contour/salient-color detection offline.
        """
        try:
            # Strip data URL header if present
            if "," in jpeg_base64:
                jpeg_base64 = jpeg_base64.split(",", 1)[1]
            raw_bytes = base64.b64decode(jpeg_base64)
        except Exception as e:
            return "Corrupted keyframe snapshot."

        # Online Gemini Analysis
        if self.client is not None:
            try:
                loop = asyncio.get_running_loop()
                def call_gemini():
                    response = self.client.models.generate_content(
                        model="gemini-2.5-flash",
                        contents=[
                            types.Part.from_bytes(data=raw_bytes, mime_type="image/jpeg"),
                            "You are the spatial AI companion brain of an AR pet named MAYA. In 1 concise sentence under 14 words, identify what object/workspace item is visible and tell the pet what playful action to do."
                        ]
                    )
                    return response.text.strip() if response and response.text else None

                text = await loop.run_in_executor(None, call_gemini)
                if text:
                    return text
            except Exception as e:
                print(f"[Aether Semantic] Gemini API error: {e}. Falling back to offline OpenCV.")

        # Offline Local OpenCV Salient Feature Extraction
        return self._offline_analyze(raw_bytes)

    def _offline_analyze(self, raw_bytes):
        if cv2 is None:
            return "Desk surface detected. Companion ready."

        try:
            nparr = np.frombuffer(raw_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return "Desktop workspace calibrated."

            h, w = img.shape[:2]
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)

            # Edge and contour detection
            edges = cv2.Canny(blurred, 50, 150)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if contours:
                largest = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(largest)
                if area > 800:
                    x, y, cw, ch = cv2.boundingRect(largest)
                    center_x = x + cw / 2.0
                    pos_label = "center" if abs(center_x - w/2) < w*0.2 else ("left" if center_x < w/2 else "right")
                    
                    # Sample dominant color in region
                    roi = img[y:y+ch, x:x+cw]
                    mean_color = cv2.mean(roi)[:3] # BGR
                    b, g, r = mean_color
                    color_name = "blue" if b > max(g, r) + 20 else ("green" if g > max(b, r) + 20 else ("warm" if r > max(b, g) + 20 else "contrasting"))
                    return f"Detected a prominent {color_name} object on the {pos_label}! Exploring waypoint."

            return "Clear desk area visible. AI Pet standing by for gestures."
        except Exception as e:
            return "Workspace detected. Ready for commands."


# ==============================================================================
# 5. Main Aether Processor Hub
# ==============================================================================

class AetherProcessor:
    def __init__(self):
        self.last_pose = None
        self.accel_filter = EMAFilter(alpha=0.25)
        self.quat_filter = EMAFilter(alpha=0.35)
        self.hand_tracker = HandTrackerEngine()
        self.semantic_engine = SemanticSceneEngine()
        self.current_pet_state = {
            "mode": "IDLE",
            "position": {"x": 0.0, "y": -0.15, "z": -1.5},
            "targetPosition": {"x": 0.0, "y": -0.15, "z": -1.5},
            "speechText": "Aether Intelligence Core linked."
        }
        self.last_keyframe_process_time = 0

    async def handle_telemetry(self, packet):
        """Processes high-frequency phone telemetry with wrap-around filtering."""
        device_id = packet.get("deviceId", "unknown")
        data = packet.get("data", {})
        rot = data.get("rotation", {})
        quat = data.get("quaternion", {})
        acc = data.get("acceleration", {})

        # 1. EMA Filter on Acceleration
        raw_acc = [acc.get("x", 0.0), acc.get("y", 0.0), acc.get("z", 0.0)]
        filtered_acc = self.accel_filter.update(raw_acc)

        # 2. Shortest-arc wrap-around detection
        alpha = rot.get("alpha", 0.0)
        beta = rot.get("beta", 0.0)
        gamma = rot.get("gamma", 0.0)

        if self.last_pose:
            d_alpha = shortest_angular_delta(alpha, self.last_pose['alpha'])
            d_beta = shortest_angular_delta(beta, self.last_pose['beta'])
            d_gamma = shortest_angular_delta(gamma, self.last_pose['gamma'])

            # Motion trigger without false spikes at 0/360 boundary
            if d_alpha > 45 or d_beta > 45:
                # Fast motion detected
                pass

        self.last_pose = {'alpha': alpha, 'beta': beta, 'gamma': gamma}

    async def handle_keyframe(self, websocket, packet):
        """Processes 0.5 Hz camera keyframe for deep scene understanding."""
        now = time.time()
        if now - self.last_keyframe_process_time < 1.8:
            return  # Rate limit

        self.last_keyframe_process_time = now
        jpeg_base64 = packet.get("jpegBase64")
        if not jpeg_base64:
            return

        speech_text = await self.semantic_engine.analyze_keyframe(jpeg_base64)
        self.current_pet_state["speechText"] = speech_text

        out_packet = {
            "type": "spatial_state",
            "source": "aether",
            "timestamp": int(time.time() * 1000),
            "petState": self.current_pet_state,
            "speech": speech_text
        }
        await websocket.send(json.dumps(out_packet))

    async def run_fast_hand_loop(self, websocket):
        """30 Hz Fast Loop: Tracks hand landmarks & streams spatial_state to Nexus."""
        interval = 1.0 / 30.0  # 30 Hz

        while True:
            t_start = time.perf_counter()

            try:
                landmarks, handedness = self.hand_tracker.read_landmarks()
                gesture, target_wp = classify_hand_gesture(landmarks)

                # Map gesture to pet behavior
                if gesture == "OPEN_PALM":
                    self.current_pet_state["mode"] = "WAVE"
                    speech = "Wave received! Hello friend! 🐾"
                elif gesture == "INDEX_POINT" and target_wp:
                    self.current_pet_state["mode"] = "WALK"
                    self.current_pet_state["targetPosition"] = target_wp
                    speech = f"Navigating to indicated target ({target_wp['x']:.2f}, {target_wp['z']:.2f}) 🎯"
                elif gesture == "PINCH":
                    self.current_pet_state["mode"] = "APPROACH"
                    if landmarks and len(landmarks) > 8:
                        self.current_pet_state["targetPosition"] = {
                            "x": float((landmarks[8].x - 0.5) * 1.5),
                            "y": -0.15,
                            "z": -1.0
                        }
                    speech = "Following user hand... 🐾"
                elif gesture == "FIST":
                    self.current_pet_state["mode"] = "STAY"
                    speech = "Sitting down and staying. 🧘"
                else:
                    if self.current_pet_state["mode"] not in ("JUMP", "WAVE"):
                        self.current_pet_state["mode"] = "IDLE"
                    speech = self.current_pet_state["speechText"]

                # Serialize landmarks
                lms_payload = [{"x": p.x, "y": p.y, "z": p.z} for p in landmarks] if landmarks else []

                packet = {
                    "type": "spatial_state",
                    "source": "aether",
                    "timestamp": int(time.time() * 1000),
                    "handPose": {
                        "landmarks": lms_payload,
                        "handedness": handedness,
                        "confidence": 0.95
                    },
                    "gesture": gesture,
                    "petState": self.current_pet_state,
                    "speech": speech
                }

                await websocket.send(json.dumps(packet))

            except Exception as e:
                # Catch send errors or connection drops
                pass

            elapsed = time.perf_counter() - t_start
            sleep_time = max(0.001, interval - elapsed)
            await asyncio.sleep(sleep_time)

    async def connect_and_run(self, uri="ws://localhost:8080"):
        """Main connection and bidirectional event loop."""
        print(f"[*] Aether connecting to Nexus at {uri}...")

        while True:
            try:
                async with websockets.connect(uri) as websocket:
                    print(f"[+] Aether connected to Nexus successfully!")

                    # Register role
                    await websocket.send(json.dumps({
                        "type": "register",
                        "role": "aether"
                    }))

                    # Start 30Hz fast hand tracking producer task
                    fast_task = asyncio.create_task(self.run_fast_hand_loop(websocket))

                    try:
                        async for message in websocket:
                            try:
                                packet = json.loads(message)
                                ptype = packet.get("type")
                                if ptype == "telemetry":
                                    await self.handle_telemetry(packet)
                                elif ptype == "camera_keyframe":
                                    await self.handle_keyframe(websocket, packet)
                            except Exception as e:
                                pass
                    finally:
                        fast_task.cancel()

            except (websockets.ConnectionClosed, OSError) as e:
                print(f"[-] Aether disconnected: {e}. Retrying in 2s...")
                await asyncio.sleep(2.0)
            except Exception as e:
                print(f"[!] Aether unexpected error: {e}. Retrying in 2s...")
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
    print("             MAYAwe Aether Intelligence Engine                  ")
    print("================================================================")
    print(f"[*] Target Nexus:   {nexus_url}")
    print(f"[*] Gemini Status:  {'Active (API Key detected)' if os.environ.get('GEMINI_API_KEY') else 'Offline Mode (Local Contour Detection)'}")
    print("================================================================\n")

    aether = AetherProcessor()
    try:
        asyncio.run(aether.connect_and_run(nexus_url))
    except KeyboardInterrupt:
        print("\n[Aether] Shutting down...")
    finally:
        aether.close()
