// MAYAwe Nexus: Self-Signed Certificate Generator
// Generates and caches self-signed SSL/TLS certificates for local HTTPS & WSS
const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

function getPrimaryLanIp() {
    const interfaces = os.networkInterfaces();
    // 1st priority: Active Wi-Fi / WLAN interface
    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('wi-fi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }
    // 2nd priority: Normal physical LAN interfaces (exclude tailscale, virtual, vbox, wsl, etc)
    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('virtual') || lowerName.includes('vbox') || lowerName.includes('wsl') || lowerName.includes('vmware') || lowerName.includes('docker') || lowerName.includes('loopback') || lowerName.includes('tailscale')) {
            continue;
        }
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.') || iface.address.startsWith('172.')) {
                    return iface.address;
                }
            }
        }
    }
    // 3rd priority: Any IPv4 non-internal
    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('virtual') || lowerName.includes('vbox') || lowerName.includes('wsl') || lowerName.includes('vmware') || lowerName.includes('docker') || lowerName.includes('tailscale')) {
            continue;
        }
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function getAllIpv4Addresses() {
    const interfaces = os.networkInterfaces();
    const ips = ['127.0.0.1'];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return Array.from(new Set(ips));
}

function getOrCreateCert(certDir = __dirname) {
    const certPath = path.join(certDir, 'cert.pem');
    const keyPath = path.join(certDir, 'key.pem');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        try {
            const cert = fs.readFileSync(certPath, 'utf8');
            const key = fs.readFileSync(keyPath, 'utf8');
            if (cert && key && cert.includes('BEGIN CERTIFICATE') && key.includes('BEGIN PRIVATE KEY')) {
                return { cert, key, cached: true };
            }
        } catch (err) {
            console.warn('[Nexus Cert] Failed reading cached certs, regenerating...', err.message);
        }
    }

    console.log('[Nexus Cert] Generating new self-signed TLS certificate for LAN...');
    const localIps = getAllIpv4Addresses();
    const altNames = [
        { type: 2, value: 'localhost' },
        ...localIps.map(ip => ({ type: 7, ip: ip }))
    ];

    const attrs = [
        { name: 'commonName', value: 'MAYAwe-Nexus' },
        { name: 'organizationName', value: 'MAYAwe Spatial Systems' },
        { shortName: 'OU', value: 'Nexus Engine' }
    ];

    const pems = selfsigned.generate(attrs, {
        keySize: 2048,
        days: 365,
        algorithm: 'sha256',
        extensions: [
            {
                name: 'basicConstraints',
                cA: true
            },
            {
                name: 'subjectAltName',
                altNames: altNames
            }
        ]
    });

    try {
        fs.writeFileSync(certPath, pems.cert, 'utf8');
        fs.writeFileSync(keyPath, pems.private, 'utf8');
        console.log(`[Nexus Cert] Saved certificates to ${certPath} and ${keyPath}`);
    } catch (err) {
        console.warn('[Nexus Cert] Could not persist certificates to disk, using in-memory:', err.message);
    }

    return { cert: pems.cert, key: pems.private, cached: false };
}

if (require.main === module) {
    const result = getOrCreateCert();
    console.log('Certificate ready. Cached:', result.cached);
    console.log('Primary LAN IP:', getPrimaryLanIp());
    console.log('All IPv4:', getAllIpv4Addresses());
}

module.exports = {
    getOrCreateCert,
    getPrimaryLanIp,
    getAllIpv4Addresses
};
