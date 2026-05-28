// MAYAwe Imager: Main Entry Point

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start');

// Default Nexus URL (Local LAN IP of your PC)
const nexusUrl = `ws://${window.location.hostname}:8080`;

startBtn.addEventListener('click', async () => {
    console.log("MAYAwe Imager Starting...");
    
    const granted = await requestPermissions();
    
    if (granted) {
        statusEl.innerText = "Status: Sensing Active";
        startBtn.style.display = 'none'; // Hide button after start
        
        // Connect to the Nexus Engine
        connectToNexus(nexusUrl);
        
        // Listen for sensor updates
        setSensorCallback((data) => {
            // 1. Send data to Nexus via WebSocket
            sendTelemetry(data);

            // 2. Update the UI for visual confirmation
            statusEl.innerHTML = `
                <b>Sensing Active</b><br>
                DeviceId: ${deviceId}<br>
                Alpha: ${data.rotation.alpha?.toFixed(2)}<br>
                Beta: ${data.rotation.beta?.toFixed(2)}<br>
                Gamma: ${data.rotation.gamma?.toFixed(2)}
            `;
        });
    } else {
        statusEl.innerText = "Status: Permission Denied";
    }
});
