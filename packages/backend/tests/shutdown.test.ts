// Unit tests for the graceful-shutdown orchestration (src/shutdown.ts) in
// isolation from a real HTTP server, Socket.IO server, or database
// connection -- everything here is a plain mock, so this file does not need
// a live Postgres instance (unlike the rest of this suite, which does via
// tests/globalSetup.ts).
import { describe, it, expect, vi } from 'vitest';
import { createGracefulShutdown } from '../src/shutdown';

function makeDeps(overrides: Partial<Parameters<typeof createGracefulShutdown>[0]> = {}) {
  const httpServer = { close: vi.fn((cb: (err?: Error) => void) => cb()) };
  const io = { close: vi.fn((cb: () => void) => cb()) };
  const prisma = { $disconnect: vi.fn().mockResolvedValue(undefined) };
  const stopCron = vi.fn();
  const onExit = vi.fn();
  const log = vi.fn();
  return { httpServer, io, prisma, stopCron, onExit, log, ...overrides };
}

describe('createGracefulShutdown', () => {
  it('stops the cron, closes the HTTP server, closes Socket.IO, disconnects Prisma, then exits 0', async () => {
    const deps = makeDeps();
    const shutdown = createGracefulShutdown(deps);

    await shutdown('SIGTERM');

    expect(deps.stopCron).toHaveBeenCalledTimes(1);
    expect(deps.httpServer.close).toHaveBeenCalledTimes(1);
    expect(deps.io.close).toHaveBeenCalledTimes(1);
    expect(deps.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(deps.onExit).toHaveBeenCalledWith(0);
  });

  it('works without a Socket.IO server (io is optional)', async () => {
    const deps = makeDeps({ io: null });
    const shutdown = createGracefulShutdown(deps);

    await shutdown('SIGINT');

    expect(deps.httpServer.close).toHaveBeenCalledTimes(1);
    expect(deps.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(deps.onExit).toHaveBeenCalledWith(0);
  });

  it('is idempotent: a second signal while shutdown is already in progress does not re-run the sequence', async () => {
    let resolveClose: (() => void) | undefined;
    const httpServer = {
      close: vi.fn((cb: (err?: Error) => void) => {
        resolveClose = () => cb();
      }),
    };
    const io = { close: vi.fn((cb: () => void) => cb()) };
    const prisma = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    const onExit = vi.fn();
    const log = vi.fn();

    const shutdown = createGracefulShutdown({ httpServer, io, prisma, onExit, log });

    const firstCall = shutdown('SIGTERM');
    // Second signal arrives while the first shutdown is still mid-flight
    // (httpServer.close's callback has not fired yet).
    await shutdown('SIGINT');

    expect(httpServer.close).toHaveBeenCalledTimes(1); // not called again by the second signal
    expect(onExit).not.toHaveBeenCalled(); // first shutdown hasn't finished yet either

    resolveClose?.();
    await firstCall;

    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it('forces exit(1) if shutdown does not complete within the grace period', async () => {
    vi.useFakeTimers();
    try {
      const httpServer = { close: vi.fn(() => { /* never calls back -- simulates a hang */ }) };
      const prisma = { $disconnect: vi.fn().mockResolvedValue(undefined) };
      const onExit = vi.fn();
      const log = vi.fn();

      const shutdown = createGracefulShutdown({ httpServer, prisma, onExit, log, gracePeriodMs: 5000 });
      shutdown('SIGTERM');

      expect(onExit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(onExit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits 1 if Prisma disconnect throws, without hanging', async () => {
    const httpServer = { close: vi.fn((cb: (err?: Error) => void) => cb()) };
    const prisma = { $disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')) };
    const onExit = vi.fn();
    const log = vi.fn();

    const shutdown = createGracefulShutdown({ httpServer, prisma, onExit, log });
    await shutdown('SIGTERM');

    expect(onExit).toHaveBeenCalledWith(1);
  });
});
