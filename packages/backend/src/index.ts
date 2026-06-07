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
  const onRender = !!process.env.RENDER;

  console.log('');
  console.log('  WFM Backend started');

  if (onRender) {
    const serviceUrl = process.env.RENDER_EXTERNAL_URL || `https://wfm-system.onrender.com`;
    console.log(`  Render:     ${serviceUrl}`);
  } else {
    // Local / on-premise: detect Tailscale and LAN addresses for the startup banner
    let tailscaleIP = '';
    let lanIP = '';
    for (const [name, nets] of Object.entries(os.networkInterfaces())) {
      for (const net of nets || []) {
        if (net.family !== 'IPv4' || net.internal) continue;
        const parts = net.address.split('.').map(Number);
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
          tailscaleIP = net.address;
        } else if (!lanIP && name.toLowerCase() !== 'loopback') {
          lanIP = net.address;
        }
      }
    }

    console.log(`  Local:      http://127.0.0.1:${PORT}`);
    if (tailscaleIP) {
      console.log(`  Tailscale:  http://${tailscaleIP}:${PORT}  <- use this URL on all employee PCs`);
    }
    if (lanIP && lanIP !== tailscaleIP) {
      console.log(`  LAN:        http://${lanIP}:${PORT}`);
    }
    if (!tailscaleIP) {
      console.log(`  WARNING: Tailscale IP not detected. Run: tailscale up`);
    }
  }

  console.log('');
});
