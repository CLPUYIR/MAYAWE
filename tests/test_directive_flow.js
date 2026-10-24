#!/usr/bin/env node
/**
 * MAYAwe V2 - Directive Flow Integration Test
 * Verifies that dashboard commands (e.g. CLIMB_CHAIR) are not overwritten
 * by continuous 30Hz idle Aether frames over WebSocket.
 */

const path = require('path');
const repoRoot = path.resolve(__dirname, '..');
const nexusModules = path.join(repoRoot, 'nexus', 'node_modules');

// Ensure module resolution finds nexus packages
if (!process.env.NODE_PATH) {
    process.env.NODE_PATH = nexusModules;
} else {
    process.env.NODE_PATH = `${nexusModules}${path.delimiter}${process.env.NODE_PATH}`;
}
require('module').Module._initPaths();

const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const WebSocket = require('ws');

const nexusDir = path.join(repoRoot, 'nexus');

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close((err) => {
                if (err) reject(err);
                else resolve(port);
            });
        });
    });
}

function waitForHttpReady(url, maxWaitMs = 8000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        function check() {
            const req = http.get(url, { timeout: 1000 }, (res) => {
                if (res.statusCode === 200) return resolve();
                retry();
            });
            req.on('error', retry);
            req.on('timeout', () => { req.destroy(); retry(); });
        }
        function retry() {
            if (Date.now() - start > maxWaitMs) {
                return reject(new Error(`Timeout waiting for ${url}`));
            }
            setTimeout(check, 200);
        }
        check();
    });
}

async function run() {
    console.log('[1/5] Setting up dynamic ports and Nexus server...');
    const httpsPort = await getFreePort();
    const httpPort = await getFreePort();
    console.log(`  -> HTTPS=${httpsPort}, HTTP=${httpPort}`);

    const serverProc = spawn(
        process.execPath,
        [path.join(nexusDir, 'server.js')],
        {
            cwd: nexusDir,
            env: {
                ...process.env,
                HTTPS_PORT: String(httpsPort),
                HTTP_PORT: String(httpPort)
            },
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );

    let serverLogs = '';
    serverProc.stdout.on('data', d => { serverLogs += d.toString(); });
    serverProc.stderr.on('data', d => { serverLogs += d.toString(); });

    try {
        console.log('[2/5] Waiting for server HTTP status endpoint...');
        await waitForHttpReady(`http://127.0.0.1:${httpPort}/api/status`);
        console.log('  -> Nexus server is online.');

        console.log('[3/5] Connecting fake clients (imager, aether, dashboard)...');
        const wsUrl = `ws://127.0.0.1:${httpPort}`;

        const imagerWs = new WebSocket(wsUrl);
        const aetherWs = new WebSocket(wsUrl);
        const dashWs = new WebSocket(wsUrl);

        await Promise.all([
            new Promise(r => imagerWs.on('open', r)),
            new Promise(r => aetherWs.on('open', r)),
            new Promise(r => dashWs.on('open', r))
        ]);

        // Register roles
        imagerWs.send(JSON.stringify({ type: 'register', role: 'imager' }));
        aetherWs.send(JSON.stringify({ type: 'register', role: 'aether' }));
        dashWs.send(JSON.stringify({ type: 'register', role: 'dashboard' }));

        // Track Imager state (mirrors logic in imager/web-client/js/main.js)
        let imagerCurrentMode = 'IDLE_SCAN';
        let imagerLastSeq = -1;

        imagerWs.on('message', (msg) => {
            try {
                const packet = JSON.parse(msg.toString());
                if (packet.type === 'SPATIAL_WORLD_UPDATE_V2' && packet.petDirective) {
                    const dir = packet.petDirective;
                    const seq = dir.directiveSeq;
                    if (seq === undefined || seq === null || seq > imagerLastSeq) {
                        if (seq !== undefined && seq !== null) {
                            imagerLastSeq = seq;
                        }
                        if (dir.state) imagerCurrentMode = dir.state;
                    }
                }
            } catch (e) {}
        });

        // Track Aether adopting directives
        let aetherAdoptedMode = 'IDLE_SCAN';
        aetherWs.on('message', (msg) => {
            try {
                const packet = JSON.parse(msg.toString());
                if (packet.type === 'dashboard_command') {
                    const s = packet.gesture || packet.petState?.mode;
                    if (s) aetherAdoptedMode = s;
                } else if (packet.type === 'SPATIAL_WORLD_UPDATE_V2' && packet.petDirective) {
                    const s = packet.petDirective.state;
                    if (s) aetherAdoptedMode = s;
                }
            } catch (e) {}
        });

        // Allow registration messages to settle
        await new Promise(r => setTimeout(r, 150));

        console.log('[4/5] Sending dashboard_command (CLIMB_CHAIR)...');
        dashWs.send(JSON.stringify({
            type: 'dashboard_command',
            gesture: 'CLIMB_CHAIR',
            petState: { mode: 'CLIMB_CHAIR' },
            speech: 'Climbing chair!'
        }));

        // Wait for command delivery to imager and aether
        await new Promise(r => setTimeout(r, 150));
        console.log(`  -> Imager mode immediately after command: ${imagerCurrentMode}`);
        console.log(`  -> Aether adopted mode after command: ${aetherAdoptedMode}`);

        if (imagerCurrentMode !== 'CLIMB_CHAIR') {
            throw new Error(`Expected Imager to be CLIMB_CHAIR, but got ${imagerCurrentMode}`);
        }
        if (aetherAdoptedMode !== 'CLIMB_CHAIR') {
            throw new Error(`Expected Aether to adopt CLIMB_CHAIR, but got ${aetherAdoptedMode}`);
        }

        console.log('[5/5] Emitting 30 Hz idle Aether frames for 500 ms (15 frames)...');
        const frameIntervalMs = 33;
        const totalFrames = 15;

        for (let i = 0; i < totalFrames; i++) {
            // Emits 30Hz frame without changing directive (Aether only emits directive when changed)
            aetherWs.send(JSON.stringify({
                type: 'SPATIAL_WORLD_UPDATE_V2',
                timestamp: Date.now(),
                dualHandPose: {
                    active: false,
                    gesture: 'NONE',
                    weights: { phone: 0.5, laptop: 0.5, selectedSource: 'synthetic', calibrated: false }
                }
            }));
            await new Promise(r => setTimeout(r, frameIntervalMs));
        }

        console.log(`  -> Imager mode after 500ms of idle Aether frames: ${imagerCurrentMode}`);
        if (imagerCurrentMode !== 'CLIMB_CHAIR') {
            throw new Error(`FAILURE: Imager state was overwritten! Current state: ${imagerCurrentMode}`);
        }

        console.log('\nDirective Flow Integration Test PASSED successfully! [Exit 0]');

        imagerWs.close();
        aetherWs.close();
        dashWs.close();
    } finally {
        serverProc.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 400));
        try { serverProc.kill('SIGKILL'); } catch (e) {}
    }
}

run().then(() => {
    process.exit(0);
}).catch(err => {
    console.error(`\nDirective Flow Test FAILED: ${err.message}`, err);
    process.exit(1);
});
