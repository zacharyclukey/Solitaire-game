/**
 * Difficulty telemetry. Plays through simulated runs, dealing every level the
 * way the game does, and reports how the budget sits against solutions found by
 * a strong searcher and by a deliberately weak, greedy one (our stand-in for a
 * hurried human).
 *
 * Run: node --experimental-strip-types scripts/balance.ts [runs] [maxDepth]
 */
import { dealLevel } from '../src/game/deal.ts';
import { Rng, randomSeed } from '../src/game/rng.ts';
import { cloneSim } from '../src/game/sim.ts';
import { solve } from '../src/game/solver.ts';
import {
  addCard,
  addCharm,
  enchantCard,
  makeFork,
  makeRewards,
  newRun,
  removeCard,
  rewardCount,
  type RunState,
} from '../src/game/run.ts';

const RUNS = Number(process.argv[2] ?? 6);
const MAX_DEPTH = Number(process.argv[3] ?? 14);

interface Row {
  depth: number;
  cards: number;
  cols: number;
  cells: number;
  hidden: number;
  par: number;
  budget: number;
  weak: number | null;
  dealMs: number;
  unsolved: boolean;
  relaxed: number;
  mods: string;
}

const rows: Row[] = [];

function autoReward(run: RunState, kind: 'trial' | 'gauntlet' | 'boss' | 'cache', rng: Rng): void {
  const rewards = makeRewards(run, kind, rewardCount(run, kind));
  if (!rewards.length) return;
  const r = rng.pick(rewards);
  switch (r.t) {
    case 'gold':
      run.gold += r.n;
      break;
    case 'moves':
      run.bonusMoves += r.n;
      break;
    case 'cell':
      run.bonusCells += 1;
      break;
    case 'charm':
      addCharm(run, r.id);
      break;
    case 'add':
      addCard(run, r.card);
      break;
    case 'remove': {
      const plain = run.deck.filter((c) => !c.ench);
      if (plain.length) removeCard(run, rng.pick(plain).uid);
      break;
    }
    case 'ench': {
      const plain = run.deck.filter((c) => !c.ench);
      if (plain.length) enchantCard(run, rng.pick(plain).uid, r.ench);
      break;
    }
    default:
      break;
  }
}

for (let i = 0; i < RUNS; i++) {
  const seed = randomSeed();
  const run = newRun(seed);
  const rng = new Rng(seed ^ 0xabcdef);

  for (let d = 1; d <= MAX_DEPTH; d++) {
    run.fork = makeFork(run);
    const spec = run.fork.length === 1 ? run.fork[0] : run.fork[Math.min(1, run.fork.length - 1)];
    const t0 = Date.now();
    const level = dealLevel({ deck: run.deck, charms: run.charms, spec, bonusMoves: run.bonusMoves, bonusCells: run.bonusCells });
    const dealMs = Date.now() - t0;

    const weakSim = cloneSim(level.sim);
    weakSim.movesLeft = Number.MAX_SAFE_INTEGER / 4;
    const weak = solve(weakSim, { weight: 9, maxNodes: 2500, maxMs: 200 });

    rows.push({
      depth: d,
      cards: level.sim.defs.length,
      cols: level.columns,
      cells: level.cells,
      hidden: level.sim.hidden,
      par: level.par,
      budget: level.budget,
      weak: weak ? weak.cost : null,
      dealMs,
      unsolved: level.solution === null,
      relaxed: level.relaxed,
      mods: level.modifiers.join(',') || '—',
    });

    run.depth = d;
    autoReward(run, spec.kind === 'shop' || spec.kind === 'respite' ? 'trial' : spec.kind, rng);
  }
}

const byDepth = new Map<number, Row[]>();
for (const r of rows) {
  if (!byDepth.has(r.depth)) byDepth.set(r.depth, []);
  byDepth.get(r.depth)!.push(r);
}

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pad = (s: string | number, n: number): string => String(s).padStart(n);

console.log('depth  cards cols cell hidden   par budget slack  weakFail  dealMs   relaxed');
for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
  const rs = byDepth.get(d)!;
  const weakFail = rs.filter((r) => r.weak === null || r.weak > r.budget).length / rs.length;
  console.log(
    [
      pad(d, 5),
      pad(avg(rs.map((r) => r.cards)).toFixed(0), 7),
      pad(avg(rs.map((r) => r.cols)).toFixed(1), 5),
      pad(avg(rs.map((r) => r.cells)).toFixed(1), 5),
      pad(avg(rs.map((r) => r.hidden)).toFixed(1), 7),
      pad(avg(rs.map((r) => r.par)).toFixed(1), 6),
      pad(avg(rs.map((r) => r.budget)).toFixed(1), 7),
      pad((avg(rs.map((r) => r.budget)) / avg(rs.map((r) => r.par))).toFixed(2), 6),
      pad((weakFail * 100).toFixed(0) + '%', 10),
      pad(avg(rs.map((r) => r.dealMs)).toFixed(0), 8),
      pad(rs.filter((r) => r.relaxed > 0).length + '/' + rs.length, 10),
    ].join(''),
  );
}

const trouble = new Map<string, { n: number; bad: number }>();
for (const r of rows) {
  for (const m of r.mods.split(',')) {
    if (!m || m === '—') continue;
    const e = trouble.get(m) ?? { n: 0, bad: 0 };
    e.n++;
    if (r.relaxed > 0) e.bad++;
    trouble.set(m, e);
  }
}
console.log('\nmodifier   seen  needed-relaxation');
for (const [m, e] of [...trouble].sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n)) {
  console.log(`${m.padEnd(10)} ${String(e.n).padStart(4)}  ${((e.bad / e.n) * 100).toFixed(0)}%`);
}

const worst = [...rows].sort((a, b) => b.dealMs - a.dealMs).slice(0, 5);
console.log('\nslowest deals:', worst.map((r) => `d${r.depth}:${r.dealMs}ms`).join(' '));
console.log('unsolved deals:', rows.filter((r) => r.unsolved).length, '/', rows.length);
