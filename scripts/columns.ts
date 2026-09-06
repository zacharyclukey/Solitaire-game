/**
 * Does column count actually change how hard a board is?
 *
 * DESIGN.md once claimed six-column boards were the sharpest edge in the game
 * (76% against 91% for seven) and, two sentences later, that column count
 * barely mattered (75% against 76%). Both were withdrawn, because neither was
 * controlled: column count is normally set by the Narrow and Wide modifiers,
 * which carry threat that the stipend then compensates, so those arms differ in
 * allowance and modifier mix as well as in width.
 *
 * The clean lever is the Wide Stance charm. It runs through `columnsFor` and
 * touches nothing else in the game — no threat, no modifier, no rule change —
 * so holding the stage, the deck, the seed and the (empty) modifier list fixed
 * and toggling it varies column count and nothing besides.
 *
 * SCOPE, which matters when reading the unlimited column: these are
 * modifier-free boards dealt from the run's STARTING deck, so they are far
 * easier than a real stage-16 board and clear 100% of the time given enough
 * moves. That is not in tension with "a fifth of boards have no line at all",
 * which was measured on real specs with grown decks — it is a different and
 * deliberately plainer population, chosen so that column count is the only
 * thing moving.
 *
 * Reported at two budgets, because they answer different questions. Unlimited
 * asks whether a wider board is an easier PUZZLE; the level's own allowance
 * asks what a player actually experiences, since more columns also cost moves
 * to use. plainPar per card is printed as a check on the board selector: if it
 * differs between arms, the selector compensated and the comparison is not as
 * clean as it looks.
 */
import { dealLevel, type LevelSpec } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun } from '../src/game/run.ts';
import { cloneSim } from '../src/game/sim.ts';
import type { CharmId } from '../src/game/content.ts';

const N = Number(process.argv[2] ?? 30);
const ARMS: [string, CharmId[]][] = [['base', []], ['base +1 col', ['stance']]];

console.log(`${N} boards a cell, no modifiers, Wide Stance as the only difference\n`);
console.log('stage  arm            cols   unlimited   at budget   plainPar/card');
for (const stage of (process.argv[3] ?? "8,12,16").split(",").map(Number)) {
  for (const [name, charms] of ARMS) {
    let cols = 0, freeWon = 0, paidWon = 0, parPerCard = 0;
    for (let i = 0; i < N; i++) {
      const run = newRun((606 + i * 48611) >>> 0);
      run.stage = stage;
      const spec: LevelSpec = { stage, kind: 'trial', modifiers: [], seed: (8000 + i * 7919) >>> 0 };
      const base = { deck: run.deck, charms, spec, bonusMoves: 0, bonusCells: 0 };
      const free = dealLevel({ ...base, bank: 9999 });
      const paid = dealLevel({ ...base, bank: 0 });
      cols = free.columns;
      parPerCard += free.plainPar / free.sim.defs.length;
      if (playBot(cloneSim(free.sim), CAREFUL).won) freeWon++;
      if (playBot(cloneSim(paid.sim), CAREFUL).won) paidWon++;
    }
    const pct = (n: number) => `${((n / N) * 100).toFixed(0)}%`.padStart(6);
    console.log(`${String(stage).padStart(5)}  ${name.padEnd(13)} ${String(cols).padStart(4)}  ${pct(freeWon)}      ${pct(paidWon)}       ${(parPerCard / N).toFixed(2)}`);
  }
}
