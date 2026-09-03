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
import { newRun, stageSpec } from '../src/game/run.ts';
import { Rng } from '../src/game/rng.ts';
import type { DeckCard, EnchantId, Suit } from '../src/game/types.ts';

const KIT: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism'];
const MAX_STAGE = 40;

interface RunOutcome {
  depth: number;
  cause: 'bankrupt' | 'lost the board' | 'reached the cap';
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
    if (!r.won) return { depth: stage - 1, cause: 'lost the board', peakBank };

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
  console.log('\nstage  won   median over-par   worst   (bank 999, so only skill is being measured)');
  for (const stage of [1, 3, 6, 10, 14]) {
    const run = newRun(31337);
    const ratios: number[] = [];
    let won = 0;
    for (let i = 0; i < perStage; i++) {
      run.stage = stage;
      const spec = { ...stageSpec(run, stage), seed: (1000 + i * 7919) >>> 0 };
      const l = dealLevel({ deck: newRun(4242).deck, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank: 999 });
      const r = playBot(l.sim, CAREFUL);
      if (r.won) {
        won++;
        ratios.push(r.movesUsed / l.par);
      }
    }
    ratios.sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : NaN;
    const worst = ratios.length ? ratios[ratios.length - 1] : NaN;
    console.log(
      `${String(stage).padStart(5)}  ${String(won).padStart(2)}/${perStage}  ` +
      `${(med * 100).toFixed(0).padStart(11)}%   ${(worst * 100).toFixed(0).padStart(5)}%`,
    );
  }
}

if (process.argv[2] === 'boards') {
  boardSweep(Number(process.argv[3] ?? 10));
  process.exit(0);
}

const RUNS = Number(process.argv[2] ?? 20);
console.log(`bounded-lookahead player, depth ${CAREFUL.depth} width ${CAREFUL.width}, ${RUNS} runs per build\n`);
console.log('build          median  mean   range      peak bank   bankrupt  lost board  capped');
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
    `${peak.toFixed(0).padStart(9)}   ${String(n('bankrupt')).padStart(8)}  ${String(n('lost the board')).padStart(10)}  ${String(n('reached the cap')).padStart(6)}`,
  );
}
