import { bankCap, dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { growCard, MAX_DECK, newRun, stageSpec } from '../src/game/run.ts';
import { Rng } from '../src/game/rng.ts';
import type { DeckCard, EnchantId, Suit } from '../src/game/types.ts';

/**
 * Does a build move run depth?
 *
 * `humanrun.ts` has a build knob and it reports the same depth for every
 * setting, which looks like "builds do nothing" and is not: the median run ends
 * at depth 2, so a build arriving every 2-4 levels never fires at all. That
 * instrument cannot answer the question.
 *
 * So hand the player the build UP FRONT, at stage 1, which separates build
 * STRENGTH from build ACCUMULATION. Kits are split along the axis the shop now
 * labels, because "does a build help" turns out to depend entirely on which
 * build it is.
 */
// The two classes the shop now labels. Insurance measures NEGATIVE on moves
// banked (Anchor -2.1, Ember -2.5); income measures positive (Resonance +8.6,
// Beacon +4.8). If "does a build help" depends on which build, that is the
// finding rather than "builds are bad". Figures from scripts/worth.ts at 40
// paired boards, re-run 2026-09-09; the previous comment quoted the 20-board
// run those numbers superseded.
const KITS: Record<string, EnchantId[]> = {
  insurance: ['anchor', 'ember', 'twin', 'wild', 'bridge', 'prism'],
  income: ['resonance', 'beacon', 'gild', 'spring', 'free'],
  mixed: ['spring', 'free', 'resonance', 'anchor', 'ember', 'beacon'],
};
const MAX_STAGE = 40;

function run(seed: number, enchants: number, KIT: EnchantId[]): number {
  const r = newRun(seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const deck: DeckCard[] = r.deck.map((c) => ({ ...c }));
  let uid = Math.max(...deck.map((c) => c.uid)) + 1;
  for (let i = 0; i < enchants; i++) {
    const plain = deck.filter((c) => c.ench === null);
    if (plain.length) plain[rng.int(plain.length)].ench = KIT[i % KIT.length];
  }
  let bank = 0;
  for (let stage = 1; stage <= MAX_STAGE; stage++) {
    r.stage = stage;
    const level = dealLevel({ deck, charms: [], spec: stageSpec(r, stage), bonusMoves: 0, bonusCells: 0, bank });
    if (!level.affordable) return stage - 1;
    const res = playBot(level.sim, CAREFUL);
    if (!res.won) return stage - 1;
    // Capped the way the game caps it. Carrying the whole leftover is the
    // unbounded ratchet that was fixed on 2026-09-08 — a playtest reached 600+
    // banked moves — so a harness that still carries it measures a game nobody
    // plays.
    bank = Math.min(res.movesLeft, bankCap(level));
    // Grown by the game's own rule rather than a copy of it. Both this and
    // humanrun.ts used to mirror newCard by hand, and both copies were left
    // behind when growth changed on 2026-09-09: they kept adding exact
    // (rank, suit) duplicates the game no longer generates, and never applied
    // the ladder footing. That is the fifth harness in this project to bite by
    // encoding a rule that had moved.
    if (deck.length < MAX_DECK) deck.push(growCard(deck, rng, uid++));
  }
  return MAX_STAGE;
}

const RUNS = Number(process.argv[2] ?? 30);
console.log(`${RUNS} runs per arm, build handed over at stage 1\n`);
console.log('kit          cards   median  mean   range   reached 5');
for (const [name, kit] of [['(bare)', []], ...Object.entries(KITS)] as [string, EnchantId[]][]) {
 for (const n of (kit.length === 0 ? [0] : [4, 8])) {
  const d: number[] = [];
  for (let i = 0; i < RUNS; i++) d.push(run(4242 + i * 7919, n, kit));
  d.sort((a, b) => a - b);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  console.log(`${name.padEnd(12)} ${String(n).padStart(5)}   ${String(d[d.length >> 1]).padStart(6)} ${mean.toFixed(1).padStart(5)}  ${String(d[0]).padStart(2)}-${String(d[d.length - 1]).padEnd(4)}  ${String(d.filter((x) => x >= 5).length).padStart(8)}`);
 }
}
