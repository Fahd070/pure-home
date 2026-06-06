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
  // Find the primary LAN IP to display in the startup banner
  let lanIP = 'unknown';
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
    }
    if (lanIP !== 'unknown') break;
  }
  console.log('');
  console.log('  WFM Backend started');
  console.log(`  Local:   http://127.0.0.1:${PORT}`);
  console.log(`  Network: http://${lanIP}:${PORT}  ← use this URL on client PCs`);
  console.log('');
});
