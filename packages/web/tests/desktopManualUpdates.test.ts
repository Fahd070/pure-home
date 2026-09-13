// v4 distribution policy: MANUAL UPDATES ONLY.
//
// The desktop app must perform no automatic update check, download, or
// install. The Electron main process cannot be booted under vitest (it needs a
// real `electron` runtime), so these are structural assertions against the
// source that would actually ship. They are deliberately narrow: each one
// fails if, and only if, an automatic update path is reintroduced.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const MAIN = path.join(ROOT, 'packages/unified-app/electron/main/index.ts');
const PKG = path.join(ROOT, 'packages/unified-app/package.json');
const SRC = path.join(ROOT, 'packages/unified-app/src');

const mainSource = fs.readFileSync(MAIN, 'utf-8');

/**
 * Strips `//` comments so an assertion can't be satisfied (or defeated) by
 * prose. The negative lookbehind keeps `file://` / `https://` intact, which is
 * the only way `//` appears mid-line in this file.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');

/** The body of `function setupUpdater()`, by brace matching. */
function setupUpdaterBody(source: string): string {
  const marker = 'function setupUpdater(): void {';
  const start = source.indexOf(marker);
  expect(start, 'setupUpdater() not found — this test is pointed at the wrong file').toBeGreaterThan(-1);
  let depth = 0;
  let i = start + marker.length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

/** Removes every `ipcMain.handle(...)` call, body included, by paren matching. */
function stripIpcHandlers(src: string): string {
  const MARK = 'ipcMain.handle';
  let out = '';
  let i = 0;
  for (;;) {
    const idx = src.indexOf(MARK + '(', i);
    if (idx === -1) return out + src.slice(i);
    out += src.slice(i, idx);
    let depth = 0;
    let j = idx + MARK.length;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    i = j + 1;
  }
}

describe('Desktop: no automatic update check', () => {
  const body = stripComments(setupUpdaterBody(mainSource));
  const code = stripComments(mainSource);

  it('never calls checkForUpdates anywhere in the main process', () => {
    // The single trigger this policy removed. Comments mentioning it are
    // stripped above, so only a real call can fail this.
    expect(code).not.toMatch(/checkForUpdates\s*\(/);
    expect(code).not.toMatch(/checkForUpdatesAndNotify/);
  });

  it('arms no timer inside the updater setup', () => {
    // The old trigger was a 5 s setTimeout. Neither a delayed check nor a
    // polling loop may reappear here. (print-to-pdf's unrelated setTimeout
    // lives outside setupUpdater, which is why this is scoped to the body.)
    expect(body).not.toMatch(/setTimeout/);
    expect(body).not.toMatch(/setInterval/);
  });

  it('only ever touches autoUpdater through listeners and explicit IPC handlers', () => {
    // Every autoUpdater.<method>( in setupUpdater must be either an event
    // subscription or inside an ipcMain.handle callback, i.e. something a user
    // action has to reach. Anything else is, by definition, automatic.
    // Handler bodies span several lines, so they are excised by paren matching
    // rather than by looking for ipcMain.handle on the same line.
    const outsideHandlers = stripIpcHandlers(body);
    const calls = outsideHandlers.match(/autoUpdater\s*\.\s*\w+\s*\(/g) ?? [];
    expect(calls.length, 'no autoUpdater usage found — wrong function?').toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `autoUpdater call outside any IPC handler: ${call}`).toMatch(/\.\s*on\s*\($/);
    }
  });

  it('keeps downloadUpdate and quitAndInstall behind explicit IPC handlers', () => {
    const download = body.match(/^.*autoUpdater\s*\.\s*downloadUpdate\s*\(.*$/gm) ?? [];
    expect(download).toHaveLength(1);
    expect(download[0]).toMatch(/ipcMain\.handle\("update:download"/);

    // quitAndInstall sits in a multi-line handler body, so the assertion is
    // that the handler it belongs to is the explicit "update:install" one.
    expect(body).toMatch(
      /ipcMain\.handle\("update:install",\s*\(\)\s*=>\s*\{[\s\S]*?autoUpdater\.quitAndInstall\(/
    );
    expect((body.match(/quitAndInstall\s*\(/g) ?? [])).toHaveLength(1);
  });

  it('cannot silently download or install even if a check is reintroduced', () => {
    // Config-level guarantee: the policy must not rest solely on one deleted
    // call site. A check added back tomorrow still downloads nothing on its own.
    expect(code).toMatch(/autoUpdater\.autoDownload\s*=\s*false/);
    expect(code).not.toMatch(/autoUpdater\.autoDownload\s*=\s*true/);
    expect(code).toMatch(/autoUpdater\.autoInstallOnAppQuit\s*=\s*false/);
    expect(code).not.toMatch(/autoUpdater\.autoInstallOnAppQuit\s*=\s*true/);
  });

});

describe('Desktop renderer: nothing triggers an update on its own', () => {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  })(SRC);

  it('never calls updater.download() from the renderer', () => {
    // Nothing in the UI kicks off a download; the IPC handler exists but is
    // unreachable, which is what makes the scaffolding genuinely dormant.
    for (const f of files) {
      expect(fs.readFileSync(f, 'utf-8'), f).not.toMatch(/updater\s*\.\s*download\s*\(/);
    }
  });

  it('only calls updater.install() from an explicit click handler', () => {
    const callers = files.filter((f) =>
      /updater\s*\.\s*install\s*\(/.test(fs.readFileSync(f, 'utf-8'))
    );
    expect(callers.map((f) => path.basename(f))).toEqual(['UpdateBanner.tsx']);
    const banner = fs.readFileSync(callers[0], 'utf-8');
    expect(banner).toMatch(/onClick=\{\(\)\s*=>\s*window\.electron\.updater\.install\(\)\}/);
    // ...and never from an effect, which would make it automatic again.
    expect(banner).not.toMatch(/useEffect\([\s\S]{0,400}updater\s*\.\s*install\s*\(/);
  });
});

describe('Desktop build: nothing is uploaded and no credential is needed', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf-8'));

  it('runs electron-builder with --publish never', () => {
    // Without this the publish decision falls back to electron-builder's
    // default policy plus "is GH_TOKEN set?", which is not a guarantee.
    expect(pkg.scripts.build).toContain('electron-builder');
    expect(pkg.scripts.build).toContain('--publish never');
  });

  it('carries no credential in the publish configuration', () => {
    // build.publish is classified as safe dormant metadata (owner + repo name,
    // both already public). It must never grow a token.
    const publish = pkg.build?.publish;
    if (publish) {
      const keys = Object.keys(publish).join(',');
      expect(keys).not.toMatch(/token|secret|password|key/i);
      expect(JSON.stringify(publish)).not.toMatch(/gh[pousr]_[A-Za-z0-9]/);
    }
  });

});
