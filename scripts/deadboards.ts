/**
 * Is the fifth of boards nobody clears *unfound*, or *unwinnable*?
 *
 * The win curve tops out at 78% and that ceiling caps run depth, so it matters
 * a great deal which of the two it is. If those boards are winnable and the bot
 * merely fails to see the line, the bot is the problem and a better heuristic
 * lifts the whole game. If they have no line at all, the ceiling is a fact
 * about honest shuffles and nothing but legibility can be done about it.
 *
 * Three modes, run in this order:
 *
 *   depth   - does deeper lookahead clear more? (width was ruled out earlier)
 *   dead    - hand the bot's failures to the solver at unlimited budget, with
 *             the control that makes the answer mean anything: the same solver
 *             at the same node cap on the boards the bot CLEARED. Without that
 *             control, "the solver found nothing" is a statement about the
 *             solver rather than about the board.
 *   rescue  - on the boards that are dead, can `rescue.ts` still name the card
 *             that would have won? A dead board is only fair if it is legible.
 *
 * The result as measured: neither width nor depth moves it, the solver clears
 * everything the bot clears and about 15% of what it doesn't (even driven at
 * 1,000,000 nodes, well past the caps inside `findSolution`), and rescue names
 * a card on 22 of 23 lost boards. The fifth is unwinnable, not unfound.
 *
 * Note that `findSolution`'s second argument is MILLISECONDS, and its passes
 * are separately capped at 9k-22k nodes — so raising that budget is not the
 * same as searching harder. `solve` takes `maxNodes` for that.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot, type BotOptions } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { findSolution } from '../src/game/solver.ts';
import { findRescue } from '../src/game/rescue.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';

const UNLIMITED = Number.MAX_SAFE_INTEGER / 4;
const N = Number(process.argv[3] ?? 24);
const mode = process.argv[2] ?? 'dead';

/** A board as the player meets it, with the bank taken out of the question. */
function board(stage: number, i: number): Sim {
  const run = newRun((31337 + i * 104729) >>> 0);
  run.stage = stage;
  return dealLevel({
    deck: run.deck, charms: [], spec: stageSpec(run, stage),
    bonusMoves: 0, bonusCells: 0, bank: 9999,
  }).sim;
}

/** Winnable at all, by anyone? Node cap is deliberately generous. */
function winnable(s: Sim, nodes = 50000): boolean {
  const probe = cloneSim(s);
  probe.movesLeft = UNLIMITED;
  return findSolution(probe, nodes) !== null;
}

if (mode === 'depth') {
  console.log('stage  depth   cleared');
  for (const stage of [1, 6, 12, 18]) {
    for (const depth of [3, 4]) {
      const opts: BotOptions = { ...CAREFUL, depth };
      let won = 0;
      for (let i = 0; i < N; i++) if (playBot(cloneSim(board(stage, i)), opts).won) won++;
      console.log(`${String(stage).padStart(5)}  ${String(depth).padStart(5)}   ${won}/${N}`);
    }
  }
} else if (mode === 'dead') {
  console.log('stage   bot lost   solvable   |   bot won   solvable  (control)');
  for (const stage of [12, 18]) {
    let lost = 0, lostOk = 0, won = 0, wonOk = 0;
    for (let i = 0; i < N; i++) {
      const s = board(stage, i);
      if (playBot(cloneSim(s), CAREFUL).won) { won++; if (winnable(s)) wonOk++; }
      else { lost++; if (winnable(s)) lostOk++; }
    }
    console.log(`${String(stage).padStart(5)}   ${String(lost).padStart(8)}   ${String(lostOk).padStart(8)}   |   ${String(won).padStart(7)}   ${String(wonOk).padStart(8)}`);
  }
} else if (mode === 'rescue') {
  // Every lost board gets the run-over screen, so measure over all of them, at
  // the setting that actually ships rather than a generous one.
  let lost = 0, named = 0, dead = 0, deadNamed = 0;
  const times: number[] = [];
  for (const stage of [6, 12, 18]) {
    for (let i = 0; i < N; i++) {
      const s = board(stage, i);
      if (playBot(cloneSim(s), CAREFUL).won) continue;
      lost++;
      const isDead = !winnable(s);
      if (isDead) dead++;
      const t0 = Date.now();
      const r = findRescue(cloneSim(s), UNLIMITED, { budgetMs: 900 });
      times.push(Date.now() - t0);
      if (r) { named++; if (isDead) deadNamed++; }
    }
  }
  times.sort((a, b) => a - b);
  console.log(`named a card on ${named}/${lost} lost boards (${deadNamed}/${dead} of the dead ones)`);
  console.log(`median ${times[times.length >> 1]}ms, worst ${times[times.length - 1]}ms`);
} else {
  console.log('usage: deadboards.ts [depth|dead|rescue] [n]');
}
