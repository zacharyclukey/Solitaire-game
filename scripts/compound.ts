/**
 * Does the build compound, or only add?
 *
 * Two traps this avoids. Par is the length of the solver's line, so it only
 * sees enchantments that shorten the line — Resonance grants moves during play
 * and is invisible to it. And a kit indexed by `i % kit.length` silently drops
 * whatever sits past the enchantment count, which is how the first attempt at
 * this measured the new cards by not including them at all.
 *
 * So: play each board with the fallible player and measure what it carries out.
 * That is what the build is actually worth to the bank, which is the thing the
 * design cares about.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';
import { makeCardDef, type EnchantId } from '../src/game/types.ts';

const ADDING: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism'];
const COMPOUNDING: EnchantId[] = ['conduit', 'resonance', 'torch', 'twin', 'beacon', 'conduit', 'resonance', 'torch'];

const PER = Number(process.argv[2] ?? 14);
const STAGE = 8;
/**
 * A realistic purse, not an unlimited one. With a huge bank the player never
 * has to economise, wanders, and hits the bot's iteration cap with hundreds of
 * moves still in hand — which then reads as the build LOSING boards a bare deck
 * wins. Every such loss was the cap, never the budget. The build has to be
 * measured under the pressure it exists to relieve.
 */
const BANK = 0;

console.log(`stage ${STAGE}, ${PER} boards, bounded-lookahead player, paired on the same deal\n`);
console.log('kit           ench   median kept (stipend - spent + granted)');

/** The same board with `n` cards enchanted from `kit`. */
function enchanted(base: Sim, kit: EnchantId[], n: number): Sim {
  const s = cloneSim(base);
  s.defs = s.defs.slice();
  for (let i = 0; i < n; i++) {
    const idx = (i * 3) % s.defs.length;
    const d = s.defs[idx];
    s.defs[idx] = makeCardDef({ uid: d.uid, rank: d.rank, suit: d.suit, ench: kit[i % kit.length], curse: d.curse });
  }
  return s;
}

// Deal each board ONCE from a bare deck and vary only the enchantments on it.
// Dealing per kit looked reasonable and is not: honest shuffles put plainPar
// anywhere from 33 to 61, so a build worth a few moves disappears under thirty
// moves of deal variance and the results come out non-monotonic — the earlier
// version had the adding kit at -9, 0 and -12 for 4, 8 and 12 cards, which is
// noise wearing the shape of a finding.
const boards: { sim: Sim; stipend: number }[] = [];
for (let i = 0; i < PER; i++) {
  const run = newRun((31337 + i * 104729) >>> 0);
  run.stage = STAGE;
  const l = dealLevel({
    deck: run.deck, charms: [], spec: stageSpec(run, STAGE),
    bonusMoves: 0, bonusCells: 0, bank: BANK,
  });
  boards.push({ sim: l.sim, stipend: l.stipend });
}

for (const [label, kit] of [['bare', ADDING], ['adding', ADDING], ['compounding', COMPOUNDING]] as const) {
  for (const n of label === 'bare' ? [0] : [4, 8, 12]) {
    const kept: number[] = [];
    for (const b of boards) {
      const r = playBot(enchanted(b.sim, kit, n), CAREFUL);
      if (r.won) kept.push(r.movesLeft - BANK);
    }
    kept.sort((x, y) => x - y);
    const med = kept.length ? kept[Math.floor(kept.length / 2)] : NaN;
    console.log(`${label.padEnd(12)} ${String(n).padStart(4)}   ${med.toFixed(0).padStart(12)}   (${kept.length}/${PER} cleared)`);
  }
}
