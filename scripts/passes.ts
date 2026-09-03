/**
 * Is two passes over the draw pile the right number?
 *
 * A card drawn with nowhere to go sits on the waste, and when the passes run
 * out it can never come round again. Losses observed in play end with several
 * cards stranded there, so the question is whether the limit is doing useful
 * work or just quietly removing winnable lines.
 *
 * Passes are only ever raised here, never lowered: the board was certified
 * clearable with the passes it was dealt, and more can only help, so every
 * variant stays honest. The bot is the fallible player rather than the solver,
 * because a searcher plans its passes perfectly and a person does not.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { cloneSim, remaining, waste, type Sim } from '../src/game/sim.ts';

const PER = Number(process.argv[2] ?? 16);

function withPasses(s: Sim, passes: number): Sim {
  const c = cloneSim(s);
  c.rules = { ...c.rules, passes };
  c.passesLeft = passes;
  return c;
}

console.log('stage passes  cleared  median spend  avg stranded on waste when lost');
for (const stage of [1, 8, 14]) {
  const boards: Sim[] = [];
  for (let i = 0; i < PER; i++) {
    const run = newRun((31337 + i * 104729) >>> 0);
    run.stage = stage;
    const l = dealLevel({
      deck: run.deck, charms: [], spec: stageSpec(run, stage),
      bonusMoves: 0, bonusCells: 0, bank: 999,
    });
    boards.push(l.sim);
  }
  for (const passes of [2, 3, 5]) {
    let won = 0;
    let stranded = 0;
    let lost = 0;
    const spends: number[] = [];
    for (const base of boards) {
      const s = withPasses(base, passes);
      const r = playBot(s, CAREFUL);
      if (r.won) {
        won++;
        spends.push(r.movesUsed);
      } else {
        lost++;
        stranded += waste(s).length;
      }
    }
    spends.sort((a, b) => a - b);
    const med = spends.length ? spends[Math.floor(spends.length / 2)] : NaN;
    console.log(
      `${String(stage).padStart(5)} ${String(passes).padStart(6)}  ${String(won).padStart(4)}/${PER}  ` +
      `${med.toFixed(0).padStart(12)}  ${(lost ? stranded / lost : 0).toFixed(1).padStart(31)}`,
    );
  }
}
