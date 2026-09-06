/**
 * Do the escapes actually save a board?
 *
 * They are the last lever anything has on the per-level ceiling: rules are
 * price rather than puzzle (docs/DESIGN.md 6a), the economy stopped being the
 * limiter, and about a fifth of boards have no line at all. If a dead board
 * cannot be bought out of, the ceiling simply stands.
 *
 * Two populations, because they answer to different escapes: boards with NO
 * line at all, and boards that were winnable and lost anyway. And two moments,
 * because Pry and Dig both act on whichever column is most buried and that
 * changes as the board is played — spending one at the start is a different
 * move from spending it at a standstill, which is when a player reaches for it.
 *
 * Truth uses solve() with maxNodes. findSolution's second argument is
 * milliseconds, which has caught this project before.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, botMove, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { solve } from '../src/game/solver.ts';
import { applyMove, cloneSim, dig, isWon, pry, type Sim } from '../src/game/sim.ts';
import { DIG_MOVES, PRY_MOVES, REPRIEVE_MOVES } from '../src/game/content.ts';

const PER = Number(process.argv[2] ?? 30);
const BIG = Number.MAX_SAFE_INTEGER / 4;
const loose = (s: Sim): Sim => { const c = cloneSim(s); c.movesLeft = BIG; return c; };
const winnable = (s: Sim): boolean =>
  (solve(loose(s), { weight: 6, maxNodes: 200_000, maxMs: 8000 }) ??
   solve(loose(s), { weight: 1.5, maxNodes: 200_000, maxMs: 10000 })) !== null;

/** A deep copy that is safe to mutate through pry/dig. */
const fork = (s: Sim): Sim => {
  const c = cloneSim(s);
  c.cols = c.cols.map((col) => col.slice());
  c.up = c.up.slice();
  c.gone = c.gone.slice();
  return c;
};

const ESCAPES: [string, (s: Sim) => void][] = [
  ['Pry', (s) => { if (pry(s)) s.movesLeft += PRY_MOVES; }],
  ['Dig', (s) => { if (dig(s)) s.movesLeft += DIG_MOVES; }],
  ['Reprieve', (s) => { s.movesLeft += REPRIEVE_MOVES; }],
];

/** Play to a standstill, spend the escape there, then play on. */
function whenStuck(start: Sim, apply: (s: Sim) => void): boolean {
  const s = fork(start);
  for (let i = 0; i < 400 && !isWon(s); i++) {
    const mv = botMove(s, CAREFUL);
    if (!mv) break;
    applyMove(s, mv);
  }
  if (isWon(s)) return true;
  apply(s);
  return playBot(s, CAREFUL).won;
}

const dead: Sim[] = [];
const starved: Sim[] = [];
for (const stage of [12, 18]) {
  for (let i = 0; i < PER; i++) {
    const run = newRun((31337 + i * 104729) >>> 0);
    run.stage = stage;
    const sim = dealLevel({ deck: run.deck, charms: [], spec: stageSpec(run, stage), bonusMoves: 0, bonusCells: 0, bank: 0 }).sim;
    if (playBot(cloneSim(sim), CAREFUL).won) continue;
    (winnable(sim) ? starved : dead).push(sim);
  }
}
const all = [...dead, ...starved];
console.log(`${all.length} lost boards: ${dead.length} with no line at all, ${starved.length} winnable but lost\n`);
console.log('escape       dead: at start / stuck    winnable-but-lost: at start / stuck');
for (const [name, apply] of ESCAPES) {
  const rate = (pool: Sim[], f: (b: Sim) => boolean) =>
    pool.length === 0 ? '  n/a' : `${((pool.filter(f).length / pool.length) * 100).toFixed(0)}%`.padStart(5);
  const atStart = (b: Sim) => { const s = fork(b); apply(s); return playBot(s, CAREFUL).won; };
  const stuck = (b: Sim) => whenStuck(b, apply);
  console.log(`${name.padEnd(12)} ${rate(dead, atStart)} ${rate(dead, stuck)}            ${rate(starved, atStart)} ${rate(starved, stuck)}`);
}
