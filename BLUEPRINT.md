# MAYAwe BLUEPRINT: Distributed Immersive Computing Ecosystem

## 1. Vision & Mission
MAYAwe aims to democratize immersive technology (AR/VR/MR) by transforming ordinary consumer hardware—specifically spare smartphones and home PCs—into a modular, scalable, and low-cost distributed computing ecosystem.

## 2. System Architecture & Hierarchy (Refined)
The system follows a three-tier **High-Speed Distributed Hierarchy**:

### Tier 1: MAYAwe Imager (The Senses & Display)
- **Role:** High-speed data acquisition and AR Overlay.
- **Hardware:** Smartphone + Google Cardboard (or similar VR/AR viewer).
- **Function:** 
    - Captures high-frequency sensor telemetry and **live camera feed**.
    - Receives virtual object data and coordinates back from the Nexus.
    - **AR Overlay:** Renders virtual artifacts (like the AI Pet) directly over the live camera stream.

### Tier 2: Nexus Engine (The Local Coordinator)
- **Role:** High-speed processing hub.
- **Hardware:** Local PC (connected via high-speed P2P/LAN - similar to Nearby Share speeds).
- **Function:** 
    - Real-time sensor fusion and spatial coordinate management.
    - Local physics simulation for virtual objects.
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
- **Physical Interaction:** The pet understands geometry; it can walk across a floor, jump onto a detected table, and sit on physical surfaces.
- **Educational Assistance:** The pet acts as an interactive guide. It can point to a specific component (e.g., "Rotate this exact screw to calibrate the instrument") and explain its function.
- **Learning Loop:** The user can interact with the pet to teach it about new objects, which the Aether Cloud then processes to update its spatial knowledge base.

## 4. Data Flow Process (DHPA 2.0)
1.  **Capture:** Imager captures camera + IMU data.
2.  **P2P Stream:** High-speed, low-latency stream to Nexus (Local PC) using optimized file-sharing style protocols for raw data.
3.  **Cloud Analysis:** Nexus sends key frames/data to Aether Cloud for deep spatial analysis (Object Recognition/LLM).
4.  **Spatial Feedback:** Aether returns semantic data and AI Pet logic to Nexus.
5.  **Overlay:** Nexus sends virtual object coordinates and mesh data back to the Imager.
6.  **AR Render:** The Imager overlays the AI Pet and guidance artifacts onto the user's view.

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
