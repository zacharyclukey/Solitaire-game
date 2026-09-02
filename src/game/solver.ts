/**
 * Weighted A* search over the shared rules engine.
 *
 * It has three jobs:
 *   1. Certify at deal time that a board is actually winnable (no unfair deals).
 *   2. Derive the move budget from the length of a real solution, so difficulty
 *      scales with the board rather than with a hand-tuned constant.
 *   3. Power the in-game Hint button from the live position.
 */
import { applyMove, cloneSim, isWon, legalMoves, simKey, type Sim } from './sim.ts';
import type { Move } from './types.ts';

export interface SolveOptions {
  /** Greediness. 1 = optimal-ish but slow; 4-8 = fast, longer solutions. */
  weight?: number;
  maxNodes?: number;
  maxMs?: number;
  /** Search inside the sim's remaining move budget instead of ignoring it. */
  respectBudget?: boolean;
  /** Only look for solutions strictly cheaper than this. */
  costBound?: number;
}

export interface SolveResult {
  moves: Move[];
  cost: number;
  nodes: number;
  exhausted: boolean; // search space fully explored without a win
}

interface Node {
  sim: Sim;
  g: number;
  f: number;
  parent: Node | null;
  move: Move | null;
}

class Heap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Estimated remaining work: every hidden card needs turning, and every card
 *  stacked above the shallowest hidden card needs relocating. */
export function heuristic(s: Sim): number {
  let blockers = 0;
  for (let c = 0; c < s.cellStart; c++) {
    const col = s.cols[c];
    let topmostDown = -1;
    for (let i = col.length - 1; i >= 0; i--) {
      if (!s.up[col[i]]) {
        topmostDown = i;
        break;
      }
    }
    if (topmostDown >= 0) blockers += col.length - 1 - topmostDown;
  }
  let clogged = 0;
  for (let c = s.cellStart; c < s.cols.length; c++) if (s.cols[c].length) clogged++;
  return s.hidden + 0.5 * blockers + 0.3 * clogged;
}

/** Torch and Twin can turn several cards in one move, which breaks the
 *  "one reveal per move" lower bound used for cost pruning. */
function hasCascades(s: Sim): boolean {
  for (const d of s.defs) if (d.torch || d.twin) return true;
  return false;
}

export function solve(start: Sim, opts: SolveOptions = {}): SolveResult | null {
  const weight = opts.weight ?? 3;
  const maxNodes = opts.maxNodes ?? 25000;
  const maxMs = opts.maxMs ?? 900;
  const respect = opts.respectBudget ?? false;
  const bound = opts.costBound ?? Infinity;
  const t0 = Date.now();

  const root = cloneSim(start);
  if (!respect) root.movesLeft = Number.MAX_SAFE_INTEGER / 4;

  if (isWon(root)) return { moves: [], cost: 0, nodes: 0, exhausted: false };

  const open = new Heap();
  const best = new Map<string, number>();
  const rootNode: Node = { sim: root, g: 0, f: weight * heuristic(root), parent: null, move: null };
  open.push(rootNode);
  best.set(simKey(root), 0);

  let nodes = 0;
  let exhausted = true;

  while (open.size > 0) {
    if (nodes >= maxNodes) {
      exhausted = false;
      break;
    }
    if ((nodes & 127) === 0 && Date.now() - t0 > maxMs) {
      exhausted = false;
      break;
    }
    const node = open.pop()!;
    nodes++;

    if (isWon(node.sim)) {
      const moves: Move[] = [];
      let cur: Node | null = node;
      while (cur && cur.move) {
        moves.push(cur.move);
        cur = cur.parent;
      }
      moves.reverse();
      return { moves, cost: node.g, nodes, exhausted: false };
    }

    const key = simKey(node.sim);
    const known = best.get(key);
    if (known !== undefined && known < node.g) continue;

    for (const mv of legalMoves(node.sim, respect)) {
      const next = cloneSim(node.sim);
      applyMove(next, mv, null);
      const g = node.g + mv.cost;
      if (respect && next.movesLeft < 0) continue;
      if (g >= bound) continue;
      if (g + next.hidden >= bound && !hasCascades(next)) continue;
      const k = simKey(next);
      const prev = best.get(k);
      if (prev !== undefined && prev <= g) continue;
      best.set(k, g);
      open.push({ sim: next, g, f: g + weight * heuristic(next), parent: node, move: mv });
    }
  }

  // No win found: either the space was fully explored (provably unwinnable)
  // or we ran out of budget. Callers only care that there is no solution.
  void exhausted;
  return null;
}

/**
 * Best solution we can find within a small time budget, used to size the move
 * allowance for a freshly dealt level.
 */
/**
 * Finds a solution, then spends the rest of its time shortening it.
 *
 * The first pass is deliberately greedy so that an unwinnable board is
 * rejected in a few dozen milliseconds instead of grinding through a low
 * weight search. Later passes are bounded by the best cost so far, which
 * prunes hard and converges quickly.
 */
export function findSolution(sim: Sim, budgetMs = 400): SolveResult | null {
  let best =
    solve(sim, { weight: 6, maxNodes: 9000, maxMs: budgetMs * 0.25 }) ??
    solve(sim, { weight: 2.5, maxNodes: 14000, maxMs: budgetMs * 0.35 });
  if (!best) return null;
  for (const p of [
    { weight: 2.2, maxNodes: 16000, maxMs: budgetMs * 0.36 },
    { weight: 1.2, maxNodes: 22000, maxMs: budgetMs * 0.36 },
  ]) {
    const r = solve(sim, { ...p, costBound: best.cost });
    if (r && r.cost < best.cost) best = r;
  }
  return best;
}

/** Next move to play from the current position, or null if we cannot see one. */
export function hint(sim: Sim): Move | null {
  const r =
    solve(sim, { weight: 3, maxNodes: 9000, maxMs: 260, respectBudget: true }) ??
    solve(sim, { weight: 8, maxNodes: 5000, maxMs: 160, respectBudget: false });
  return r && r.moves.length ? r.moves[0] : null;
}
