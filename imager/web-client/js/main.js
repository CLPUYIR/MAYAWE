// MAYAwe V2 Imager: Main Stereoscopic AR & AI Pet Client
// Features: Google Cardboard Stereo, Asynchronous TimeWarp (ATW), Invisible Depth-Occlusion,
// and Surface-Aware Physics State Machine (Climbing Chairs, Hiding Under Bed)

(function () {
    const videoEl = document.getElementById('camera-feed');
    const canvasEl = document.getElementById('ar-canvas');
    const cvCanvas = document.getElementById('cv-canvas');
    const cvCtx = cvCanvas.getContext('2d');
    const snapshotCanvas = document.getElementById('snapshot-canvas');
    const snapshotCtx = snapshotCanvas.getContext('2d');

    const startBtn = document.getElementById('start-btn');
    const modalEl = document.getElementById('permission-modal');
    const permStatusEl = document.getElementById('perm-status');
    const toggleStereoBtn = document.getElementById('toggle-stereo-btn');
    const togglePlanesBtn = document.getElementById('toggle-planes-btn');
    const recenterBtn = document.getElementById('recenter-btn');
    const actionBtn = document.getElementById('action-btn');
    const stereoDivider = document.getElementById('stereo-divider');

    const statusDot = document.getElementById('status-dot');
    const connText = document.getElementById('conn-text');
    const fpsBadge = document.getElementById('fps-badge');
    const modeBadge = document.getElementById('mode-badge');
    const activeGestureText = document.getElementById('active-gesture-text');
    const speechBubble = document.getElementById('speech-bubble');
    const speechContent = document.getElementById('speech-content');
    const petModeBadge = document.getElementById('pet-mode-badge');

    // Three.js Core Variables
    let scene, backgroundScene, renderer;
    let cameraMono, cameraLeft, cameraRight, bgCamera;
    let videoTexture, bgQuadMesh;
    let petMeshGroup = null;
    let petParts = {};
    let isInitialized = false;

    // Stereoscopic & Display State
    let isStereoMode = false;
    let showDebugPlanes = false;
    const IPD = 0.064; // Interpupillary distance: 64mm

    // Active Room Planes & Occluder Proxies
    const detectedPlanes = new Map(); // id -> { data, mesh, occluderMesh }
    let planeContainer = null;

    // AI Pet State & Physics Kinematics
    const petState = {
        currentPos: new THREE.Vector3(0, 0.0, -1.5),
        targetPos: new THREE.Vector3(0, 0.0, -1.5),
        velocity: new THREE.Vector3(0, 0, 0),
        mode: 'IDLE_SCAN', // 'IDLE_SCAN'|'WALK_ON_SURFACE'|'CLIMB_CHAIR'|'HIDE_UNDER_BED'|'FOLLOW_USER'|'SIT_STAY'|'GREET_WAVE'
        currentSurfaceElevation: 0.0, // Floor level (y=0)
        activeSurfaceId: 'plane_floor_0',
        animTime: 0,
        jumpProgress: 0,
        jumpOriginY: 0.0,
        jumpTargetY: 0.45,
        isCrouched: false,
        speechText: "MAYA is ready. Exploring your room!"
    };

    // Camera Orientation Math
    const euler = new THREE.Euler();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X
    const atwQuaternion = new THREE.Quaternion();

    // Timing metrics
    let frameCount = 0;
    let lastFpsTime = performance.now();
    let lastCvFrameTime = 0;
    let lastSnapshotTime = 0;

    /**
     * Step 1: Start Camera, Sensors & Three.js Viewport
     */
    startBtn.addEventListener('click', async () => {
        permStatusEl.innerText = "Requesting rear camera and 6-DoF VIO sensors...";
        startBtn.disabled = true;

        try {
            await initCamera();
            await window.MAYAweSensors.requestPermissions();
            initThreeScene();
            initStream();

            modalEl.style.display = 'none';
            isInitialized = true;
            recenterPet();
        } catch (err) {
            console.error("[MAYAwe V2] Initialization error:", err);
            permStatusEl.innerText = `Error: ${err.message || 'Access denied'}.`;
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
            console.warn("[MAYAwe] Fallback video request:", err);
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoEl.srcObject = fallbackStream;
            await videoEl.play();
        }
    }

    /**
     * Step 2: Initialize Three.js Stereoscopic AR Scene
     */
    function initThreeScene() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const aspect = width / height;

        scene = new THREE.Scene();
        planeContainer = new THREE.Group();
        scene.add(planeContainer);

        // Cameras
        cameraMono = new THREE.PerspectiveCamera(60, aspect, 0.05, 50);
        cameraLeft = new THREE.PerspectiveCamera(60, (width / 2) / height, 0.05, 50);
        cameraRight = new THREE.PerspectiveCamera(60, (width / 2) / height, 0.05, 50);

        // Background Scene for Live Camera Passthrough
        backgroundScene = new THREE.Scene();
        bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        videoTexture = new THREE.VideoTexture(videoEl);
        videoTexture.minFilter = THREE.LinearFilter;
        videoTexture.magFilter = THREE.LinearFilter;

        const bgMat = new THREE.MeshBasicMaterial({ map: videoTexture, depthTest: false, depthWrite: false });
        bgQuadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
        backgroundScene.add(bgQuadMesh);

        // WebGL Renderer
        renderer = new THREE.WebGLRenderer({
            canvas: canvasEl,
            alpha: false,
            antialias: true,
            powerPreference: "high-performance"
        });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.autoClear = false;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0x00f0ff, 1.3);
        dirLight.position.set(2, 6, 3);
        scene.add(dirLight);

        const pointLight = new THREE.PointLight(0x70a6ff, 1.2, 10);
        pointLight.position.set(-2, 3, -1);
        scene.add(pointLight);

        // Build 3D Articulated AI Pet Mesh
        buildProceduralPet();

        // Add Default Room Floor Plane
        addOrUpdateRoomPlane({
            id: 'plane_floor_0',
            class: 'FLOOR',
            center: { x: 0.0, y: 0.0, z: -1.5 },
            extents: { w: 6.0, d: 6.0, h: 0.01 },
            occluder: false
        });

        window.addEventListener('resize', onWindowResize);
        requestAnimationFrame(renderLoop);
    }

    /**
     * Step 3: Procedural 3D Robot Pet ("MAYA")
     */
    function buildProceduralPet() {
        petMeshGroup = new THREE.Group();
        petMeshGroup.renderOrder = 1; // Render after depth occluders!

        // Sleek Cyber Body
        const bodyGeo = new THREE.SphereGeometry(0.18, 32, 24);
        bodyGeo.scale(1.0, 0.85, 1.2);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x1b2838,
            metalness: 0.85,
            roughness: 0.25
        });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        petMeshGroup.add(bodyMesh);
        petParts.body = bodyMesh;

        // Glowing Visor / Eyes
        const visorGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 32);
        visorGeo.rotateX(Math.PI / 2);
        const visorMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const visorMesh = new THREE.Mesh(visorGeo, visorMat);
        visorMesh.position.set(0, 0.04, 0.20);
        petMeshGroup.add(visorMesh);
        petParts.visor = visorMesh;

        // Ears / Antennae
        const earGeo = new THREE.ConeGeometry(0.04, 0.14, 16);
        const earMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, metalness: 0.7, roughness: 0.3 });
        const earL = new THREE.Mesh(earGeo, earMat);
        earL.position.set(-0.12, 0.20, -0.04);
        earL.rotation.z = 0.35;
        petMeshGroup.add(earL);

        const earR = new THREE.Mesh(earGeo, earMat);
        earR.position.set(0.12, 0.20, -0.04);
        earR.rotation.z = -0.35;
        petMeshGroup.add(earR);
        petParts.earL = earL;
        petParts.earR = earR;

        // Hover Paws
        petParts.paws = [];
        const pawGeo = new THREE.SphereGeometry(0.045, 16, 16);
        pawGeo.scale(0.8, 0.5, 1.2);
        const pawMat = new THREE.MeshStandardMaterial({ color: 0x243447, emissive: 0x0072ff, emissiveIntensity: 0.3 });

        const pawPositions = [
            [-0.15, -0.15, 0.10],
            [0.15, -0.15, 0.10],
            [-0.15, -0.15, -0.12],
            [0.15, -0.15, -0.12]
        ];

        pawPositions.forEach((pos) => {
            const paw = new THREE.Mesh(pawGeo, pawMat);
            paw.position.set(...pos);
            petMeshGroup.add(paw);
            petParts.paws.push(paw);
        });

        // Core Thruster Ring
        const ringGeo = new THREE.TorusGeometry(0.07, 0.012, 16, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const coreRing = new THREE.Mesh(ringGeo, ringMat);
        coreRing.position.set(0, 0, -0.21);
        petMeshGroup.add(coreRing);
        petParts.coreRing = coreRing;

        // Spatial Shadow Projection
        const shadowGeo = new THREE.RingGeometry(0.12, 0.24, 32);
        shadowGeo.rotateX(-Math.PI / 2);
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
        const groundShadow = new THREE.Mesh(shadowGeo, shadowMat);
        groundShadow.position.y = -0.18;
        petMeshGroup.add(groundShadow);
        petParts.groundShadow = groundShadow;

        petMeshGroup.position.copy(petState.currentPos);
        scene.add(petMeshGroup);
    }

    /**
     * Step 4: Depth-Occlusion Proxies & Room Planes
     */
    function addOrUpdateRoomPlane(planeData) {
        if (!planeData || !planeData.id) return;
        const id = planeData.id;

        let entry = detectedPlanes.get(id);
        if (!entry) {
            const group = new THREE.Group();

            // 1. Invisible Depth-Occlusion Mesh (Writes to Z-Buffer without color)
            const occluderGeo = new THREE.BoxGeometry(
                planeData.extents.w || 0.5,
                planeData.extents.h || 0.05,
                planeData.extents.d || 0.5
            );
            const occluderMat = new THREE.MeshBasicMaterial({
                colorWrite: false, // Invisible
                depthWrite: true   // Writes to Z-Buffer!
            });
            const occluderMesh = new THREE.Mesh(occluderGeo, occluderMat);
            occluderMesh.renderOrder = 0; // Must render BEFORE MAYA!
            group.add(occluderMesh);

            // 2. Wireframe / Translucent Debug Visualizer
            const colorMap = {
                'FLOOR': 0x00ff88,
                'CHAIR_OR_BED_SURFACE': 0xff9f43,
                'DESK_OR_TABLE': 0x00f0ff,
                'UNDER_BED_SHADOW_ZONE': 0xa55eea,
                'VERTICAL_OBSTACLE': 0xff4757
            };
            const planeColor = colorMap[planeData.class] || 0x00f0ff;
            const debugMat = new THREE.MeshBasicMaterial({
                color: planeColor,
                wireframe: true,
                transparent: true,
                opacity: 0.4
            });
            const debugMesh = new THREE.Mesh(occluderGeo, debugMat);
            debugMesh.visible = showDebugPlanes;
            group.add(debugMesh);

            planeContainer.add(group);
            entry = { data: planeData, group, occluderMesh, debugMesh };
            detectedPlanes.set(id, entry);
        }

        // Update position and extents
        entry.group.position.set(planeData.center.x, planeData.center.y, planeData.center.z);
        entry.data = planeData;
    }

    function toggleDebugPlanes() {
        showDebugPlanes = !showDebugPlanes;
        detectedPlanes.forEach(entry => {
            if (entry.debugMesh) entry.debugMesh.visible = showDebugPlanes;
        });
        togglePlanesBtn.classList.toggle('active', showDebugPlanes);
        speechContent.innerText = showDebugPlanes ? "Surface planes visible (Floor, Chair, Bed, Desk)." : "Occlusion masks running invisibly.";
    }

    togglePlanesBtn.addEventListener('click', toggleDebugPlanes);

    /**
     * Step 5: Google Cardboard Stereoscopic Mode Toggle
     */
    function toggleStereoMode() {
        isStereoMode = !isStereoMode;
        window.MAYAweStream.setStereoModeFlag(isStereoMode);
        stereoDivider.style.display = isStereoMode ? 'block' : 'none';
        toggleStereoBtn.classList.toggle('active', isStereoMode);
        modeBadge.innerText = isStereoMode ? "AR: CARDBOARD STEREO" : "AR: MONO";

        // Attempt Fullscreen for seamless Cardboard immersion
        if (isStereoMode && !document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log("Fullscreen request:", e.message));
        }
    }

    toggleStereoBtn.addEventListener('click', toggleStereoMode);

    /**
     * Step 6: Stream & Network Integration
     */
    function initStream() {
        window.MAYAweStream.connect();

        window.MAYAweStream.onConnectionChange(
            () => {
                statusDot.classList.add('connected');
                connText.innerText = "Nexus Synced (WSS:8443)";
            },
            () => {
                statusDot.classList.remove('connected');
                connText.innerText = "Reconnecting...";
            }
        );

        // 60 Hz Telemetry Loop
        window.MAYAweSensors.setCallback((telemetryData) => {
            if (window.MAYAweStream.isConnected()) {
                window.MAYAweStream.sendTelemetry(telemetryData);
            }
        });

        // MAYAwe V2 Spatial World Update Handler
        window.MAYAweStream.onSpatialWorldUpdate((packet) => {
            handleSpatialWorldUpdate(packet);
        });

        // Backward-compatible spatial state
        window.MAYAweStream.onSpatialState((packet) => {
            handleBackwardCompatibleState(packet);
        });
    }

    function handleSpatialWorldUpdate(packet) {
        // 1. Dual-Camera Hand Pose & Gestures
        if (packet.dualHandPose) {
            const dh = packet.dualHandPose;
            const gesture = dh.gesture || 'NONE';
            activeGestureText.innerText = `${gesture} (${Math.round((dh.weights?.phone || 0.5) * 100)}% Phone / ${Math.round((dh.weights?.laptop || 0.5) * 100)}% PC)`;

            if (gesture === 'INDEX_POINT' && dh.raycastTarget) {
                // Pointing at a real furniture plane!
                if (dh.raycastTarget.surfaceId && dh.raycastTarget.surfaceId.includes('chair')) {
                    triggerClimbChair(dh.raycastTarget);
                } else {
                    petState.targetPos.set(dh.raycastTarget.x, dh.raycastTarget.y, dh.raycastTarget.z);
                    petState.mode = 'WALK_ON_SURFACE';
                }
            } else if (gesture === 'OPEN_PALM') {
                triggerGreetWave();
            } else if (gesture === 'PINCH') {
                petState.mode = 'FOLLOW_USER';
            } else if (gesture === 'FIST') {
                petState.mode = 'SIT_STAY';
            }
        }

        // 2. Room Planes & Surface Colliders
        if (packet.roomPlanes && Array.isArray(packet.roomPlanes)) {
            packet.roomPlanes.forEach(planeData => {
                addOrUpdateRoomPlane(planeData);
            });
        }

        // 3. Pet Directives & Speech
        if (packet.petDirective) {
            const dir = packet.petDirective;
            if (dir.state) petState.mode = dir.state;
            if (dir.targetPosition) {
                petState.targetPos.set(dir.targetPosition.x, dir.targetPosition.y, dir.targetPosition.z);
            }
            if (dir.speechHud) {
                speechContent.innerText = dir.speechHud;
                speechBubble.style.opacity = '1';
            }
        }

        petModeBadge.innerText = `[${petState.mode}]`;
    }

    function handleBackwardCompatibleState(packet) {
        if (packet.gesture) activeGestureText.innerText = packet.gesture;
        if (packet.speech) speechContent.innerText = packet.speech;
        if (packet.petState?.mode) petState.mode = packet.petState.mode;
        petModeBadge.innerText = `[${petState.mode}]`;
    }

    /**
     * Step 7: Pet Behaviors & Physics Triggers
     */
    function triggerClimbChair(target) {
        if (petState.mode === 'CLIMB_CHAIR') return;
        petState.mode = 'CLIMB_CHAIR';
        petState.jumpProgress = 0.0;
        petState.jumpOriginY = petState.currentPos.y;
        petState.jumpTargetY = target ? target.y : 0.45;
        if (target) {
            petState.targetPos.set(target.x, target.y, target.z);
        }
        speechContent.innerText = "Parabolic jump! Climbing onto the chair 🪑🐾";
    }

    function triggerHideUnderBed() {
        petState.mode = 'HIDE_UNDER_BED';
        // Locate under bed zone or default hideout
        let hidePos = new THREE.Vector3(-1.1, 0.0, -2.1);
        detectedPlanes.forEach(entry => {
            if (entry.data.class === 'UNDER_BED_SHADOW_ZONE') {
                hidePos.copy(entry.group.position);
            }
        });
        petState.targetPos.copy(hidePos);
        speechContent.innerText = "Shhh! Hiding under the bed frame... 🛏️👀";
    }

    function triggerGreetWave() {
        petState.mode = 'GREET_WAVE';
        speechContent.innerText = "Wave received! Hello friend! 🐾👋";
        setTimeout(() => {
            if (petState.mode === 'GREET_WAVE') petState.mode = 'IDLE_SCAN';
        }, 2500);
    }

    actionBtn.addEventListener('click', () => {
        if (petState.mode === 'CLIMB_CHAIR') {
            triggerHideUnderBed();
        } else {
            triggerClimbChair({ x: 0.8, y: 0.45, z: -1.6 });
        }
    });

    function recenterPet() {
        const forward = new THREE.Vector3(0, 0, -1.5);
        forward.applyQuaternion(atwQuaternion);

        petState.targetPos.copy(cameraMono.position).add(forward);
        petState.targetPos.y = 0.0; // Place on floor
        petState.currentPos.copy(petState.targetPos);
        petMeshGroup.position.copy(petState.currentPos);
        petMeshGroup.lookAt(cameraMono.position.x, 0, cameraMono.position.z);
        speechContent.innerText = "Spatial origin re-anchored to room floor.";
    }

    recenterBtn.addEventListener('click', recenterPet);

    /**
     * Step 8: Surface-Aware Physics Engine (60 FPS)
     */
    function updatePetPhysics(dt) {
        if (!petMeshGroup) return;
        petState.animTime += dt;
        const t = petState.animTime;

        // 1. Solve active state kinematics
        switch (petState.mode) {
            case 'IDLE_SCAN': {
                petState.isCrouched = false;
                petMeshGroup.scale.set(1, 1, 1);
                // Subtle breathing and head look-around
                const breathY = Math.sin(t * 2.5) * 0.015;
                petParts.body.position.y = breathY;
                if (petParts.earL && petParts.earR) {
                    petParts.earL.rotation.z = 0.35 + Math.sin(t * 1.8) * 0.08;
                    petParts.earR.rotation.z = -0.35 - Math.sin(t * 1.8) * 0.08;
                }
                break;
            }

            case 'WALK_ON_SURFACE':
            case 'FOLLOW_USER': {
                petState.isCrouched = false;
                petMeshGroup.scale.set(1, 1, 1);

                // Lerp towards target (x, z)
                const moveSpeed = 0.05;
                petState.currentPos.x += (petState.targetPos.x - petState.currentPos.x) * moveSpeed;
                petState.currentPos.z += (petState.targetPos.z - petState.currentPos.z) * moveSpeed;

                // Support surface elevation clamping
                let supportingElevation = 0.0;
                detectedPlanes.forEach(entry => {
                    const center = entry.group.position;
                    const ext = entry.data.extents;
                    const hw = (ext.w || 0.6) / 2;
                    const hd = (ext.d || 0.6) / 2;
                    if (Math.abs(petState.currentPos.x - center.x) <= hw &&
                        Math.abs(petState.currentPos.z - center.z) <= hd) {
                        supportingElevation = Math.max(supportingElevation, entry.data.center.y);
                    }
                });

                petState.currentSurfaceElevation = supportingElevation;
                petState.currentPos.y += (petState.currentSurfaceElevation - petState.currentPos.y) * 0.1;

                // Stepping paw animation
                petParts.paws.forEach((paw, idx) => {
                    const phase = (idx % 2 === 0) ? 0 : Math.PI;
                    paw.position.z = ((idx < 2) ? 0.10 : -0.12) + Math.cos(t * 8.0 + phase) * 0.04;
                    paw.position.y = -0.15 + Math.abs(Math.sin(t * 8.0 + phase)) * 0.03;
                });
                break;
            }

            case 'CLIMB_CHAIR': {
                petState.isCrouched = false;
                petState.jumpProgress += dt * 1.2; // ~0.8s duration

                if (petState.jumpProgress <= 1.0) {
                    const p = petState.jumpProgress;
                    // Parabolic arc: y(t) = y0 + (ytarget - y0)*p + 4*peak*p*(1-p)
                    const peakBoost = 0.35;
                    const y = petState.jumpOriginY + (petState.jumpTargetY - petState.jumpOriginY) * p + 4.0 * peakBoost * p * (1.0 - p);
                    petState.currentPos.y = y;

                    // Interpolate x, z
                    petState.currentPos.x += (petState.targetPos.x - petState.currentPos.x) * (dt * 3);
                    petState.currentPos.z += (petState.targetPos.z - petState.currentPos.z) * (dt * 3);

                    // Forward pitch during ascent, level during descent
                    petParts.body.rotation.x = (p < 0.5) ? 0.3 : -0.15;
                    petParts.body.position.y = 0;
                } else {
                    petState.currentPos.y = petState.jumpTargetY;
                    petState.mode = 'IDLE_SCAN';
                    petParts.body.rotation.x = 0;
                    speechContent.innerText = "Landed safely on the chair surface! 🐾🪑";
                }
                break;
            }

            case 'HIDE_UNDER_BED': {
                // Sprint to under-bed zone and crouch low
                petState.isCrouched = true;
                petState.currentPos.lerp(petState.targetPos, 0.06);
                petState.currentPos.y = 0.0; // Floor level

                // Lower body height by 50% to fit under the bed frame
                petMeshGroup.scale.set(1.1, 0.5, 1.1);
                petParts.body.position.y = Math.sin(t * 4) * 0.01;
                break;
            }

            case 'SIT_STAY': {
                petState.isCrouched = false;
                petMeshGroup.scale.set(1, 1, 1);
                petParts.body.position.y = -0.05; // Sit low
                break;
            }

            case 'GREET_WAVE': {
                petState.isCrouched = false;
                petMeshGroup.scale.set(1, 1, 1);
                if (petParts.paws[1]) {
                    petParts.paws[1].position.set(0.20, 0.08 + Math.sin(t * 12.0) * 0.07, 0.14);
                }
                break;
            }
        }

        petMeshGroup.position.copy(petState.currentPos);
    }

    /**
     * Step 9: Asynchronous TimeWarp (ATW) & Stereoscopic Split-Screen Render Loop
     */
    function renderLoop(timestamp) {
        requestAnimationFrame(renderLoop);

        const dt = 0.016;

        // 1. Asynchronous TimeWarp: update virtual camera orientation from live sensor IMU right before drawing
        const sensor = window.MAYAweSensors.state;
        if (sensor.isListening) {
            updateAtwCameraOrientation(sensor.rotation.alpha, sensor.rotation.beta, sensor.rotation.gamma);
        }

        // 2. Physics & Kinematics Update
        updatePetPhysics(dt);

        // 3. Dual-Frequency Streaming
        // 15 Hz Low-Res (640x360) CV Keyframe Stream for Inside-Out MediaPipe
        if (timestamp - lastCvFrameTime > 66.6 && isInitialized && videoEl.readyState >= 2) {
            lastCvFrameTime = timestamp;
            cvCtx.drawImage(videoEl, 0, 0, cvCanvas.width, cvCanvas.height);
            const cvBase64 = cvCanvas.toDataURL('image/jpeg', 0.5);
            window.MAYAweStream.sendCvKeyframe(cvBase64);
        }

        // 0.5 Hz High-Res Snapshot for Gemini 2.5 Flash Scene Graph
        if (timestamp - lastSnapshotTime > 2000 && isInitialized && videoEl.readyState >= 2) {
            lastSnapshotTime = timestamp;
            snapshotCtx.drawImage(videoEl, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
            const snapBase64 = snapshotCanvas.toDataURL('image/jpeg', 0.65);
            window.MAYAweStream.sendSemanticSnapshot(snapBase64);
        }

        // 4. Render Passthrough + 3D Scene
        const width = window.innerWidth;
        const height = window.innerHeight;

        renderer.clear();

        if (isStereoMode) {
            // Google Cardboard Stereoscopic Split-Screen (Dual Scissor Viewports)
            renderer.setScissorTest(true);

            // Left Eye Viewport
            renderer.setViewport(0, 0, width / 2, height);
            renderer.setScissor(0, 0, width / 2, height);
            cameraLeft.position.copy(sensor.position);
            cameraLeft.position.x -= IPD / 2.0; // Left eye offset
            cameraLeft.quaternion.copy(atwQuaternion);

            // Render camera background quad, then 3D occluders + pet
            renderer.render(backgroundScene, bgCamera);
            renderer.render(scene, cameraLeft);

            // Right Eye Viewport
            renderer.setViewport(width / 2, 0, width / 2, height);
            renderer.setScissor(width / 2, 0, width / 2, height);
            cameraRight.position.copy(sensor.position);
            cameraRight.position.x += IPD / 2.0; // Right eye offset
            cameraRight.quaternion.copy(atwQuaternion);

            renderer.render(backgroundScene, bgCamera);
            renderer.render(scene, cameraRight);

            renderer.setScissorTest(false);
        } else {
            // Standard Monocular AR Viewport
            renderer.setViewport(0, 0, width, height);
            cameraMono.position.copy(sensor.position);
            cameraMono.quaternion.copy(atwQuaternion);

            renderer.render(backgroundScene, bgCamera);
            renderer.render(scene, cameraMono);
        }

        // 5. FPS Metrics
        frameCount++;
        if (timestamp - lastFpsTime >= 1000) {
            fpsBadge.innerText = `${frameCount} FPS`;
            frameCount = 0;
            lastFpsTime = timestamp;
        }
    }

    function updateAtwCameraOrientation(alpha, beta, gamma) {
        const alphaRad = alpha ? THREE.MathUtils.degToRad(alpha) : 0;
        const betaRad = beta ? THREE.MathUtils.degToRad(beta) : 0;
        const gammaRad = gamma ? THREE.MathUtils.degToRad(gamma) : 0;

        euler.set(betaRad, alphaRad, -gammaRad, 'YXZ');
        atwQuaternion.setFromEuler(euler);
        atwQuaternion.multiply(q1); // Look out the rear camera
    }

    function onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        cameraMono.aspect = width / height;
        cameraMono.updateProjectionMatrix();

        cameraLeft.aspect = (width / 2) / height;
        cameraLeft.updateProjectionMatrix();

        cameraRight.aspect = (width / 2) / height;
        cameraRight.updateProjectionMatrix();

        renderer.setSize(width, height);
    }
})();
