/** Diagnoses why a deal is unsolved: exhausted search space vs. node/time cap. */
import { buildRules, columnsFor } from '../src/game/deal.ts';
import { Rng, randomSeed } from '../src/game/rng.ts';
import { cloneSim, createSim, isWon, legalMoves, applyMove, simKey, type Sim } from '../src/game/sim.ts';
import { heuristic } from '../src/game/solver.ts';
import { starterDeck } from '../src/game/run.ts';
import { makeCardDef, RANK_LABEL, SUIT_GLYPH } from '../src/game/types.ts';

const CELLS = Number(process.argv[2] ?? 2);

function deal(seed: number, faceUp: number): Sim {
  const rng = new Rng(seed);
  const defs = starterDeck().map(makeCardDef);
  const cols = columnsFor(28, [], []);
  const order = rng.shuffle(defs.map((_, i) => i));
  const columns: number[][] = Array.from({ length: cols }, () => []);
  order.forEach((id, i) => columns[i % cols].push(id));
  const up = new Uint8Array(defs.length);
  for (const col of columns) for (let i = Math.max(0, col.length - faceUp); i < col.length; i++) up[col[i]] = 1;
  return createSim(defs, columns, up, buildRules([], [], 7), Number.MAX_SAFE_INTEGER / 4, CELLS);
}

/** Exhaustive BFS over reachable states, ignoring cost. Tells us definitively
 *  whether a board is winnable at all. */
function reachable(start: Sim, cap = 400000): { won: boolean; states: number; capped: boolean } {
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

function render(s: Sim): string {
  return s.cols
    .map((c) => c.map((id) => (s.up[id] ? `${RANK_LABEL[s.defs[id].rank]}${SUIT_GLYPH[s.defs[id].suit]}` : '##')).join(' '))
    .join('\n');
}

let unsolvable = 0;
for (let i = 0; i < 10; i++) {
  const seed = randomSeed();
  const s = deal(seed, Number(process.argv[3] ?? 3));
  const r = reachable(cloneSim(s), 250000);
  console.log(`seed ${seed}: won=${r.won} states=${r.states} capped=${r.capped} h0=${heuristic(s).toFixed(1)} moves0=${legalMoves(s, false).length}`);
  if (!r.won && !r.capped) {
    unsolvable++;
    if (unsolvable === 1) console.log(render(s));
  }
}
console.log('provably unsolvable:', unsolvable, '/10');
