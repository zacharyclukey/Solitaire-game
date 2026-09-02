/**
 * Solvability probe.
 *
 * Builds raw boards — no relaxation, no retries — and asks whether they can be
 * won at all, by exhaustive breadth-first search over the reachable state
 * space. This is the measurement that decided the reserve, and now the draw
 * pile: a rules change that quietly makes boards unwinnable is the one failure
 * this game cannot ship.
 *
 *   node --experimental-strip-types scripts/probe.ts [stockSize] [faceUp] [columns]
 */
import { buildRules, staircase } from '../src/game/deal.ts';
import { Rng, randomSeed } from '../src/game/rng.ts';
import { applyMove, cloneSim, createSim, isWon, legalMoves, simKey, type Sim } from '../src/game/sim.ts';
import { findSolution } from '../src/game/solver.ts';
import { starterDeck } from '../src/game/run.ts';
import { makeCardDef } from '../src/game/types.ts';

const STOCK = Number(process.argv[2] ?? 11);
const FACE_UP = Number(process.argv[3] ?? 1);
const COLUMNS = Number(process.argv[4] ?? 6);
const TRIALS = Number(process.argv[5] ?? 12);

function deal(seed: number): Sim {
  const rng = new Rng(seed);
  const defs = starterDeck().map(makeCardDef);
  const order = rng.shuffle(defs.map((_, i) => i));
  const stock = order.slice(0, STOCK);
  const rest = order.slice(STOCK);
  const cols: number[][] = [];
  let at = 0;
  for (const h of staircase(rest.length, COLUMNS)) {
    cols.push(rest.slice(at, at + h));
    at += h;
  }
  const up = new Uint8Array(defs.length);
  for (const col of cols) for (let i = Math.max(0, col.length - FACE_UP); i < col.length; i++) up[col[i]] = 1;
  const rules = buildRules([], [], defs.map((d) => d.rank));
  return createSim(defs, cols, stock, up, rules, Number.MAX_SAFE_INTEGER / 4);
}

/** Definitive answer, ignoring cost: is a win reachable at all? */
function reachable(start: Sim, cap = 200000): { won: boolean; states: number; capped: boolean } {
  const seen = new Set<string>([simKey(start)]);
  let frontier = [start];
  let states = 1;
  while (frontier.length) {
    const next: Sim[] = [];
    for (const s of frontier) {
      if (isWon(s)) return { won: true, states, capped: false };
      for (const mv of legalMoves(s, false)) {
        const n = cloneSim(s);
        applyMove(n, mv, null);
        const k = simKey(n);
        if (seen.has(k)) continue;
        seen.add(k);
        states++;
        if (states > cap) return { won: false, states, capped: true };
        next.push(n);
      }
    }
    frontier = next;
  }
  return { won: false, states, capped: false };
}

let unwinnable = 0;
let capped = 0;
let solverFound = 0;
const costs: number[] = [];
const solverMs: number[] = [];

for (let i = 0; i < TRIALS; i++) {
  const seed = randomSeed();
  const s = deal(seed);
  const t0 = Date.now();
  const sol = findSolution(cloneSim(s), 400);
  solverMs.push(Date.now() - t0);
  if (sol) {
    solverFound++;
    costs.push(sol.cost);
  }
  const r = sol ? { won: true, states: 0, capped: false } : reachable(cloneSim(s));
  if (!r.won && !r.capped) unwinnable++;
  if (r.capped) capped++;
}

const avg = (x: number[]): string => (x.length ? (x.reduce((a, b) => a + b, 0) / x.length).toFixed(1) : '—');
console.log(
  `stock ${STOCK}  faceUp ${FACE_UP}  cols ${COLUMNS}  |  ` +
    `solver found ${solverFound}/${TRIALS}  provably unwinnable ${unwinnable}  search-capped ${capped}  ` +
    `| par ${avg(costs)}  solveMs ${avg(solverMs)}`,
);
