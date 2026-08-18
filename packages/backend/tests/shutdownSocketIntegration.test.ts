// Integration test for graceful shutdown against a REAL http.Server + a real
// Socket.IO server/client pair (no mocks for the network layer, no database).
// Proves shutdown completes promptly -- not by waiting out the force
// timeout -- while a WebSocket client is actively connected, and that the
// Socket.IO client, the HTTP server, and Prisma (mocked) are all actually
// closed/disconnected, with a clean idempotent exit.
import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { createGracefulShutdown } from '../src/shutdown';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

function connect(port: number): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

describe('graceful shutdown: real HTTP server + real Socket.IO connection', () => {
  it('closes the live socket and the HTTP server well within the grace period, disconnects Prisma, and exits 0 -- idempotently', async () => {
    const httpServer = http.createServer((_req, res) => res.end('ok'));
    const io = new SocketIOServer(httpServer);
    const port = await listen(httpServer);

    const client = await connect(port);
    const clientDisconnected = new Promise<void>((resolve) => {
      client.once('disconnect', () => resolve());
    });

    const prisma = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    const onExit = vi.fn();
    const log = vi.fn();

    // Short grace period on purpose: if shutdown were to hang waiting on
    // httpServer.close() while the socket is still open, it would only ever
    // resolve via this force-exit path -- the assertion on elapsed time
    // below is what actually proves it did NOT take that path.
    const shutdown = createGracefulShutdown({ httpServer, io, prisma, onExit, log, gracePeriodMs: 4000 });

    const startedAt = Date.now();
    await shutdown('SIGTERM');
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(2000); // did not wait for the 4000ms force timeout
    expect(onExit).toHaveBeenCalledWith(0); // force-exit path (code 1) was never taken

    await clientDisconnected;
    expect(client.connected).toBe(false); // Socket.IO client actually closed
    expect(httpServer.listening).toBe(false); // HTTP server actually closed

    // A fresh connection attempt to the now-closed port must fail.
    await expect(
      new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, timeout: 500 }, resolve).on('error', reject);
      })
    ).rejects.toBeTruthy();

    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);

    // Idempotent: a second signal after shutdown has already completed is a no-op.
    await shutdown('SIGINT');
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);

    client.close();
  }, 10000);
});
