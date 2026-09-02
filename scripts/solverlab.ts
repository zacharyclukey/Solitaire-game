/** Compares solver settings on real deals: solution cost vs. nodes vs. time. */
import { buildRules, columnsFor } from '../src/game/deal.ts';
import { Rng, randomSeed } from '../src/game/rng.ts';
import { createSim, type Sim } from '../src/game/sim.ts';
import { solve } from '../src/game/solver.ts';
import { starterDeck } from '../src/game/run.ts';
import { makeCardDef } from '../src/game/types.ts';

const CELLS = Number(process.argv[2] ?? 2);

function deal(seed: number, faceUp: number): Sim {
  const rng = new Rng(seed);
  const deck = starterDeck();
  const defs = deck.map(makeCardDef);
  const cols = columnsFor(deck.length, [], []);
  const order = rng.shuffle(defs.map((_, i) => i));
  const columns: number[][] = Array.from({ length: cols }, () => []);
  order.forEach((id, i) => columns[i % cols].push(id));
  const up = new Uint8Array(defs.length);
  for (const col of columns) for (let i = Math.max(0, col.length - faceUp); i < col.length; i++) up[col[i]] = 1;
  const rules = buildRules([], [], Math.max(...defs.map((d) => d.rank)));
  return createSim(defs, columns, up, rules, Number.MAX_SAFE_INTEGER / 4, CELLS);
}

const configs = [
  { name: 'w6/6k', weight: 6, maxNodes: 6000 },
  { name: 'w3/14k', weight: 3, maxNodes: 14000 },
  { name: 'w1.6/20k', weight: 1.6, maxNodes: 20000 },
  { name: 'w1.2/40k', weight: 1.2, maxNodes: 40000 },
  { name: 'w1.0/60k', weight: 1.0, maxNodes: 60000 },
];

for (const faceUp of [3, 2, 1]) {
  console.log(`\n--- faceUp=${faceUp} (hidden ~${28 - faceUp * 7 > 0 ? 28 - faceUp * 7 : 0}) ---`);
  const rows: Record<string, { cost: number[]; ms: number[]; fail: number }> = {};
  for (const c of configs) rows[c.name] = { cost: [], ms: [], fail: 0 };
  for (let i = 0; i < 12; i++) {
    const seed = randomSeed();
    for (const c of configs) {
      const sim = deal(seed, faceUp);
      const t = Date.now();
      const r = solve(sim, { weight: c.weight, maxNodes: c.maxNodes, maxMs: 4000 });
      const ms = Date.now() - t;
      if (r) {
        rows[c.name].cost.push(r.cost);
        rows[c.name].ms.push(ms);
      } else rows[c.name].fail++;
    }
  }
  const avg = (x: number[]): string => (x.length ? (x.reduce((a, b) => a + b, 0) / x.length).toFixed(1) : '—');
  for (const c of configs) {
    const r = rows[c.name];
    console.log(`${c.name.padEnd(10)} cost ${avg(r.cost).padStart(6)}  ms ${avg(r.ms).padStart(7)}  fails ${r.fail}`);
  }
}
