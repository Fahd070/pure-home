import type { Server as HttpServer } from 'http';

// Minimal shape actually used from each dependency, so this module can be unit
// tested with plain mocks instead of a real HTTP server / Socket.IO server /
// Prisma client (which would require a live database connection).
export interface ShutdownDeps {
  httpServer: Pick<HttpServer, 'close'>;
  io?: { close: (callback: () => void) => void } | null;
  prisma: { $disconnect: () => Promise<void> };
  stopCron?: () => void;
  gracePeriodMs?: number;
  onExit?: (code: number) => void;
  log?: (message: string) => void;
}

// Builds an idempotent graceful-shutdown handler for SIGTERM/SIGINT: stop
// accepting new HTTP connections, close Socket.IO, disconnect Prisma, and
// exit -- all bounded by a fallback timeout so a stuck connection can never
// hang the process forever. Calling the returned function more than once
// (e.g. SIGTERM followed by SIGINT before the first finishes) is a no-op
// after the first call.
export function createGracefulShutdown(deps: ShutdownDeps) {
  const {
    httpServer,
    io,
    prisma,
    stopCron,
    gracePeriodMs = 10_000,
    onExit = (code: number) => process.exit(code),
    log = (msg: string) => console.log(msg),
  } = deps;

  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      log(`[shutdown] ${signal} received again while already shutting down -- ignoring`);
      return;
    }
    shuttingDown = true;
    log(`[shutdown] ${signal} received, shutting down gracefully...`);

    // Fallback so a stuck close()/disconnect() can never hang the process
    // forever. unref() so this timer alone never keeps the event loop alive.
    const forceTimer = setTimeout(() => {
      log('[shutdown] grace period exceeded -- forcing exit');
      onExit(1);
    }, gracePeriodMs);
    forceTimer.unref?.();

    try {
      stopCron?.();

      await new Promise<void>((resolve) => {
        httpServer.close((err?: Error) => {
          if (err) log(`[shutdown] HTTP server close error: ${err.message}`);
          resolve();
        });
      });

      if (io) {
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }

      await prisma.$disconnect();

      clearTimeout(forceTimer);
      log('[shutdown] complete');
      onExit(0);
    } catch (err: any) {
      clearTimeout(forceTimer);
      log(`[shutdown] error during shutdown: ${err?.message || err}`);
      onExit(1);
    }
  };
}
