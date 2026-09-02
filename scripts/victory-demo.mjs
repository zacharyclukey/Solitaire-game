/**
 * Watches the victory cascade.
 *
 * Builds a fake cleared board — real card markup, real board.css, real
 * geometry — in a mobile Chromium, plays `playVictory` on it, and shoots the
 * sequence at a spread of moments so it can actually be looked at. Also checks
 * the boring promises: that `done` resolves once, that `skip()` is safe
 * mid-flight, that the reduced-motion path is quick, and that nothing of ours
 * is left in the layer afterwards.
 *
 *   node scripts/victory-demo.mjs [outDir] [cardCount]
 *
 * Nothing here is part of the app; it never touches src/.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? '/tmp/victory-demo';
const count = Number(process.argv[3] ?? 28);

const read = (p) => readFile(join(root, p), 'utf8');
const [base, board, victory] = await Promise.all([
  read('src/styles/base.css'),
  read('src/styles/board.css'),
  read('src/styles/victory.css'),
]);
const { code: victoryJs } = await transform(await read('src/ui/victory.ts'), {
  loader: 'ts',
  format: 'esm',
  target: 'es2020',
});

await mkdir(out, { recursive: true });

const stage = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${base}\n${board}\n${victory}</style></head>
<body><div id="app"><div class="screen active" id="scr-play"><div class="play">
  <div class="hud"><div class="hud-depth">DEPTH<b>7</b></div>
    <div class="hud-moves"><b>12</b><span>moves</span></div></div>
  <div class="progress"><i style="width:100%"></i></div>
  <div class="board-wrap"><div class="board">
    <div class="slots"></div><div class="cards"></div>
  </div></div>
  <div class="actions">
    <button class="act"><span class="act-glyph">↺</span><span class="act-label">Undo</span></button>
    <button class="act"><span class="act-glyph">✦</span><span class="act-label">Hint</span></button>
    <button class="act"><span class="act-glyph">≡</span><span class="act-label">Menu</span></button>
  </div>
</div></div></div></body></html>`;

const driver = `
const RANKS = ['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const PIPS = ['♠','♥','♦','♣'];

/** The card DOM as src/ui/cardview.ts builds it. */
function makeCard(rank, suit, id) {
  const d = document.createElement('div');
  d.className = 'card down';
  d.dataset.id = String(id);
  d.innerHTML =
    '<div class="flip">' +
      '<div class="face front s' + suit + '">' +
        '<div class="corner tl"><span class="r">' + RANKS[rank] + '</span><span class="p">' + PIPS[suit] + '</span></div>' +
        '<div class="centre">' + PIPS[suit] + '</div>' +
      '</div>' +
      '<div class="face back"><div class="weave"></div></div>' +
    '</div>';
  return d;
}

/** Lays out a plausible end-of-level tableau and returns VictoryCard[]. */
window.buildBoard = (n) => {
  const layer = document.querySelector('.cards');
  const boardEl = document.querySelector('.board');
  layer.replaceChildren();
  document.querySelector('.slots').replaceChildren();

  const cols = 7;
  const w = boardEl.clientWidth;
  const h = boardEl.clientHeight;
  const pad = Math.max(4, Math.round(w * 0.012));
  const gap = Math.max(3, Math.round(w * 0.011));
  const cardW = Math.floor((w - pad * 2 - gap * (cols - 1)) / cols);
  const cardH = Math.round(cardW * 1.44);
  boardEl.style.setProperty('--card-w', cardW + 'px');
  boardEl.style.setProperty('--card-h', cardH + 'px');

  const perSuit = Math.ceil(n / 4);
  const deck = [];
  for (let r = 1; r <= perSuit; r++) for (let s = 0; s < 4; s++) deck.push({ rank: r, suit: s });
  deck.length = n;
  // A fixed shuffle, so every run of this demo looks the same.
  let seed = 20260902;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  // The same fan board.ts computes: spread to fill the height, capped, then
  // nudge the whole block down a little so it is not marooned at the top.
  const perCol = Math.ceil(n / cols);
  const upStep = Math.min(Math.round(cardH * 0.66), Math.max(14, Math.floor((h - cardH - 4) / Math.max(1, perCol - 1))));
  const downStep = Math.max(5, Math.round(upStep * 0.53));
  const tallest = cardH + (perCol - 1) * upStep;
  const offsetY = Math.round(Math.max(0, h - tallest) * 0.12);
  const cards = [];
  let id = 0;
  for (let c = 0; c < cols; c++) {
    let y = offsetY;
    for (let i = 0; i < perCol && id < n; i++, id++) {
      const def = deck[id];
      const el = makeCard(def.rank, def.suit, id);
      // Mostly face up, with a scatter of stubborn face-down cards left over.
      const down = (id % 5) === 2;
      el.classList.toggle('down', down);
      el.classList.toggle('up', !down);
      const x = pad + c * (cardW + gap);
      el.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
      el.style.zIndex = String(10 + i);
      layer.append(el);
      cards.push({ el, rank: def.rank, suit: def.suit, x, y });
      y += down ? downStep : upStep;
    }
  }
  window.__geom = { cardW, cardH };
  return cards.length;
};

window.run = (opts) => {
  const layer = document.querySelector('.cards');
  const cards = window.__cards;
  const g = window.__geom;
  window.__lands = 0;
  window.__resolved = 0;
  const t0 = performance.now();
  window.__t0 = t0;
  const h = window.playVictory(layer, cards, {
    cardW: g.cardW,
    cardH: g.cardH,
    reduceMotion: !!(opts && opts.reduceMotion),
    onLand: () => { window.__lands++; },
  });
  window.__handle = h;
  h.done.then(() => { window.__resolved++; window.__ms = Math.round(performance.now() - t0); });
  return true;
};
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
// Half the pixels of a real iPhone 13, and only the played area is captured:
// a screenshot costs the best part of a second at 3x, which would drag the
// very sequence it is meant to be measuring.
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const html = join(out, 'stage.html');
await writeFile(html, stage);
await page.goto('file://' + html);
await page.addScriptTag({ content: victoryJs + '\nwindow.playVictory = playVictory;', type: 'module' });
await page.addScriptTag({ content: driver });
await page.waitForFunction(() => typeof window.playVictory === 'function');

/** buildBoard returns plain data; the elements have to be gathered in-page. */
const prime = async (n) =>
  page.evaluate((k) => {
    window.buildBoard(k);
    const RANKS = { A: 1, J: 11, Q: 12, K: 13 };
    window.__cards = [...document.querySelectorAll('.cards .card')].map((el) => {
      const t = el.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
      const face = el.querySelector('.face.front');
      const label = face.querySelector('.corner .r').textContent;
      return {
        el,
        rank: RANKS[label] ?? Number(label),
        suit: Number(face.className.match(/s(\d)/)[1]),
        x: Number(t[1]),
        y: Number(t[2]),
      };
    });
    return window.__cards.length;
  }, n);

const shot = async (name) => {
  const p = join(out, name + '.png');
  await page.screenshot({ path: p, clip: { x: 0, y: 0, width: 390, height: 560 } });
  return p;
};

const report = {};

/* ------------------------------------------------- the sequence, watched */

await prime(count);
await shot('00-board');

// One play per frame. Even a cheap screenshot costs a few hundred ms of main
// thread, so sampling seven moments out of a single run would smear them all;
// the board is deterministic, so seven runs line up exactly.
const at = (ms) =>
  page.waitForFunction((t) => performance.now() - window.__t0 >= t, ms, { polling: 'raf', timeout: 20000 });
const settle = () => page.waitForFunction(() => window.__resolved > 0, null, { timeout: 15000 });
const marks = [180, 620, 1000, 1400, 1800, 2250, 2600];
const shots = [];
for (const m of marks) {
  await prime(count);
  await page.evaluate(() => window.run({}));
  await at(m);
  const p = await shot(String(m).padStart(4, '0') + 'ms');
  shots.push(p + ' (+' + (await page.evaluate(() => Math.round(performance.now() - window.__t0))) + 'ms by capture end)');
  await settle();
}

// A clean, unwatched run for the numbers.
await prime(count);
await page.evaluate(() => window.run({}));
await settle();
report.full = await page.evaluate(() => ({
  ms: window.__ms,
  lands: window.__lands,
  resolved: window.__resolved,
  leftovers: document.querySelectorAll('.cards .v-slot, .cards .v-burst, .cards .v-ring').length,
  stuckClasses: document.querySelectorAll('.card.v-fly, .card.v-crown, .card.just-flipped').length,
  faceDown: document.querySelectorAll('.card.down').length,
  layerClass: document.querySelector('.cards').className,
}));
shots.push(await shot('9999-settled'));

/* ------------------------------------------------------ 44 cards, timing */

await prime(44);
await page.evaluate(() => window.run({}));
await at(2200);
shots.push(await shot('big-2200ms'));
await settle();
report.big = await page.evaluate(() => ({ ms: window.__ms, lands: window.__lands, resolved: window.__resolved }));

/* --------------------------------------------------------- reduced motion */

await prime(count);
await page.evaluate(() => window.run({ reduceMotion: true }));
await at(120);
shots.push(await shot('reduced-120ms'));
await settle();
report.reduced = await page.evaluate(() => ({
  ms: window.__ms,
  lands: window.__lands,
  resolved: window.__resolved,
  leftovers: document.querySelectorAll('.cards .v-slot, .cards .v-burst, .cards .v-ring').length,
  faceDown: document.querySelectorAll('.card.down').length,
}));

/* ------------------------------------------------------- skip mid-flight */

await prime(count);
await page.evaluate(() => window.run({}));
await at(900);
await page.evaluate(() => { window.__handle.skip(); window.__handle.skip(); });
await page.waitForTimeout(120);
shots.push(await shot('skipped'));
report.skip = await page.evaluate(() => ({
  ms: window.__ms,
  resolved: window.__resolved,
  leftovers: document.querySelectorAll('.cards .v-slot, .cards .v-burst, .cards .v-ring').length,
  stuckClasses: document.querySelectorAll('.card.v-fly, .card.v-crown').length,
  faceDown: document.querySelectorAll('.card.down').length,
  onFoundation: [...document.querySelectorAll('.cards .card')].filter((c) => {
    const m = c.style.transform.match(/translate3d\([-\d.]+px,\s*([-\d.]+)px/);
    return m && Number(m[1]) < window.__geom.cardH * 0.5;
  }).length,
  running: document.getAnimations().filter((a) => a.playState === 'running').length,
}));

report.errors = errors;
report.shots = shots;
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (errors.length) process.exit(1);
