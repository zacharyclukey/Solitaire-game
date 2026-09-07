/**
 * The difficulty curve, by the owner's own definition of it.
 *
 * "The game should be loseable by default and the player's skill and choices
 * make it winnable. The ratio of winnable to loseable is the difficulty curve."
 *
 * Nothing else moves the per-level ceiling — not the allowance, not the rules
 * (§6a), not skill (#27), not escapes (§6b) — so this ratio IS the curve, and
 * it had never been measured as one. Two numbers a stage, because they are
 * different curves:
 *
 *   WINNABLE  a line exists at all, at any allowance. What the shuffle hands
 *             out, measured with solve() and a large node cap.
 *   CLEARED   what the fallible player actually takes, at the allowance the
 *             level really grants.
 *
 * The GAP between them is the room skill has to work in. A game where deep
 * boards are lost to the shuffle rather than to play is not getting harder, it
 * is getting more arbitrary — so the gap closing at depth would be the bad
 * result, and worth knowing before shipping.
 *
 * Scope: the run's STARTING deck at every stage, with no enchantments and no
 * charms. That is the no-build lower bound — a real player at stage 18 has a
 * grown deck and a build — so read these as "what a bare deck faces", not as
 * what a run looks like.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { solve } from '../src/game/solver.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';

const PER = Number(process.argv[2] ?? 24);
const STAGES = (process.argv[3] ?? '1,3,5,7,9,11,13,15,17,19').split(',').map(Number);
const BIG = Number.MAX_SAFE_INTEGER / 4;

const winnable = (s: Sim): boolean => {
  const probe = cloneSim(s);
  probe.movesLeft = BIG;
  return (solve(probe, { weight: 6, maxNodes: 200_000, maxMs: 8000 }) ??
          solve(probe, { weight: 1.5, maxNodes: 200_000, maxMs: 10000 })) !== null;
};

console.log(`${PER} boards a stage, bare starting deck, no build\n`);
console.log('stage   winnable   cleared   gap (room for skill)');
for (const stage of STAGES) {
  let alive = 0, won = 0;
  for (let i = 0; i < PER; i++) {
    const run = newRun((31337 + i * 104729) >>> 0);
    run.stage = stage;
    const sim = dealLevel({
      deck: run.deck, charms: [], spec: stageSpec(run, stage),
      bonusMoves: 0, bonusCells: 0, bank: 0,
    }).sim;
    if (winnable(sim)) alive++;
    if (playBot(cloneSim(sim), CAREFUL).won) won++;
  }
  const pct = (n: number) => `${((n / PER) * 100).toFixed(0)}%`;
  console.log(`${String(stage).padStart(5)}   ${pct(alive).padStart(8)}   ${pct(won).padStart(7)}   ${pct(alive - won).padStart(8)}`);
}
