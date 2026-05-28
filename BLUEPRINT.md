# MAYAwe BLUEPRINT: Distributed Immersive Computing Ecosystem

## 1. Vision & Mission
MAYAwe aims to democratize immersive technology (AR/VR/MR) by transforming ordinary consumer hardware—specifically spare smartphones and home PCs—into a modular, scalable, and low-cost distributed computing ecosystem.

## 2. System Architecture & Hierarchy (Refined)
The system follows a three-tier **High-Speed Distributed Hierarchy**:

### Tier 1: MAYAwe Imager & Vision Node (The Senses & Display)
- **Role:** Dual-view data acquisition and AR Overlay.
- **Hardware:** 
    - Primary: Smartphone + Google Cardboard (Display + Spatial Camera 1).
    - Secondary: Laptop Webcam (Spatial Camera 2).
- **Function:** 
    - **Dual-View Capture:** Synchronized streaming of the phone camera and laptop webcam to the Nexus.
    - **Sensing:** Captures high-frequency sensor telemetry and live feeds.
    - **AR Overlay:** Renders the AI Pet and virtual artifacts onto the primary phone display.

### Tier 2: Nexus Engine (The Local Coordinator & Stereo Spatial Solver)
- **Role:** High-speed processing and Vision Hub.
- **Hardware:** Local PC (connected via high-speed P2P/LAN - similar to Nearby Share speeds).
- **Function:** 
    - **Stereo Triangulation:** Compares the two video feeds (Phone vs. Laptop) to calculate 3D spatial points, depth, and user hand positions.
    - **Sensor Fusion:** Combines IMU data from the phone with the calculated stereo spatial points.
    - **Local Physics:** Manages the AI Pet's physical interactions based on the solved 3D space.
    - Bridges the local "Senses" (Imager) with the "Global Intelligence" (Aether Cloud).

### Tier 3: Aether Cloud (The Global Intelligence)
- **Role:** Spatial Awareness & LLM Engine.
- **Hardware:** High-compute Cloud/Local Cluster (e.g., Hyveyesh).
- **Function:** 
    - Runs **Spatial LLMs** and massive vision models for deep environment understanding.
    - Processes scene data to identify physical objects (tables, tools, instruments).
    - Orchestrates the **AI Pet**'s behavior and intelligence.

## 3. The AI Pet Concept: Spatial Awareness & Interaction
The core of the MAYAwe experience is an **AR/MR AI Pet** that exists within the user's physical space:
- **Physical Interaction:** The pet understands geometry (floors, tables) and **User Presence**. It can walk toward the user, jump on a table they are pointing at, or react to hand gestures.
- **Gestural Control:** The user can interact with the pet using natural hand movements (e.g., "come here" gesture, pointing at an object, or petting the AI Pet in 3D space).
- **Educational Assistance:** The pet acts as an interactive guide. It can point to a specific component and use the 2-camera stereo tracking to verify if the user is looking at or touching the correct part (e.g., "Rotate this exact screw to calibrate the instrument").
- **Learning Loop:** The user can interact with the pet to teach it about new objects, which the Aether Cloud then processes to update its spatial knowledge base.

## 4. Data Flow Process (DHPA 2.0)
1.  **Dual-Capture:** Imager (Phone) and Laptop Webcam capture synchronized video + IMU.
2.  **P2P Stream:** High-speed streaming of both feeds to Nexus using WebRTC/NDI (Nearby Share style protocols).
3.  **Stereo Solving:** Nexus compares the two images to solve for 3D spatial points and user pose.
4.  **Cloud Analysis:** Nexus sends key frames and solved 3D points to Aether Cloud for deep semantic understanding.
5.  **Intelligence Loop:** Aether returns Pet behavior logic based on the user's gestures and environment.
6.  **Overlay:** Nexus sends final artifact coordinates back to the Imager.
7.  **AR Render:** The Imager overlays the interactive AI Pet onto the user's vision.

## 5. Telemetry Data Schema (V1)
To ensure interoperability between different Imagers and Nexus engines, all telemetry must follow this JSON structure:

```json
{
  "type": "telemetry",
  "deviceId": "string",
  "timestamp": 123456789,
  "data": {
    "rotation": {
      "alpha": 0.0,
      "beta": 0.0,
      "gamma": 0.0
    },
    "acceleration": {
      "x": 0.0,
      "y": 0.0,
      "z": 0.0
    },
    "interval": 16.67
  }
}
```

## 6. Directory Structure
- `/imager/`: Mobile sensing node code (Web-based prototype).
- `/nexus/`: PC rendering engine and coordinator logic.
- `/aether/`: AI intelligence and cloud orchestration layer.
- `/docs/`: Research papers, patents, and technical documentation.

## 7. Engineering Philosophy
- **Modularity:** Every component should be replaceable (e.g., swap Web Imager for a Native Android Imager).
- **Low-Cost:** Prioritize existing hardware over specialized proprietary sensors.
- **Distributed:** Shift heavy compute (Rendering/AI) to powerful nodes while keeping sensing lightweight.
