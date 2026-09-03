/**
 * How deep does a bounded-lookahead player actually get?
 *
 * Every economy number so far comes from solver play, which banks moves nobody
 * would bank. This plays whole runs with the fallible player in
 * `src/game/bot.ts`, carrying the bank the way a real run does, and reports
 * where runs end and why.
 *
 * The deck growth model is explicit rather than driven through the reward UI:
 * one card per level cleared, and one enchantment every `buildEvery` levels.
 * That is the knob being measured — "build strength" is exactly how often the
 * player converts a reward into permanent power.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot, type BotOptions } from '../src/game/bot.ts';
import { MODIFIERS, type ModifierId } from '../src/game/content.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { Rng } from '../src/game/rng.ts';
import type { DeckCard, EnchantId, Suit } from '../src/game/types.ts';

const KIT: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism', 'conduit', 'resonance'];
const MAX_STAGE = 40;

/**
 * "Lost the board" was too coarse to act on: running out of moves is an economy
 * failure and being stuck with moves in hand is a structural one, and they want
 * opposite fixes. Bankruptcy is a third thing again — it fires only when no
 * affordable board could be dealt at all, which is why it can read zero while
 * players are still losing levels to the purse.
 */
type Cause = 'bankrupt' | 'ran out of moves' | 'stuck with moves left' | 'reached the cap';

interface RunOutcome {
  depth: number;
  cause: Cause;
  peakBank: number;
}

function playRun(seed: number, buildEvery: number, o: BotOptions): RunOutcome {
  const run = newRun(seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const deck: DeckCard[] = run.deck.map((c) => ({ ...c }));
  let uid = Math.max(...deck.map((c) => c.uid)) + 1;
  let bank = 0;
  let peakBank = 0;

  for (let stage = 1; stage <= MAX_STAGE; stage++) {
    run.stage = stage;
    const spec = stageSpec(run, stage);
    const level = dealLevel({ deck, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank });
    if (!level.affordable) return { depth: stage - 1, cause: 'bankrupt', peakBank };

    const r = playBot(level.sim, o);
    if (!r.won) {
      const cause: Cause = r.movesLeft <= 0 ? 'ran out of moves' : 'stuck with moves left';
      return { depth: stage - 1, cause, peakBank };
    }

    bank = r.movesLeft;
    peakBank = Math.max(peakBank, bank);

    // The rewards a cleared level would have paid.
    deck.push({ uid: uid++, rank: rng.range(1, 13), suit: rng.int(4) as Suit, ench: null, curse: null });
    if (buildEvery > 0 && stage % buildEvery === 0) {
      const plain = deck.filter((c) => c.ench === null);
      if (plain.length) plain[rng.int(plain.length)].ench = KIT[rng.int(KIT.length)];
    }
  }
  return { depth: MAX_STAGE, cause: 'reached the cap', peakBank };
}

/**
 * Board-level skill gap: how much more than the solver's line this player needs
 * on the same board, and how often it fails outright given room to breathe.
 * Full runs die too early to say much, so this is the more useful instrument.
 */
function boardSweep(perStage: number): void {
  // Measured against plainPar, not par, because plainPar is what the ratio
  // multiplies. Bank 999, so the only thing under test is skill.
  console.log('\nstage  won      spend vs plainPar (p50 / p75 / p90)');
  for (const stage of [1, 3, 6, 8, 10, 14, 18]) {
    const spends: number[] = [];
    let won = 0;
    for (let i = 0; i < perStage; i++) {
      // Fresh run seed per board so the modifier draw varies.
      const run = newRun((31337 + i * 104729) >>> 0);
      run.stage = stage;
      const l = dealLevel({
        deck: run.deck, charms: [], spec: stageSpec(run, stage),
        bonusMoves: 0, bonusCells: 0, bank: 999,
      });
      const r = playBot(l.sim, CAREFUL);
      if (r.won) {
        won++;
        spends.push(r.movesUsed / l.plainPar);
      }
    }
    spends.sort((a, b) => a - b);
    const q = (f: number) => (spends.length ? spends[Math.min(spends.length - 1, Math.floor(spends.length * f))] : NaN);
    console.log(
      `${String(stage).padStart(5)}  ${String(won).padStart(2)}/${perStage}  ` +
      `${(q(0.5) * 100).toFixed(0).padStart(12)}%  ${(q(0.75) * 100).toFixed(0).padStart(4)}%  ${(q(0.9) * 100).toFixed(0).padStart(4)}%`,
    );
  }
}

/**
 * One line per board: the features of the deal, and whether the fallible player
 * cleared it with money no object. Feeding a correlation, not a summary — the
 * question is which generator knobs predict a board no person can finish.
 */
function diagnose(perStage: number): void {
  console.log('stage cols stock hidden deepest par relaxed won left mods');
  for (const stage of [6, 8, 10, 12, 14, 16, 18, 20]) {
    for (let i = 0; i < perStage; i++) {
      // A fresh run seed per board, or every board at a stage draws the same
      // modifiers and the sweep says nothing about which of them hurt.
      const run = newRun((31337 + i * 104729) >>> 0);
      run.stage = stage;
      const spec = stageSpec(run, stage);
      const l = dealLevel({ deck: run.deck, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank: 999 });
      const heights = l.sim.cols.slice(0, l.columns).map((c) => c.length);
      const deepest = Math.max(...heights);
      const hidden = l.sim.hidden; // before play: playBot mutates the sim
      const r = playBot(l.sim, CAREFUL);
      console.log(
        `${String(stage).padStart(5)} ${String(l.columns).padStart(4)} ${String(l.stockSize).padStart(5)} ` +
        `${String(hidden).padStart(6)} ${String(deepest).padStart(7)} ${String(l.par).padStart(3)} ` +
        `${String(l.relaxed).padStart(7)} ${r.won ? '  1' : '  0'} ${String(r.remaining).padStart(4)} ${l.modifiers.join(',')}`,
      );
    }
  }
}

/**
 * One modifier at a time, against the same seeds with none.
 *
 * The marginal deltas from `diagnose` cannot be trusted: modifiers are drawn
 * together and more of them means a deeper stage, so every effect is confounded
 * with every other. The proof is in that sweep's own output — Steady Hand (no
 * undos) scored -23pp and Austerity (stipend only, irrelevant at an unlimited
 * bank) -18pp, and neither can affect this player at all. That is the noise
 * floor, and it swallowed most of the table.
 *
 * So: same stage, same seeds, one modifier or none. Anything that survives here
 * is real.
 */
function isolate(per: number): void {
  const STAGE = 12;
  const seeds = Array.from({ length: per }, (_, i) => (5000 + i * 7919) >>> 0);
  const deck = newRun(4242).deck;

  const run1 = (mods: ModifierId[]): number => {
    let won = 0;
    for (const seed of seeds) {
      const l = dealLevel({
        deck, charms: [], spec: { stage: STAGE, kind: 'trial', modifiers: mods, seed },
        bonusMoves: 0, bonusCells: 0, bank: 999,
      });
      if (playBot(l.sim, CAREFUL).won) won++;
    }
    return (won / seeds.length) * 100;
  };

  const base = run1([]);
  console.log(`control (no modifiers): ${base.toFixed(0)}% of ${per} at stage ${STAGE}\n`);
  console.log('modifier      won    delta');
  const rows: { id: string; p: number }[] = [];
  for (const id of Object.keys(MODIFIERS) as ModifierId[]) rows.push({ id, p: run1([id]) });
  for (const r of rows.sort((a, b) => a.p - b.p)) {
    console.log(`${r.id.padEnd(12)} ${r.p.toFixed(0).padStart(4)}%  ${(r.p - base >= 0 ? '+' : '')}${(r.p - base).toFixed(0)}pp`);
  }
}

if (process.argv[2] === 'isolate') {
  isolate(Number(process.argv[3] ?? 10));
  process.exit(0);
}

if (process.argv[2] === 'diagnose') {
  diagnose(Number(process.argv[3] ?? 12));
  process.exit(0);
}

if (process.argv[2] === 'boards') {
  boardSweep(Number(process.argv[3] ?? 10));
  process.exit(0);
}

const RUNS = Number(process.argv[2] ?? 20);
console.log(`bounded-lookahead player, depth ${CAREFUL.depth} width ${CAREFUL.width}, ${RUNS} runs per build\n`);
console.log('build          median  mean   range      peak bank   bankrupt  out of moves  stuck  capped');
for (const [label, buildEvery] of [['none', 0], ['every 4 levels', 4], ['every 2 levels', 2]] as const) {
  const outs: RunOutcome[] = [];
  for (let i = 0; i < RUNS; i++) outs.push(playRun(4242 + i * 7919, buildEvery, CAREFUL));
  const depths = outs.map((o) => o.depth).sort((a, b) => a - b);
  const median = depths[Math.floor(depths.length / 2)];
  const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
  const peak = outs.reduce((a, o) => a + o.peakBank, 0) / outs.length;
  const n = (c: RunOutcome['cause']) => outs.filter((o) => o.cause === c).length;
  console.log(
    `${label.padEnd(14)} ${String(median).padStart(6)} ${mean.toFixed(1).padStart(5)}  ` +
    `${String(depths[0]).padStart(2)}-${String(depths[depths.length - 1]).padEnd(6)} ` +
    `${peak.toFixed(0).padStart(9)}   ${String(n('bankrupt')).padStart(8)}  ${String(n('ran out of moves')).padStart(12)}  ${String(n('stuck with moves left')).padStart(5)}  ${String(n('reached the cap')).padStart(6)}`,
  );
}
