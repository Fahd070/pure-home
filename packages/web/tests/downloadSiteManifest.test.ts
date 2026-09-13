// The download site (`website/`) is the only distribution UI, and it must be
// driven entirely by its own release.json — no GitHub API call, no GitHub
// Releases fallback — because the source repository becomes private and every
// github.com request from a visitor's browser would then 404.
//
// `website/index.html` is a single static file with no build step, so these
// tests load the real file into jsdom and run its real inline script. The only
// thing stubbed is `fetch`, which is also how "did it call GitHub?" is proven.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SITE = path.join(ROOT, 'website/index.html');
const MANIFEST = path.join(ROOT, 'website/release.json');

const html = fs.readFileSync(SITE, 'utf-8');
const manifestRaw = fs.readFileSync(MANIFEST, 'utf-8');

const inlineScript = (() => {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  expect(m, 'website/index.html has no inline script').not.toBeNull();
  return m![1];
})();

type SiteApi = {
  loadRelease: () => Promise<void>;
  setLang: (ar: boolean) => void;
  handleDownload: (e: { preventDefault: () => void }) => void;
  release: unknown;
};

/**
 * Mounts the real page and evaluates its real script, minus the bottom
 * `loadRelease()` init call so each test drives loading itself. That the init
 * call exists is asserted separately.
 */
function mountSite(): SiteApi {
  const head = html.match(/<head>([\s\S]*)<\/head>/)![1];
  const body = html
    .match(/<body>([\s\S]*)<\/body>/)![1]
    .replace(/<script>[\s\S]*?<\/script>/, '');
  document.head.innerHTML = head;
  document.body.innerHTML = body;

  const withoutInit = inlineScript.replace(/\n\s*loadRelease\(\);\s*$/, '\n');
  expect(withoutInit).not.toBe(inlineScript); // the init call was really there

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    withoutInit +
      '\nreturn { loadRelease, setLang, handleDownload, get release() { return release; } };'
  );
  return factory() as SiteApi;
}

const VALID = {
  version: 'v9.9.9',
  releasedAt: '2026-08-19T03:47:21Z',
  installer: {
    name: 'Pure-Home-Setup-9.9.9.exe',
    url: 'https://example-host.invalid/blob/Pure-Home-Setup-9.9.9.exe',
    sizeBytes: 107323836,
  },
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Serves one canned response for every request, and records every URL. */
function serve(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  fetchMock = vi.fn(async () => response as Response);
  (globalThis as any).fetch = fetchMock;
}

const ok = (body: unknown) =>
  serve({ ok: true, status: 200, json: async () => body });

const el = (id: string) => document.getElementById(id)!;
const btn = () => el('download-btn');

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Download site: the page never contacts GitHub', () => {
  it('contains no GitHub API endpoint or releases link in executable code', () => {
    // Comments may still explain the history; code may not reach github.com.
    const code = inlineScript.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/api\.github\.com/);
    expect(code).not.toMatch(/github\.com/);
    expect(code).not.toMatch(/RELEASES_URL|LATEST_API|GITHUB_OWNER|GITHUB_REPO/);
    // ...and the footer's "All Releases" link is gone, not merely repointed.
    expect(html).not.toMatch(/id="releases-link"/);
  });

  it('fetches exactly one URL, the local manifest', async () => {
    ok(VALID);
    const site = mountSite();
    await site.loadRelease();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('./release.json');
    // The manifest changes every release; a cached copy keeps serving the
    // previous installer's URL.
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('still kicks off the load on page init', () => {
    expect(inlineScript).toMatch(/\n\s*loadRelease\(\);\s*$/);
  });
});

describe('Download site: a valid manifest drives the page', () => {
  it('renders version, date and size, and points Download at the installer', async () => {
    ok(VALID);
    const site = mountSite();
    await site.loadRelease();

    expect(el('version').textContent).toBe('v9.9.9');
    expect(el('size').textContent).toBe('102 MB'); // 107323836 B, rounded
    expect(el('date').textContent).not.toBe('—');
    expect(el('date').textContent!.trim()).not.toBe('');

    expect(btn().getAttribute('href')).toBe(VALID.installer.url);
    expect(btn().classList.contains('loading')).toBe(false);
    expect(btn().classList.contains('disabled')).toBe(false);
    expect(btn().hasAttribute('aria-disabled')).toBe(false);
    expect((el('load-error') as HTMLElement).hidden).toBe(true);
    expect(el('btn-label').textContent).toBe('تنزيل Pure Home');
  });

  it('lets a click through once a manifest has loaded', async () => {
    ok(VALID);
    const site = mountSite();
    await site.loadRelease();

    const preventDefault = vi.fn();
    site.handleDownload({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('switches language without refetching or losing the release', async () => {
    ok(VALID);
    const site = mountSite();
    await site.loadRelease();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    site.setLang(false);
    // A language toggle must never be able to turn a working page into the
    // failure state (the old version re-fetched on every toggle).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el('btn-label').textContent).toBe('Download Pure Home');
    expect(btn().getAttribute('href')).toBe(VALID.installer.url);
    expect(el('version').textContent).toBe('v9.9.9');
    expect((el('load-error') as HTMLElement).hidden).toBe(true);
  });
});

describe('Download site: the in-flight load is not a failure', () => {
  it('a language toggle mid-fetch does not claim the release could not be loaded', async () => {
    // On a slow link the visitor can toggle language before the manifest lands.
    // render() must treat "not known yet" as loading, not as failure -- popping
    // a red role="alert" over a healthy request and then retracting it is worse
    // than saying nothing.
    let settle: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { settle = r; });
    fetchMock = vi.fn(() => pending as Promise<Response>);
    (globalThis as any).fetch = fetchMock;

    const site = mountSite();
    const loading = site.loadRelease();

    site.setLang(false);
    expect((el('load-error') as HTMLElement).hidden).toBe(true);
    expect(btn().classList.contains('disabled')).toBe(false);
    expect(btn().classList.contains('loading')).toBe(true);
    expect(el('btn-label').textContent).toBe('Loading...');

    settle({ ok: true, status: 200, json: async () => VALID });
    await loading;

    // ...and once it lands, the normal success state appears.
    expect(btn().getAttribute('href')).toBe(VALID.installer.url);
    expect(btn().classList.contains('loading')).toBe(false);
    expect((el('load-error') as HTMLElement).hidden).toBe(true);
    expect(el('btn-label').textContent).toBe('Download Pure Home');
  });

  it('keeps the download inert while still loading', async () => {
    let settle: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { settle = r; });
    fetchMock = vi.fn(() => pending as Promise<Response>);
    (globalThis as any).fetch = fetchMock;

    const site = mountSite();
    const loading = site.loadRelease();

    const preventDefault = vi.fn();
    site.handleDownload({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();

    settle({ ok: true, status: 200, json: async () => VALID });
    await loading;
  });
});

describe('Download site: a broken manifest disables the download', () => {
  const BROKEN: [string, () => void][] = [
    ['missing (404)', () => serve({ ok: false, status: 404, json: async () => ({}) })],
    ['server error (500)', () => serve({ ok: false, status: 500, json: async () => ({}) })],
    ['network failure', () => { fetchMock = vi.fn(async () => { throw new Error('offline'); }); (globalThis as any).fetch = fetchMock; }],
    ['not JSON', () => serve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })],
    ['no installer', () => ok({ version: 'v9.9.9', releasedAt: VALID.releasedAt })],
    ['no installer.url', () => ok({ ...VALID, installer: { name: 'x.exe', sizeBytes: 1 } })],
    ['empty installer.url', () => ok({ ...VALID, installer: { ...VALID.installer, url: '' } })],
    ['non-numeric sizeBytes', () => ok({ ...VALID, installer: { ...VALID.installer, sizeBytes: '107323836' } })],
    ['no version', () => ok({ releasedAt: VALID.releasedAt, installer: VALID.installer })],
  ];

  for (const [name, arrange] of BROKEN) {
    it(`${name}: the button is inert and carries no href at all`, async () => {
      arrange();
      const site = mountSite();
      await site.loadRelease();

      // Not a dead "#" and — the whole point — never a GitHub fallback.
      expect(btn().hasAttribute('href')).toBe(false);
      expect(btn().classList.contains('disabled')).toBe(true);
      expect(btn().classList.contains('loading')).toBe(false);
      expect(btn().getAttribute('aria-disabled')).toBe('true');
      expect(document.body.innerHTML).not.toMatch(/github\.com/);

      // A clear failure state, not a silently broken-looking page.
      const err = el('load-error') as HTMLElement;
      expect(err.hidden).toBe(false);
      expect(err.textContent!.trim().length).toBeGreaterThan(0);
      expect(el('version').textContent).toBe('—');
      expect(el('date').textContent).toBe('—');
      expect(el('size').textContent).toBe('—');

      // And a click cannot navigate anywhere.
      const preventDefault = vi.fn();
      site.handleDownload({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
    });
  }

  it('states the failure in both languages', async () => {
    serve({ ok: false, status: 404, json: async () => ({}) });
    const site = mountSite();
    await site.loadRelease();

    const err = el('load-error') as HTMLElement;
    expect(err.textContent!.trim()).toMatch(/[؀-ۿ]/); // Arabic by default
    expect(el('btn-label').textContent).toBe('التنزيل غير متاح حالياً');

    site.setLang(false);
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/could not be loaded/i);
    expect(el('btn-label').textContent).toBe('Download unavailable');
    expect(btn().hasAttribute('href')).toBe(false);
  });
});

describe('website/release.json — the shipped manifest', () => {
  const manifest = JSON.parse(manifestRaw);

  it('has every field the page requires, with the right types', () => {
    expect(typeof manifest.version).toBe('string');
    expect(manifest.version).not.toBe('');
    expect(typeof manifest.releasedAt).toBe('string');
    expect(Number.isNaN(new Date(manifest.releasedAt).getTime())).toBe(false);
    expect(typeof manifest.installer.name).toBe('string');
    expect(typeof manifest.installer.url).toBe('string');
    expect(Number.isInteger(manifest.installer.sizeBytes)).toBe(true);
    expect(manifest.installer.sizeBytes).toBeGreaterThan(0);
  });

  it('points at a plain HTTPS installer that needs no credential', () => {
    // The download site is public and cannot sign a request, so the URL has to
    // be fetchable as-is — no token, no signature, no expiry.
    expect(manifest.installer.url).toMatch(/^https:\/\//);
    expect(manifest.installer.url).toMatch(/\.exe$/);
    expect(manifest.installer.url).not.toMatch(/[?&](token|sig|signature|expires|key)=/i);
  });

  it('renders through the real page without hitting the failure state', async () => {
    // Guards the actual shipped file, not just a fixture: if someone edits
    // release.json into a shape the page rejects, this fails.
    ok(manifest);
    const site = mountSite();
    await site.loadRelease();

    expect(btn().getAttribute('href')).toBe(manifest.installer.url);
    expect(btn().classList.contains('disabled')).toBe(false);
    expect(el('version').textContent).toBe(manifest.version);
    expect((el('load-error') as HTMLElement).hidden).toBe(true);
  });
});
