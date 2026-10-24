// MAYAwe Imager: Main AR & AI Pet Client
// Procedural Three.js AR Pet rendered over live camera with full 6DOF/IMU anchoring

(function () {
    const videoEl = document.getElementById('camera-feed');
    const canvasEl = document.getElementById('ar-canvas');
    const keyframeCanvas = document.getElementById('keyframe-canvas');
    const keyframeCtx = keyframeCanvas.getContext('2d');

    const startBtn = document.getElementById('start-btn');
    const modalEl = document.getElementById('permission-modal');
    const permStatusEl = document.getElementById('perm-status');
    const recenterBtn = document.getElementById('recenter-btn');
    const interactBtn = document.getElementById('interact-btn');
    const statusDot = document.getElementById('status-dot');
    const connText = document.getElementById('conn-text');
    const fpsBadge = document.getElementById('fps-badge');
    const activeGestureText = document.getElementById('active-gesture-text');
    const speechBubble = document.getElementById('speech-bubble');
    const speechContent = document.getElementById('speech-content');
    const petModeBadge = document.getElementById('pet-mode-badge');

    // Three.js Core Variables
    let scene, camera, renderer;
    let petMeshGroup = null;
    let petParts = {};
    let isInitialized = false;

    // AI Pet State & Kinematics
    const petState = {
        currentPos: new THREE.Vector3(0, -0.15, -1.5),
        targetPos: new THREE.Vector3(0, -0.15, -1.5),
        rotationY: 0,
        targetRotationY: 0,
        mode: 'IDLE', // 'IDLE' | 'WALK' | 'JUMP' | 'WAVE' | 'APPROACH' | 'STAY'
        animTime: 0,
        jumpProgress: 0,
        isJumping: false
    };

    // Camera Orientation Math
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X
    const zee = new THREE.Vector3(0, 0, 1);
    const cameraBaseQuaternion = new THREE.Quaternion();
    let isRecalibrated = false;

    // Telemetry & FPS metrics
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let lastKeyframeTime = 0;

    /**
     * Step 1: Start Camera and Sensor Streaming
     */
    startBtn.addEventListener('click', async () => {
        permStatusEl.innerText = "Requesting camera and IMU access...";
        startBtn.disabled = true;

        try {
            // 1. Initialize rear camera
            await initCamera();

            // 2. Request IMU permissions
            const sensorsGranted = await window.MAYAweSensors.requestPermissions();
            console.log("[MAYAwe] Sensors granted:", sensorsGranted);

            // 3. Initialize Three.js AR Scene
            initThreeScene();

            // 4. Connect to Nexus via WebSocket / WSS
            initStream();

            // 5. Hide modal and start experience
            modalEl.style.display = 'none';
            isInitialized = true;
            recenterPet();
        } catch (err) {
            console.error("[MAYAwe] Initialization error:", err);
            permStatusEl.innerText = `Error: ${err.message || 'Access denied'}. Please check permissions.`;
            startBtn.disabled = false;
        }
    });

    async function initCamera() {
        const constraints = {
            audio: false,
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoEl.srcObject = stream;
            await videoEl.play();
        } catch (err) {
            console.warn("[MAYAwe] Environment camera failed, trying fallback video:", err);
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoEl.srcObject = fallbackStream;
            await videoEl.play();
        }
    }

    /**
     * Step 2: Initialize Three.js AR Scene
     */
    function initThreeScene() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(65, width / height, 0.05, 50);
        camera.position.set(0, 0, 0);

        renderer = new THREE.WebGLRenderer({
            canvas: canvasEl,
            alpha: true,
            antialias: true,
            powerPreference: "high-performance"
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0x00f0ff, 1.2);
        dirLight.position.set(2, 5, 3);
        scene.add(dirLight);

        const pointLight = new THREE.PointLight(0x70a6ff, 1.5, 10);
        pointLight.position.set(-2, 2, -1);
        scene.add(pointLight);

        // Build 3D AI Pet Mesh
        buildProceduralPet();

        // Window resize handler
        window.addEventListener('resize', onWindowResize);

        // Start render animation loop
        requestAnimationFrame(renderLoop);
    }

    /**
     * Step 3: Procedural 3D Robot Pet ("MAYA")
     */
    function buildProceduralPet() {
        petMeshGroup = new THREE.Group();

        // 1. Sleek Cyber Body
        const bodyGeo = new THREE.SphereGeometry(0.2, 32, 24);
        bodyGeo.scale(1.0, 0.85, 1.2);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x1b2838,
            metalness: 0.85,
            roughness: 0.25,
            wireframe: false
        });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        petMeshGroup.add(bodyMesh);
        petParts.body = bodyMesh;

        // 2. Glowing Visor / Eyes
        const visorGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 32);
        visorGeo.rotateX(Math.PI / 2);
        const visorMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff
        });
        const visorMesh = new THREE.Mesh(visorGeo, visorMat);
        visorMesh.position.set(0, 0.05, 0.22);
        petMeshGroup.add(visorMesh);
        petParts.visor = visorMesh;

        // Inner glowing pupils
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        eyeL.position.set(-0.05, 0.05, 0.235);
        const eyeR = eyeL.clone();
        eyeR.position.x = 0.05;
        petMeshGroup.add(eyeL);
        petMeshGroup.add(eyeR);
        petParts.eyeL = eyeL;
        petParts.eyeR = eyeR;

        // 3. Robotic Ears / Antennae
        const earGeo = new THREE.ConeGeometry(0.045, 0.16, 16);
        const earMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, metalness: 0.7, roughness: 0.3 });
        
        const earL = new THREE.Mesh(earGeo, earMat);
        earL.position.set(-0.14, 0.22, -0.05);
        earL.rotation.z = 0.35;
        earL.rotation.x = -0.2;
        petMeshGroup.add(earL);

        const earR = new THREE.Mesh(earGeo, earMat);
        earR.position.set(0.14, 0.22, -0.05);
        earR.rotation.z = -0.35;
        earR.rotation.x = -0.2;
        petMeshGroup.add(earR);
        petParts.earL = earL;
        petParts.earR = earR;

        // 4. Four Articulated Floating Hover Paws
        petParts.paws = [];
        const pawGeo = new THREE.SphereGeometry(0.05, 16, 16);
        pawGeo.scale(0.8, 0.5, 1.2);
        const pawMat = new THREE.MeshStandardMaterial({
            color: 0x243447,
            emissive: 0x0072ff,
            emissiveIntensity: 0.3,
            metalness: 0.9,
            roughness: 0.2
        });

        const pawPositions = [
            [-0.18, -0.18, 0.12],  // Front Left
            [0.18, -0.18, 0.12],   // Front Right
            [-0.18, -0.18, -0.14], // Back Left
            [0.18, -0.18, -0.14]   // Back Right
        ];

        pawPositions.forEach((pos, idx) => {
            const paw = new THREE.Mesh(pawGeo, pawMat);
            paw.position.set(...pos);
            petMeshGroup.add(paw);
            petParts.paws.push(paw);
        });

        // 5. Thruster / Energy Core Ring
        const ringGeo = new THREE.TorusGeometry(0.08, 0.015, 16, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const coreRing = new THREE.Mesh(ringGeo, ringMat);
        coreRing.position.set(0, 0, -0.23);
        petMeshGroup.add(coreRing);
        petParts.coreRing = coreRing;

        // 6. Ground Projection Ring / Spatial Shadow
        const shadowGeo = new THREE.RingGeometry(0.15, 0.28, 32);
        shadowGeo.rotateX(-Math.PI / 2);
        const shadowMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide
        });
        const groundShadow = new THREE.Mesh(shadowGeo, shadowMat);
        groundShadow.position.y = -0.4;
        petMeshGroup.add(groundShadow);
        petParts.groundShadow = groundShadow;

        // Set initial world position
        petMeshGroup.position.copy(petState.currentPos);
        scene.add(petMeshGroup);
    }

    /**
     * Step 4: Sensor & Streaming Integration
     */
    function initStream() {
        // Connect to Nexus WebSocket
        window.MAYAweStream.connect();

        window.MAYAweStream.onConnectionChange(
            () => {
                statusDot.classList.add('connected');
                connText.innerText = "Nexus Synced";
            },
            () => {
                statusDot.classList.remove('connected');
                connText.innerText = "Reconnecting...";
            }
        );

        // Synchronized 60Hz Telemetry Stream
        window.MAYAweSensors.setCallback((telemetryData) => {
            if (window.MAYAweStream.isConnected()) {
                window.MAYAweStream.sendTelemetry(telemetryData);
            }
        });

        // Inbound Spatial State from Nexus / Aether
        window.MAYAweStream.onSpatialState((packet) => {
            handleSpatialStateUpdate(packet);
        });
    }

    function handleSpatialStateUpdate(packet) {
        // 1. Gesture updates
        if (packet.gesture) {
            const gesture = packet.gesture;
            activeGestureText.innerText = gesture;

            switch (gesture) {
                case 'OPEN_PALM':
                case 'WAVE':
                    triggerWaveAnimation();
                    break;
                case 'INDEX_POINT':
                    petState.mode = 'WALK';
                    break;
                case 'PINCH':
                case 'GRAB':
                    petState.mode = 'APPROACH';
                    break;
                case 'FIST':
                    petState.mode = 'STAY';
                    break;
                default:
                    if (petState.mode !== 'JUMP' && petState.mode !== 'WAVE') {
                        petState.mode = 'IDLE';
                    }
                    break;
            }
        }

        // 2. Pet state / target coordinates
        if (packet.petState) {
            const incoming = packet.petState;
            if (incoming.targetPosition) {
                // Keep pet at comfortable AR desk depth
                petState.targetPos.set(
                    incoming.targetPosition.x ?? petState.targetPos.x,
                    incoming.targetPosition.y ?? petState.targetPos.y,
                    incoming.targetPosition.z ?? petState.targetPos.z
                );
            }
            if (incoming.mode && !petState.isJumping) {
                petState.mode = incoming.mode;
            }
        }

        // 3. Speech / Semantic Guidance text
        const speech = packet.speech || packet.petState?.speechText;
        if (speech && speech !== speechContent.innerText) {
            speechContent.innerText = speech;
            speechBubble.style.opacity = '1';
        }

        petModeBadge.innerText = `[${petState.mode}]`;
    }

    /**
     * Animation Triggers
     */
    function triggerWaveAnimation() {
        petState.mode = 'WAVE';
        speechContent.innerText = "Hello! Wave detected! 👋 Happy to see you!";
        setTimeout(() => {
            if (petState.mode === 'WAVE') petState.mode = 'IDLE';
        }, 2500);
    }

    function triggerJumpAnimation() {
        if (petState.isJumping) return;
        petState.isJumping = true;
        petState.jumpProgress = 0;
        petState.mode = 'JUMP';
        speechContent.innerText = "Wheee! *Jumps excitedly* 🚀";
    }

    interactBtn.addEventListener('click', () => {
        triggerJumpAnimation();
    });

    /**
     * Recalibrate camera frame to place pet directly in front of the phone
     */
    function recenterPet() {
        const forward = new THREE.Vector3(0, 0, -1.5);
        forward.applyQuaternion(camera.quaternion);
        
        petState.targetPos.copy(camera.position).add(forward);
        petState.targetPos.y -= 0.15; // Desk level
        petState.currentPos.copy(petState.targetPos);
        petMeshGroup.position.copy(petState.currentPos);

        // Turn pet to face the camera
        petMeshGroup.lookAt(camera.position.x, petMeshGroup.position.y, camera.position.z);
        speechContent.innerText = "Spatial origin re-anchored to your field of view.";
    }

    recenterBtn.addEventListener('click', recenterPet);

    /**
     * Step 5: Render Loop & Kinematic Animation Engine (60 FPS)
     */
    function renderLoop(timestamp) {
        requestAnimationFrame(renderLoop);

        // 1. Update Camera orientation from live phone IMU
        const sensor = window.MAYAweSensors.state;
        if (sensor.isListening) {
            updateCameraFromOrientation(camera, sensor.rotation.alpha, sensor.rotation.beta, sensor.rotation.gamma);
        }

        // 2. Animate Pet Kinematics & State Machine
        animatePet(timestamp);

        // 3. Low-Frequency Keyframe Streaming (0.5 Hz / Every 2 Seconds)
        if (timestamp - lastKeyframeTime > 2000 && isInitialized && videoEl.readyState >= 2) {
            lastKeyframeTime = timestamp;
            captureAndStreamKeyframe();
        }

        // 4. Render 3D Scene
        renderer.render(scene, camera);

        // 5. FPS Metrics
        frameCount++;
        if (timestamp - lastFpsTime >= 1000) {
            fpsBadge.innerText = `FPS: ${frameCount}`;
            frameCount = 0;
            lastFpsTime = timestamp;
        }
    }

    function updateCameraFromOrientation(cam, alpha, beta, gamma) {
        const alphaRad = alpha ? THREE.MathUtils.degToRad(alpha) : 0;
        const betaRad = beta ? THREE.MathUtils.degToRad(beta) : 0;
        const gammaRad = gamma ? THREE.MathUtils.degToRad(gamma) : 0;

        euler.set(betaRad, alphaRad, -gammaRad, 'YXZ');
        cam.quaternion.setFromEuler(euler);
        cam.quaternion.multiply(q1); // Orient camera looking out the rear
    }

    function animatePet(timestamp) {
        if (!petMeshGroup) return;

        const dt = 0.016;
        petState.animTime += dt;
        const t = petState.animTime;

        // Position Lerp towards target waypoint
        const lerpFactor = petState.mode === 'APPROACH' ? 0.08 : 0.04;
        petState.currentPos.lerp(petState.targetPos, lerpFactor);
        petMeshGroup.position.copy(petState.currentPos);

        // Base hovering oscillation
        let hoverY = Math.sin(t * 3.0) * 0.04;
        let bodyPitch = 0;
        let bodyRoll = 0;

        // Animate based on state
        switch (petState.mode) {
            case 'IDLE':
                // Gentle breathing and subtle ear twitch
                if (petParts.earL && petParts.earR) {
                    petParts.earL.rotation.z = 0.35 + Math.sin(t * 2) * 0.08;
                    petParts.earR.rotation.z = -0.35 - Math.sin(t * 2) * 0.08;
                }
                // Floating paws cycle subtly
                petParts.paws.forEach((paw, idx) => {
                    paw.position.y = -0.18 + Math.sin(t * 3.0 + idx * 1.5) * 0.015;
                });
                break;

            case 'WALK':
            case 'APPROACH':
                // Tilt forward & cycle paws
                bodyPitch = 0.15;
                hoverY = Math.abs(Math.sin(t * 8.0)) * 0.05;
                petParts.paws.forEach((paw, idx) => {
                    const phase = (idx % 2 === 0) ? 0 : Math.PI;
                    paw.position.z = ((idx < 2) ? 0.12 : -0.14) + Math.cos(t * 8.0 + phase) * 0.05;
                    paw.position.y = -0.18 + Math.sin(t * 8.0 + phase) * 0.03;
                });
                break;

            case 'JUMP':
                // Smooth parabolic jump
                petState.jumpProgress += 0.035;
                if (petState.jumpProgress < 1.0) {
                    const jumpHeight = Math.sin(petState.jumpProgress * Math.PI) * 0.45;
                    hoverY += jumpHeight;
                    petMeshGroup.rotation.y += 0.15; // Joyful spin
                } else {
                    petState.isJumping = false;
                    petState.mode = 'IDLE';
                }
                break;

            case 'WAVE':
                // Tilt and wave front right paw
                bodyRoll = -0.12;
                if (petParts.paws[1]) {
                    petParts.paws[1].position.set(0.24, 0.08 + Math.sin(t * 12.0) * 0.08, 0.16);
                }
                break;

            case 'STAY':
                // Lower down, hover gently near surface
                hoverY = -0.12 + Math.sin(t * 1.5) * 0.01;
                break;
        }

        if (petParts.body) {
            petParts.body.position.y = hoverY;
            petParts.body.rotation.x = bodyPitch;
            petParts.body.rotation.z = bodyRoll;
        }

        // Visor & Core Glow pulsation
        if (petParts.coreRing) {
            const glow = 0.8 + Math.sin(t * 5.0) * 0.4;
            petParts.coreRing.scale.set(glow, glow, glow);
        }

        // Shadow follows ground under the pet
        if (petParts.groundShadow) {
            const shadowScale = 1.0 - (hoverY * 0.5);
            petParts.groundShadow.scale.set(shadowScale, shadowScale, shadowScale);
            petParts.groundShadow.material.opacity = Math.max(0.1, 0.4 - hoverY);
        }
    }

    /**
     * Step 6: Capture and Stream Low-Frequency Keyframe to Nexus
     */
    function captureAndStreamKeyframe() {
        if (!videoEl.videoWidth || !videoEl.videoHeight) return;

        keyframeCtx.drawImage(videoEl, 0, 0, keyframeCanvas.width, keyframeCanvas.height);
        const jpegBase64 = keyframeCanvas.toDataURL('image/jpeg', 0.55);

        if (window.MAYAweStream.isConnected()) {
            window.MAYAweStream.sendCameraKeyframe(jpegBase64);
        }
    }

    function onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
})();
