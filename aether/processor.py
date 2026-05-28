import asyncio
import websockets
import json
import numpy as np

# Aether: Spatial Intelligence Processor
# This service subscribes to telemetry from Nexus and performs analysis.

class AetherProcessor:
    def __init__(self):
        self.last_pose = None
        print("Aether Intelligence Layer Initialized.")

    async def process_telemetry(self, packet):
        device_id = packet.get("deviceId")
        data = packet.get("data", {})
        rotation = data.get("rotation", {})
        
        alpha = rotation.get("alpha", 0)
        beta = rotation.get("beta", 0)
        gamma = rotation.get("gamma", 0)

        # Basic "Rapid Movement" detection
        if self.last_pose:
            d_alpha = abs(alpha - self.last_pose['alpha'])
            d_beta = abs(beta - self.last_pose['beta'])
            
            if d_alpha > 30 or d_beta > 30:
                print(f"⚠️ [Aether] Rapid movement detected on {device_id}!")

        self.last_pose = {'alpha': alpha, 'beta': beta, 'gamma': gamma}

    async def connect_to_nexus(self, uri):
        async with websockets.connect(uri) as websocket:
            print(f"Aether connected to Nexus at {uri}")
            async for message in websocket:
                try:
                    packet = json.loads(message)
                    if packet.get("type") == "telemetry":
                        await self.process_telemetry(packet)
                except Exception as e:
                    print(f"Error processing packet: {e}")

if __name__ == "__main__":
    aether = AetherProcessor()
    # Replace 'localhost' with Nexus IP if running on a different machine
    asyncio.run(aether.connect_to_nexus("ws://localhost:8080"))
