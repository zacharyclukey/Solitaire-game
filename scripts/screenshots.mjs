/**
 * Store screenshot capture.
 *
 * Drives the *built* game through a real run with Playwright — the same
 * approach `scripts/qa.mjs` uses, including the `?qa=1` bridge and
 * `window.facedown.qaSolve()` — and photographs it at the exact pixel sizes
 * the App Store and Google Play ask for.
 *
 *   npm run build
 *   node scripts/screenshots.mjs                 # serves + captures everything
 *   node scripts/screenshots.mjs iphone-6.9      # one device
 *   node scripts/screenshots.mjs --url http://localhost:4173  # use a running server
 *
 * The script starts `npx vite preview --port 4173` itself and shuts it down
 * again unless you point it at a server with `--url`.
 *
 * Chromium: launched with `executablePath: process.env.CHROMIUM_PATH`.
 * On this machine that is
 *   /opt/pw-browsers/chromium-1194/chrome-linux/chrome
 * so run it as:
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *     node scripts/screenshots.mjs
 *
 * Output: store/screenshots/<device>/<nn>-<name>.png  (gitignored)
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

/* ------------------------------------------------------------------ config */

const PORT = 4173;
const OUT_ROOT = 'store/screenshots';

/**
 * Exact store sizes. Playwright renders `viewport × deviceScaleFactor`, so each
 * entry multiplies out to the pixel dimensions in the comment — which are the
 * sizes App Store Connect and the Play Console accept without resampling.
 */
const DEVICES = [
  // Apple — iPhone 6.9" display (iPhone 16 Pro Max class). Required.
  { id: 'iphone-6.9', label: 'iPhone 6.9"', width: 440, height: 956, scale: 3 }, // 1320 x 2868
  // Apple — iPhone 6.5" display (iPhone 11 Pro Max class). Required fallback.
  { id: 'iphone-6.5', label: 'iPhone 6.5"', width: 414, height: 896, scale: 3 }, // 1242 x 2688
  // Apple — iPad 13" display. Required because the app ships for iPad too
  // (TARGETED_DEVICE_FAMILY = "1,2").
  { id: 'ipad-13', label: 'iPad 13"', width: 1032, height: 1376, scale: 2 }, // 2064 x 2752
  // Google Play — phone screenshots.
  { id: 'android-phone', label: 'Android phone', width: 360, height: 640, scale: 3 }, // 1080 x 1920
  // Google Play — 10" tablet screenshots.
  { id: 'android-tablet', label: 'Android tablet', width: 800, height: 1280, scale: 2 }, // 1600 x 2560
];

/** Which level of the run each shot is taken on. */
const AT = { reward: 3, market: 3, fork: 4, board: 4 };
const LEVELS = 4;

/* -------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const urlFlag = argv.indexOf('--url');
const baseUrl = urlFlag >= 0 ? argv[urlFlag + 1] : null;
const only = argv.filter((a) => !a.startsWith('--') && a !== baseUrl);
const devices = only.length ? DEVICES.filter((d) => only.includes(d.id)) : DEVICES;
if (!devices.length) {
  console.error(`No device matched ${only.join(', ')}. Known: ${DEVICES.map((d) => d.id).join(', ')}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ server */

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function serve() {
  const url = `http://localhost:${PORT}`;
  if (baseUrl) return { url: baseUrl, stop: async () => {} };
  if (await reachable(url)) {
    console.log(`• reusing the server already on ${url}`);
    return { url, stop: async () => {} };
  }
  console.log(`• starting vite preview on ${url}`);
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    if (await reachable(url)) {
      return {
        url,
        stop: async () => {
          child.kill('SIGTERM');
        },
      };
    }
    if (child.exitCode !== null) throw new Error('vite preview exited before it was ready');
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`vite preview never answered on ${url} — did you run \`npm run build\`?`);
}

/* ------------------------------------------------------------------- drive */

async function capture(browser, device, url) {
  const dir = join(OUT_ROOT, device.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const ctx = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    // A UA the game cannot tell apart from a real handset, so it takes the same
    // code paths QA does.
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('MIME type')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const shots = [];
  const snap = async (n) => {
    // Let transitions land before the shutter.
    await page.waitForTimeout(500);
    const p = join(dir, `${n}.png`);
    await page.screenshot({ path: p });
    shots.push(p);
    return p;
  };
  const visible = async (sel) =>
    (await page.locator(sel).count()) > 0 && (await page.locator(sel).first().isVisible());

  await page.goto(`${url}/?qa=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  await dismissOverlays(page);
  await page.waitForSelector('#scr-title.active');
  await snap('01-title');

  await page.click('text=Begin a run');
  await page.waitForTimeout(500);

  for (let i = 1; i <= LEVELS; i++) {
    // The fork became a queue: there is one board on offer and a Play button,
    // rather than a row of nodes to choose between.
    await page.waitForSelector('#scr-fork.active .stage', { timeout: 20000 });
    if (i === AT.fork) await snap('02-fork');

    await page.locator('#scr-fork.active >> text=Play it').first().click();
    await page.waitForTimeout(3400);
    await page.waitForSelector('#scr-play.active');

    const size = await page.evaluate(() => window.facedown.level?.sim.defs.length ?? 30);

    if (i === AT.board) {
      // Play a third of the solver's line so the board reads as a game in
      // progress — some cards turned, columns uneven — then pick a card up so
      // the shot shows a selection with its legal destinations lit.
      const line = await page.evaluate(() => window.facedown.level?.solution?.length ?? 0);
      await page.evaluate((k) => window.facedown.qaSolve(k), Math.max(3, Math.round(line / 5)));
      await page.waitForTimeout(900);
      await selectSomething(page);
      await snap('03-board');
      // Drop the selection before handing the board back to the solver.
      await page.mouse.click(4, Math.round(device.height / 2));
      await page.waitForTimeout(250);
    }

    await page.evaluate(() => window.facedown.qaSolve());
    await page.waitForTimeout(1400 + size * 22);
    await page.waitForSelector('#scr-reward.active', { timeout: 30000 });
    if (i === AT.reward) await snap('04-reward');

    await page.locator('#scr-reward.active .reward').first().click();
    await page.waitForTimeout(600);
    if (await visible('.deck-grid .mini.selectable')) {
      await page.locator('.deck-grid .mini.selectable').first().click();
      await page.waitForTimeout(500);
    }

    if (await visible('#scr-shop.active')) {
      if (i === AT.market) await snap('05-market');
      await page.click('#scr-shop.active >> text=Move on');
      await page.waitForTimeout(500);
    }
  }

  // Abandon from the fork to reach the run summary.
  await page.waitForSelector('#scr-fork.active', { timeout: 20000 });
  await page.click('#scr-fork.active >> text=Menu');
  await page.waitForTimeout(600);
  await page.click('.sheet .btn.danger');
  await page.waitForTimeout(700);
  await page.click('.sheet-actions .btn.danger');
  await page.waitForTimeout(1800);
  await page.waitForSelector('#scr-over.active', { timeout: 20000 });
  await snap('06-summary');

  await ctx.close();
  return { shots, errors };
}

/**
 * Clears whatever first-run sheets are covering the title screen. The onboarding
 * flow is allowed to change shape, so this handles all three kinds the shell can
 * put up: a panel with a ✕, a dialog with actions (take the last, least
 * committal one — "I know solitaire" rather than "Learn to play"), or a plain
 * dismissable scrim.
 */
async function dismissOverlays(page) {
  for (let i = 0; i < 6; i++) {
    const scrim = page.locator('.scrim.in').last();
    if ((await page.locator('.scrim.in').count()) === 0) return;
    const closeBtn = scrim.locator('.icon-btn');
    const actions = scrim.locator('.sheet-actions .btn');
    if (await closeBtn.count()) {
      await closeBtn.first().click();
    } else if (await actions.count()) {
      await actions.last().click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(450);
  }
  if (await page.locator('.scrim.in').count()) {
    throw new Error('an overlay is still covering the title screen');
  }
}

/**
 * Lifts a card so the shot shows a live selection with its legal destinations
 * lit up. Prefers a card whose destinations include another card (the clearest
 * read of the rule — 7♥ onto 8♠) and settles for an empty column or reserve
 * cell if nothing better is on offer.
 *
 * A card with no legal move only shakes and leaves no selection behind, and the
 * selection is cleared between attempts, so tapping candidates in turn can
 * never accidentally play a move.
 */
async function selectSomething(page) {
  const clear = () =>
    page.evaluate(() => window.facedown?.board?.clearSelection?.()).catch(() => {});
  const cards = page.locator('#scr-play.active .card.up.tail');
  const total = await cards.count();
  let fallback = -1;

  for (let k = total - 1; k >= 0; k--) {
    await clear();
    const card = cards.nth(k);
    if (!(await card.isVisible().catch(() => false))) continue;
    await card.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(200);
    if ((await page.locator('#scr-play.active .card.picked').count()) === 0) continue;
    if ((await page.locator('#scr-play.active .card.target').count()) > 0) return true;
    if (fallback < 0 && (await page.locator('#scr-play.active .target').count()) > 0) fallback = k;
  }

  await clear();
  if (fallback >= 0) {
    await cards.nth(fallback).click().catch(() => {});
    await page.waitForTimeout(200);
    return true;
  }
  console.warn('  ! no card offered a highlighted destination; board shot has no selection');
  return false;
}

/* -------------------------------------------------------------------- main */

const { url, stop } = await serve();
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

let failed = 0;
try {
  for (const device of devices) {
    console.log(`\n▸ ${device.label}  ${device.width * device.scale}x${device.height * device.scale}`);
    const { shots, errors } = await capture(browser, device, url);
    for (const s of shots) {
      const { size } = await stat(s);
      // A blank frame of a flat dark background compresses to almost nothing;
      // anything this small means the capture went wrong.
      const thin = size < 12_000;
      if (thin) failed++;
      console.log(`   ${thin ? '!' : '✓'} ${s}  ${(size / 1024).toFixed(0)} kB`);
    }
    if (errors.length) {
      failed += errors.length;
      console.error(`   ! ${errors.length} page error(s): ${errors.slice(0, 3).join(' | ')}`);
    }
  }
} finally {
  await browser.close();
  await stop();
}

const dirs = await readdir(OUT_ROOT).catch(() => []);
console.log(`\nWrote ${dirs.length} device folder(s) under ${OUT_ROOT}/`);
if (failed) {
  console.error(`${failed} problem(s) — see the ! lines above`);
  process.exit(1);
}
