import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { MAX_DECK, newRun, stageSpec } from '../src/game/run.ts';
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
// The two classes the shop now labels. Insurance measured NEGATIVE on moves
// banked (Anchor -1.7, Ember -2.6); income measured positive (Resonance +9.0,
// Beacon +5.1). If "does a build help" depends on which build, that is the
// finding rather than "builds are bad".
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
    bank = res.movesLeft;
    // Mirrors run.ts's newCard, which is not exported. Uniform ranks 1-13 are
    // NOT what the game generates, and growing decks that way is one of this
    // project's four documented harness artifacts: the real generator extends
    // the rank ladder 65% of the time, because high ranks are the scarce
    // resource (only they can base a column). Measured, the uniform version
    // shortens runs by about a quarter. The MAX_DECK cap matters for the same
    // reason — the game refuses to add past it.
    if (deck.length < MAX_DECK) {
      const hi = Math.max(...deck.map((c) => c.rank));
      const rank = hi < 13 && rng.next() < 0.65 ? hi + 1 : rng.range(1, hi);
      deck.push({ uid: uid++, rank, suit: rng.int(4) as Suit, ench: null, curse: null });
    }
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
