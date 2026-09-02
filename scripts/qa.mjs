/**
 * End-to-end smoke test: drives a real run through the built game in a mobile
 * browser, clearing levels with the solver's own line, taking rewards, shopping
 * and abandoning, and fails if the page logged a single error.
 *
 *   npm run build && npm run preview &
 *   node scripts/qa.mjs [url] [screenshot-prefix] [levels]
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, devices } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/?qa=1';
const out = process.argv[3] ?? 'qa-out/shot';
const levels = Number(process.argv[4] ?? 8);

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('MIME type')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const shots = [];
const snap = async (n) => { const p = `${out}-${n}.png`; await page.screenshot({ path: p }); shots.push(p); };
await mkdir(dirname(out), { recursive: true });
const visible = async (sel) => (await page.locator(sel).count()) > 0 && (await page.locator(sel).first().isVisible());

// First run offers the guided board; decline it, then close the help sheet
// it falls back to.
if (await visible('.scrim .btn.ghost')) {
  await page.click('.scrim .btn.ghost');
  await page.waitForTimeout(400);
}
if (await visible('.scrim .icon-btn')) {
  await page.click('.scrim .icon-btn');
  await page.waitForTimeout(400);
}
await page.click('text=Begin a run');
await page.waitForTimeout(400);

const log = [];
for (let i = 1; i <= levels; i++) {
  await page.waitForSelector('#scr-fork.active .stage.now', { timeout: 15000 });
  await page.locator('#scr-fork.active .stage.now .btn.primary').click();
  await page.waitForTimeout(3200);
  const info = await page.evaluate(() => {
    const a = window.facedown;
    return { moves: a.level?.budget, cards: a.level?.sim.defs.length, cells: a.level?.cells, relaxed: a.level?.relaxed, mods: a.level?.modifiers };
  });
  await page.evaluate(() => window.facedown.qaSolve());
  await page.waitForTimeout(1200 + info.cards * 20);
  await page.waitForSelector('#scr-reward.active', { timeout: 20000 });
  if (i === 3) await snap('reward');
  log.push(`L${i} ${JSON.stringify(info)}`);
  await page.locator('#scr-reward.active .reward').first().click();
  await page.waitForTimeout(500);
  if (await visible('.deck-grid .mini.selectable')) {
    await page.locator('.deck-grid .mini.selectable').first().click();
    await page.waitForTimeout(400);
  }
  if (await visible('#scr-shop.active')) {
    if (i === 3) await snap('shop');
    const buy = page.locator('#scr-shop.active .shop-item:not(.broke):not(.sold)');
    if ((await buy.count()) > 0) {
      await buy.first().click();
      await page.waitForTimeout(400);
      if (await visible('.deck-grid .mini.selectable')) {
        await page.locator('.deck-grid .mini.selectable').first().click();
        await page.waitForTimeout(400);
      }
    }
    await page.click('#scr-shop.active >> text=Move on');
    await page.waitForTimeout(400);
  }
}
await snap('fork-late');
// deck panel
await page.click('#scr-fork.active .runbar-deck');
await page.waitForTimeout(500);
await snap('deck');
await page.click('.scrim .icon-btn');
await page.waitForTimeout(400);
// abandon to see the summary screen
await page.click('#scr-fork.active >> text=Menu');
await page.waitForTimeout(500);
await page.click('.sheet .btn.danger');
await page.waitForTimeout(700);
await page.click('.sheet-actions .btn.danger');
await page.waitForTimeout(1400);
await snap('over');

console.log(JSON.stringify({ shots, errors, log }, null, 2));
await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} page error(s) during the run`);
  process.exit(1);
}
