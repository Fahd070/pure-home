/**
 * Responsive test — captures screenshots of every page at three viewport sizes
 * Desktop: 1440x900   Tablet: 768x1024   Mobile: 390x844
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://pure-home-web.vercel.app';
const BACKEND = 'https://wfm-system.onrender.com';
const SHOTS_DIR = path.join(__dirname, '../shots-responsive');
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

const DEVICES = [
  { name: 'desktop', width: 1440, height: 900,  isMobile: false, deviceScaleFactor: 1 },
  { name: 'tablet',  width: 768,  height: 1024, isMobile: true,  deviceScaleFactor: 2 },
  { name: 'mobile',  width: 390,  height: 844,  isMobile: true,  deviceScaleFactor: 3 },
];

const PAGES = [
  { name: '01_dashboard',          path: '#/admin/dashboard' },
  { name: '02_customers',          path: '#/admin/customers' },
  { name: '03_appointments',       path: '#/admin/appointments' },
  { name: '04_urgent_appts',       path: '#/admin/urgent-appointments' },
  { name: '05_tasks',              path: '#/admin/tasks' },
  { name: '06_technicians',        path: '#/admin/technicians' },
  { name: '07_expenses',           path: '#/admin/expenses' },
  { name: '08_reports',            path: '#/admin/reports' },
  { name: '09_settings',           path: '#/admin/settings' },
  { name: '10_access_codes',       path: '#/admin/access-codes' },
];

async function login(page) {
  // Get JWT token from backend
  const resp = await page.evaluate(async (backend) => {
    const r = await fetch(`${backend}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@wfm.local', password: 'admin123' }),
    });
    return r.json();
  }, BACKEND);

  if (!resp?.data?.token) {
    console.warn('  ⚠ Login failed, injecting placeholder token');
    return false;
  }

  // Inject Zustand store
  await page.evaluate((data) => {
    localStorage.setItem('wfm-unified', JSON.stringify({
      state: {
        serverUrl: 'https://wfm-system.onrender.com',
        adminAuth: { user: data.user, token: data.token },
        schedulingAuth: null,
        technicianAuth: null,
        adminLoginTime: Date.now(),
        schedulingLoginTime: 0,
        technicianLoginTime: 0,
      },
      version: 4,
    }));
  }, resp.data);

  await page.reload({ waitUntil: 'networkidle' });
  return true;
}

async function waitForContent(page) {
  // Wait for loading spinners to disappear
  try {
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('[class*="loading"], [class*="spinner"]');
      const loadingTexts = [...document.querySelectorAll('p')].filter(p =>
        p.textContent.includes('جاري التحميل') || p.textContent.includes('Loading'));
      return spinners.length === 0 && loadingTexts.length === 0;
    }, { timeout: 8000 });
  } catch { /* timeout is OK — content may just be loading */ }
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const device of DEVICES) {
    console.log(`\n📱 Device: ${device.name} (${device.width}×${device.height})`);

    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      userAgent: device.isMobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    // Navigate and wait for app to load
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Login
    const ok = await login(page);
    if (!ok) { await context.close(); continue; }

    // Navigate to first admin page to ensure routing works
    await page.goto(`${BASE}/#/admin/dashboard`, { waitUntil: 'networkidle', timeout: 15000 });
    await waitForContent(page);

    for (const pg of PAGES) {
      console.log(`  📸 ${pg.name}`);
      await page.goto(`${BASE}/${pg.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await waitForContent(page);

      const filename = `${device.name}_${pg.name}.png`;
      await page.screenshot({
        path: path.join(SHOTS_DIR, filename),
        fullPage: false,
      });
      console.log(`     ✅ saved ${filename}`);
    }

    // Test sidebar open on tablet/mobile
    if (device.isMobile) {
      console.log(`  📸 sidebar_open`);
      await page.goto(`${BASE}/#/admin/dashboard`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await waitForContent(page);

      const hamburger = page.locator('button[aria-label="Menu"]').first();
      if (await hamburger.isVisible()) {
        await hamburger.click();
        await page.waitForTimeout(400);
        const filename = `${device.name}_11_sidebar_open.png`;
        await page.screenshot({ path: path.join(SHOTS_DIR, filename), fullPage: false });
        console.log(`     ✅ saved ${filename}`);
      } else {
        console.log(`     ⚠ hamburger not visible`);
      }
    }

    await context.close();
  }

  await browser.close();
  console.log(`\n✅ All screenshots saved to: ${SHOTS_DIR}`);
})();
