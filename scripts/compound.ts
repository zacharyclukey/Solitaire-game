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
import type { DeckCard, EnchantId } from '../src/game/types.ts';

const ADDING: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism'];
const COMPOUNDING: EnchantId[] = ['conduit', 'resonance', 'torch', 'twin', 'beacon', 'conduit', 'resonance', 'torch'];

const PER = Number(process.argv[2] ?? 14);
const STAGE = 8;
const BANK = 999;

function deckWith(base: DeckCard[], kit: EnchantId[], n: number): DeckCard[] {
  const d = base.map((c) => ({ ...c }));
  for (let i = 0; i < n; i++) d[(i * 3) % d.length].ench = kit[i % kit.length];
  return d;
}

console.log(`stage ${STAGE}, ${PER} boards, bounded-lookahead player\n`);
console.log('kit           ench   median par   median kept (stipend - spent + granted)');
for (const [label, kit] of [['bare', ADDING], ['adding', ADDING], ['compounding', COMPOUNDING]] as const) {
  // The bare deck is the same deck whichever kit is named, so it is measured once.
  for (const n of label === 'bare' ? [0] : [4, 8, 12]) {
    const pars: number[] = [];
    const carried: number[] = [];
    for (let i = 0; i < PER; i++) {
      const run = newRun((31337 + i * 104729) >>> 0);
      run.stage = STAGE;
      const l = dealLevel({
        deck: deckWith(run.deck, kit, n), charms: [],
        spec: stageSpec(run, STAGE), bonusMoves: 0, bonusCells: 0, bank: BANK,
      });
      const r = playBot(l.sim, CAREFUL);
      pars.push(l.par);
      // What the level leaves behind once the carried bank is subtracted back
      // out: stipend minus what was spent, plus anything the build handed back.
      if (r.won) carried.push(r.movesLeft - BANK);
    }
    const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
    console.log(
      `${label.padEnd(12)} ${String(n).padStart(4)}   ${med(pars).toFixed(0).padStart(10)}   ${med(carried).toFixed(0).padStart(18)}`,
    );
  }
}
