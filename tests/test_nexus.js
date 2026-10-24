#!/usr/bin/env node
/**
 * MAYAwe V2 - Nexus Unit & Endpoint Tests
 * Validates syntax, starts server on dynamic ports, and tests /api/status over HTTP & HTTPS.
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

const { execSync, spawn } = require('child_process');
const http = require('http');
const https = require('https');
const net = require('net');

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

function fetchJson(url, isHttps = false) {
    return new Promise((resolve, reject) => {
        const client = isHttps ? https : http;
        const req = client.get(url, { rejectUnauthorized: false, timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });
    });
}

async function waitForServer(url, isHttps, maxWaitMs = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        try {
            const res = await fetchJson(url, isHttps);
            if (res.statusCode === 200) return res;
        } catch (e) {
            // Server not ready yet
        }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`Server failed to respond at ${url} within ${maxWaitMs}ms`);
}

async function run() {
    console.log('[1/4] Running JavaScript syntax checks on nexus files...');
    execSync(`node --check "${path.join(nexusDir, 'server.js')}"`, { stdio: 'inherit' });
    execSync(`node --check "${path.join(nexusDir, 'generate_cert.js')}"`, { stdio: 'inherit' });
    console.log('  -> Syntax check passed for server.js and generate_cert.js');

    console.log('[2/4] Allocating dynamic test ports...');
    const httpsPort = await getFreePort();
    const httpPort = await getFreePort();
    console.log(`  -> Selected dynamic ports: HTTPS=${httpsPort}, HTTP=${httpPort}`);

    console.log('[3/4] Spawning Nexus server child process...');
    const serverProcess = spawn(
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

    let serverOutput = '';
    serverProcess.stdout.on('data', d => { serverOutput += d.toString(); });
    serverProcess.stderr.on('data', d => { serverOutput += d.toString(); });

    serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0 && !serverProcess.killed) {
            console.error(`Nexus server exited prematurely with code ${code}. Output:\n${serverOutput}`);
        }
    });

    try {
        const httpUrl = `http://127.0.0.1:${httpPort}/api/status`;
        const httpsUrl = `https://127.0.0.1:${httpsPort}/api/status`;

        console.log('[4/4] Verifying /api/status endpoint responses...');
        console.log(`  -> Waiting for HTTP endpoint: ${httpUrl}`);
        const httpRes = await waitForServer(httpUrl, false, 8000);
        console.log(`  -> HTTP status: ${httpRes.statusCode}`);
        if (httpRes.statusCode !== 200 || httpRes.body?.status !== 'online') {
            throw new Error(`Unexpected HTTP status payload: ${JSON.stringify(httpRes.body)}`);
        }
        if (httpRes.body.version !== '2.0.0') {
            throw new Error(`Expected version 2.0.0, got ${httpRes.body.version}`);
        }

        console.log(`  -> Waiting for HTTPS endpoint: ${httpsUrl}`);
        const httpsRes = await waitForServer(httpsUrl, true, 8000);
        console.log(`  -> HTTPS status: ${httpsRes.statusCode}`);
        if (httpsRes.statusCode !== 200 || httpsRes.body?.status !== 'online') {
            throw new Error(`Unexpected HTTPS status payload: ${JSON.stringify(httpsRes.body)}`);
        }

        console.log('\nAll Nexus endpoint and syntax tests PASSED successfully! [Exit 0]');
    } finally {
        console.log('Shutting down test Nexus server...');
        serverProcess.kill('SIGTERM');
        // Give time for graceful shutdown
        await new Promise(r => setTimeout(r, 500));
        try {
            serverProcess.kill('SIGKILL');
        } catch (e) {}
    }
}

run().then(() => {
    process.exit(0);
}).catch(err => {
    console.error(`\nNexus test FAILED: ${err.message}`, err);
    process.exit(1);
});
