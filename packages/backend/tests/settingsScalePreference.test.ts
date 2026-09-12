// v4 Requirement #15: the settings endpoint must let a v4 client tell
// "this user has never saved anything" apart from "this user deliberately
// chose the middle scale" -- WITHOUT changing the response shape the shipped
// Desktop v3.6.5 client reads.
//
// Before this, GET synthesized `interfaceScale: 'normal'` for a user with no
// saved row and offered no way to know it was synthesized, so hydrating from
// the server silently overwrote the client's own first-run default. The fix is
// additive: the legacy field keeps its legacy value, and the new
// `hasSavedSettings` boolean carries the fact v4 needs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestServer, stopTestServer, TestServer } from './helpers/testServer';
import { ensureTestUsers, signTestToken, TestUsers } from './helpers/fixtures';
import prisma from '../src/prisma';

describe('Settings — unset vs explicit interface scale', () => {
  let ts: TestServer;
  let users: TestUsers;
  let token: string;
  let userId: string;

  const get = () =>
    request(ts.baseUrl).get('/api/settings').set('Authorization', `Bearer ${token}`);
  const put = (body: Record<string, unknown>) =>
    request(ts.baseUrl).put('/api/settings').set('Authorization', `Bearer ${token}`).send(body);

  // Every case starts from "this user has never saved anything", which is
  // exactly "no user_settings row" -- the only thing that creates one is PUT.
  const clearSaved = () => prisma.$executeRaw`DELETE FROM "user_settings" WHERE "userId" = ${userId}`;

  beforeAll(async () => {
    ts = await startTestServer();
    users = await ensureTestUsers();
    // Scheduling, so this file never fights settings.test.ts over the admin row.
    userId = users.scheduling.id;
    token = signTestToken(userId, 'SCHEDULING');
  });

  afterAll(async () => {
    await clearSaved();
    await stopTestServer(ts.server);
  });

  it('keeps the legacy interfaceScale field present when nothing has been saved', async () => {
    await clearSaved();
    const res = await get();
    expect(res.status).toBe(200);
    // THE v3.6.5 CONTRACT TEST. That client reads this field directly and hands
    // it to setAttribute(), so it must still be a legacy-valid value -- never
    // undefined, null, or missing. The "nothing is saved" fact is carried by the
    // additive flag instead, which v3.6.5 simply ignores.
    expect(res.body.data).toHaveProperty('interfaceScale');
    expect(res.body.data.interfaceScale).toBe('normal');
    expect(['compact', 'normal', 'comfortable']).toContain(res.body.data.interfaceScale);
    expect(res.body.data.hasSavedSettings).toBe(false);
  });

  it('marks the synthesized scale as unsaved, and a stored one as saved', async () => {
    // The flag means exactly "a row exists" -- the one thing the database can
    // actually prove. It never claims the user chose their scale on purpose.
    await clearSaved();
    expect((await get()).body.data.hasSavedSettings).toBe(false);

    // A row created by saving something ELSE still counts as saved, and its
    // scale column carries the database default. Deliberately conservative:
    // nothing stored can prove that 'normal' was accidental, so it is treated
    // as authoritative rather than second-guessed.
    await put({ theme: 'dark' });
    const res = await get();
    expect(res.body.data.hasSavedSettings).toBe(true);
    expect(res.body.data.interfaceScale).toBe('normal');
  });

  it('still reports every other default when nothing has been saved', async () => {
    await clearSaved();
    const res = await get();
    // The payload is unmoved apart from one added boolean, so an older client
    // reading theme/fontSize/sound sees exactly what it always did.
    expect(res.body.data.theme).toBe('light');
    expect(res.body.data.fontSize).toBe('medium');
    expect(res.body.data.background).toBe('day');
    expect(res.body.data.soundEnabled).toBe(true);
    expect(res.body.data.soundVolume).toBe(70);
    expect(res.body.data.notificationsEnabled).toBe(true);
  });

  it('reports an explicitly saved middle scale as a real saved value', async () => {
    await clearSaved();
    const saved = await put({ interfaceScale: 'normal' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.interfaceScale).toBe('normal');

    const res = await get();
    // The whole point: a deliberate "normal" survives, and is distinguishable
    // from the unset case above by being present at all.
    expect(res.body.data.interfaceScale).toBe('normal');
    expect(res.body.data.hasSavedSettings).toBe(true);
  });

  it('round-trips each of the three scales', async () => {
    for (const scale of ['compact', 'normal', 'comfortable'] as const) {
      await put({ interfaceScale: scale });
      const res = await get();
      expect(res.body.data.interfaceScale).toBe(scale);
      expect(res.body.data.hasSavedSettings).toBe(true);
    }
  });

  it('rejects a scale outside the three real values', async () => {
    const res = await put({ interfaceScale: 'large' });
    expect(res.status).toBe(400);
  });

  it('does not resurrect a saved scale for a different user', async () => {
    // Preferences are per-user; one user saving a scale must not change what
    // another user's unset account reports.
    await clearSaved();
    await put({ interfaceScale: 'compact' });

    const otherId = users.technician.id;
    await prisma.$executeRaw`DELETE FROM "user_settings" WHERE "userId" = ${otherId}`;
    const otherToken = signTestToken(otherId, 'TECHNICIAN');
    const res = await request(ts.baseUrl).get('/api/settings').set('Authorization', `Bearer ${otherToken}`);
    expect(res.body.data.hasSavedSettings).toBe(false);
    expect(res.body.data.interfaceScale).toBe('normal');

    // ...and the first user's saved value is untouched by that read.
    expect((await get()).body.data.interfaceScale).toBe('compact');
  });

  it('keeps the saved scale when an unrelated setting is changed afterwards', async () => {
    await clearSaved();
    await put({ interfaceScale: 'comfortable' });
    await put({ theme: 'dark' });
    const res = await get();
    // The PUT patches one key at a time, so changing the theme must not reset
    // the scale the user chose earlier.
    expect(res.body.data.interfaceScale).toBe('comfortable');
    expect(res.body.data.theme).toBe('dark');
  });

  it('requires authentication', async () => {
    const res = await request(ts.baseUrl).get('/api/settings');
    expect(res.status).toBe(401);
  });
});
