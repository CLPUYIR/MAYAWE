<div align="center">
  <h1>🌐 MAYAwe</h1>
  <h3>The Distributed Immersive Computing Ecosystem</h3>
  <p><i>Democratizing AR, VR, and MR by transforming everyday devices into powerful spatial computers.</i></p>
  
  <!-- Badges -->
  <p>
    <img src="https://img.shields.io/badge/Architecture-Distributed-blue" alt="Architecture" />
    <img src="https://img.shields.io/badge/Layer-Aether_AI-purple" alt="AI Layer" />
    <img src="https://img.shields.io/badge/Status-Prototyping-orange" alt="Status" />
  </p>
</div>

---

## 👁️ The Vision
**MAYAwe** is a long-term, deep-tech initiative to build a low-cost, scalable, and modular immersive computing platform. 

Current AR/VR systems are locked behind expensive headsets and proprietary ecosystems. MAYAwe solves this by using the hardware you already own—turning spare smartphones into advanced spatial sensors, home PCs into rendering engines, and the cloud into an intelligent orchestrator.

## 🏗️ The Three Pillars of MAYAwe
The system is built on a distributed edge-cloud hybrid architecture:

### 📱 1. MAYAwe Imager (The Senses)
The lightweight sensing node. It utilizes the cameras and IMUs of everyday smartphones to capture high-frequency spatial telemetry, motion tracking, and environment mapping, streaming it wirelessly.

### 💻 2. Nexus Engine (The Brain & Body)
The central coordination and rendering powerhouse. Running on a PC, it aggregates sensor streams from multiple Imagers, manages the unified spatial coordinate system, and handles high-fidelity graphics rendering.

### 🧠 3. Aether (The Intelligence)
The AI and orchestration layer. Aether consumes telemetry to understand the environment semantically, providing real-time optimizations, context-aware assistance, and intelligent spatial interactions.

---

## 🚀 Getting Started (MVP v0.1)

The current prototype demonstrates the distributed telemetry pipeline.

### Prerequisites
- Node.js (for Nexus)
- Python 3.x (for Aether)
- A Smartphone on the same LAN (for Imager)

### 1. Start the Nexus Engine (Hub)
```bash
cd nexus
npm install
node server.js
```

### 2. Start the Aether Intelligence Layer
```bash
cd aether
pip install -r requirements.txt
python processor.py
```

### 3. Launch the Imager
Serve the `imager/web-client` directory using any static file server (e.g., `npx serve`) and open the local IP on your mobile device. Click **Start Sensing** to begin streaming telemetry.

---

## 🔬 Research & Future Scope
MAYAwe is actively exploring:
- **Distributed XR Rendering:** Offloading rendering tasks across multiple nodes.
- **Multi-Device Synchronization:** Seamlessly tracking space using multiple disconnected smartphones.
- **AI-Assisted Spatial Computing:** Using LLMs and Vision Models to dynamically generate and alter immersive environments.

---
<div align="center">
  <i>Built by Abhishek Karthik PS — National Institute of Technology, Tiruchirappalli</i>
</div>
