// Builds a real, ephemeral-port HTTP+Socket.IO server per test file, reusing the
// application's own exported Express app (src/app.ts) and initSocket (src/socket.ts).
// Deliberately does NOT import src/index.ts, since that module has top-level side
// effects (binds a real port from env-derived PORT/BIND_HOST, starts the notification
// cron) that are unsuitable for a test-controlled, isolated server lifecycle.
import http from 'http';
import app from '../../src/app';
import { initSocket } from '../../src/socket';

export interface TestServer {
  server: http.Server;
  port: number;
  baseUrl: string;
}

export async function startTestServer(): Promise<TestServer> {
  const server = http.createServer(app);
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, port, baseUrl: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
