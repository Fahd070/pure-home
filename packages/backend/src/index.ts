import 'dotenv/config';
import http from 'http';
import os from 'os';
import app from './app';
import { initSocket } from './socket';
import { startNotificationCron } from './services/notification.service';

const PORT = parseInt(process.env.PORT || '3001');
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

const server = http.createServer(app);
initSocket(server);
startNotificationCron();
server.listen(PORT, BIND_HOST, () => {
  // Collect all IPv4 addresses and categorise for the startup banner
  let tailscaleIP = '';
  let lanIP = '';
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      // Tailscale CGNAT range: 100.64.0.0/10
      const parts = net.address.split('.').map(Number);
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
        tailscaleIP = net.address;
      } else if (!lanIP && name.toLowerCase() !== 'loopback') {
        lanIP = net.address;
      }
    }
  }

  console.log('');
  console.log('  WFM Backend started');
  console.log(`  Local:      http://127.0.0.1:${PORT}`);
  if (tailscaleIP) {
    console.log(`  Tailscale:  http://${tailscaleIP}:${PORT}  ← use this URL on all employee PCs`);
  }
  if (lanIP && lanIP !== tailscaleIP) {
    console.log(`  LAN:        http://${lanIP}:${PORT}`);
  }
  if (!tailscaleIP) {
    console.log(`  WARNING: Tailscale IP not detected. Install and connect Tailscale first.`);
    console.log(`           See DEPLOYMENT.md → Part A → Step 2`);
  }
  console.log('');
});
