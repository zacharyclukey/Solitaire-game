/**
 * The rules engine.
 *
 * One implementation is shared by the playable game and by the solver, so a
 * deal that the solver certifies as winnable is winnable under exactly the
 * rules the player sees. State is a plain object that clones cheaply.
 */
import type { CardDef, Move, RuleSet } from './types.ts';

export interface Sim {
  defs: CardDef[];
  /**
   * Tableau columns first, then the reserve cells. Cells are modelled as
   * one-card columns so every rule, key and search step works on one shape;
   * `cellStart` is the boundary.
   */
  cols: number[][];
  cellStart: number;
  /** 1 = face up. Indexed by card index (position in `defs`). */
  up: Uint8Array;
  /** 1 = removed from the board by Ember. */
  gone: Uint8Array;
  hidden: number; // face-down cards still on the board
  movesLeft: number;
  movesUsed: number;
  revealed: number; // cards turned during play; drives Frozen thaw
  gold: number;
  rules: RuleSet;
}

export type SimEvent =
  | { t: 'move'; ids: number[]; from: number; to: number }
  | { t: 'flip'; id: number; col: number; idx: number }
  | { t: 'burn'; id: number; from: number }
  | { t: 'gold'; n: number }
  | { t: 'moves'; n: number };

export function createSim(
  defs: CardDef[],
  cols: number[][],
  faceUp: Uint8Array,
  rules: RuleSet,
  moveBudget: number,
  cells = 0,
): Sim {
  let hidden = 0;
  for (let i = 0; i < defs.length; i++) if (!faceUp[i]) hidden++;
  const all = cols.map((c) => c.slice());
  const cellStart = all.length;
  for (let i = 0; i < cells; i++) all.push([]);
  return {
    defs,
    cellStart,
    cols: all,
    up: faceUp.slice(),
    gone: new Uint8Array(defs.length),
    hidden,
    movesLeft: moveBudget,
    movesUsed: 0,
    revealed: 0,
    gold: 0,
    rules,
  };
}

export function cloneSim(s: Sim): Sim {
  return {
    defs: s.defs,
    cellStart: s.cellStart,
    cols: s.cols.map((c) => c.slice()),
    up: s.up.slice(),
    gone: s.gone.slice(),
    hidden: s.hidden,
    movesLeft: s.movesLeft,
    movesUsed: s.movesUsed,
    revealed: s.revealed,
    gold: s.gold,
    rules: s.rules,
  };
}

export function isWon(s: Sim): boolean {
  return s.hidden === 0;
}

/** Columns are interchangeable and so are cells, so the key sorts each group. */
export function simKey(s: Sim): string {
  const cols: string[] = [];
  const cells: string[] = [];
  for (let c = 0; c < s.cols.length; c++) {
    let p = '';
    for (const id of s.cols[c]) p += (s.up[id] ? 'u' : 'd') + id.toString(36) + ',';
    (c < s.cellStart ? cols : cells).push(p);
  }
  cols.sort();
  cells.sort();
  return cols.join('|') + '#' + cells.join('|');
}

/* ------------------------------------------------------------------ rules */

/** May `moving` be placed directly on top of `target`? */
export function canStack(defs: CardDef[], movingId: number, targetId: number, R: RuleSet): boolean {
  const m = defs[movingId];
  const t = defs[targetId];
  if (t.anchor) return true; // Anchor accepts anything
  let rankOk = m.rank === t.rank + R.dir;
  if (!rankOk && m.bridge) rankOk = m.rank === t.rank + 2 * R.dir;
  if (!rankOk) return false;
  if (R.match === 'any' || m.wild || t.prism) return true;
  if (R.match === 'alt') return m.color !== t.color;
  return m.suit === t.suit;
}

/** May this card be dropped into an empty column? */
export function canPlaceEmpty(d: CardDef, R: RuleSet): boolean {
  if (d.key) return true;
  if (d.stuck) return false;
  if (R.empty === 'none') return false;
  // "Royal Gates" admits the two ranks nearest the natural base of a stack.
  if (R.empty === 'top') return Math.abs(d.rank - R.baseRank) <= 1;
  return true;
}

export function isFrozen(s: Sim, id: number): boolean {
  return s.defs[id].frozen && s.revealed < s.rules.thawAt;
}

export function moveCost(s: Sim, headId: number, toCol: number): number {
  const d = s.defs[headId];
  let cost = d.free ? 0 : 1;
  if (d.heavy) cost += 1;
  if (toCol >= s.cellStart) cost += s.rules.cellCost;
  else if (toCol >= 0 && s.cols[toCol].length === 0 && !d.key) cost += s.rules.emptyCost;
  if (d.spring) cost -= 1;
  return Math.max(0, cost);
}

/**
 * Lowest index in column `c` from which the cards above form a legal,
 * face-up, movable run.
 */
export function runStart(s: Sim, c: number): number {
  const col = s.cols[c];
  let i = col.length - 1;
  if (i < 0) return 0;
  if (!s.rules.groups) return i;
  while (i > 0) {
    const below = col[i - 1];
    if (!s.up[below]) break;
    if (!canStack(s.defs, col[i], below, s.rules)) break;
    i--;
  }
  return i;
}

/**
 * All legal actions. When `affordableOnly` the list is filtered to moves the
 * player can currently pay for, which is also what the loss check uses.
 */
export function legalMoves(s: Sim, affordableOnly = true): Move[] {
  const out: Move[] = [];
  const R = s.rules;
  const nCols = s.cols.length;
  const cellStart = s.cellStart;

  // Empty columns are interchangeable, and so are empty cells: offering only
  // the first of each keeps the branching factor honest.
  let firstEmptyCol = -1;
  let firstEmptyCell = -1;
  for (let t = 0; t < nCols; t++) {
    if (s.cols[t].length !== 0) continue;
    if (t < cellStart) {
      if (firstEmptyCol < 0) firstEmptyCol = t;
    } else if (firstEmptyCell < 0) firstEmptyCell = t;
  }

  for (let c = 0; c < nCols; c++) {
    const col = s.cols[c];
    if (col.length === 0) continue;
    const topId = col[col.length - 1];

    if (!s.up[topId]) {
      // Only a Shrouded card can sit face-down on top; it costs a move to turn.
      if (s.defs[topId].dim && (!affordableOnly || s.movesLeft >= 1)) {
        out.push({ kind: 'f', from: c, fromIdx: col.length - 1, to: -1, cost: 1 });
      }
      continue;
    }

    const start = c >= cellStart ? 0 : runStart(s, c);

    // A frozen card anywhere in the suffix blocks every deeper starting point.
    let lowest = start;
    for (let i = col.length - 1; i >= start; i--) {
      if (isFrozen(s, col[i])) {
        lowest = i + 1;
        break;
      }
    }

    if (s.defs[topId].ember && !isFrozen(s, topId)) {
      const cost = s.defs[topId].free ? 0 : 1;
      if (!affordableOnly || cost <= s.movesLeft) {
        out.push({ kind: 'b', from: c, fromIdx: col.length - 1, to: -1, cost });
      }
    }

    for (let i = lowest; i < col.length; i++) {
      const id = col[i];
      const d = s.defs[id];
      const count = col.length - i;
      if (R.maxGroup > 0 && count > R.maxGroup) continue;

      // Into the reserve: single cards, and never cell-to-cell (a no-op).
      if (count === 1 && firstEmptyCell >= 0 && c < cellStart) {
        const cost = moveCost(s, id, firstEmptyCell);
        if (!affordableOnly || cost <= s.movesLeft) {
          out.push({ kind: 'm', from: c, fromIdx: i, to: firstEmptyCell, cost });
        }
      }

      for (let t = 0; t < cellStart; t++) {
        if (t === c) continue;
        const tcol = s.cols[t];
        if (tcol.length === 0) {
          if (t !== firstEmptyCol) continue;
          if (!canPlaceEmpty(d, R)) continue;
          // Sliding a whole tableau column into an empty one achieves nothing.
          if (i === 0 && c < cellStart) continue;
        } else {
          if (!canStack(s.defs, id, tcol[tcol.length - 1], R)) continue;
        }
        if (R.maxHeight > 0 && tcol.length + count > R.maxHeight) continue;
        const cost = moveCost(s, id, t);
        if (affordableOnly && cost > s.movesLeft) continue;
        out.push({ kind: 'm', from: c, fromIdx: i, to: t, cost });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- transitions */

function flipCard(s: Sim, id: number, col: number, idx: number, ev: SimEvent[] | null): void {
  if (s.up[id]) return;
  s.up[id] = 1;
  s.hidden--;
  s.revealed++;
  ev?.push({ t: 'flip', id, col, idx });
  const d = s.defs[id];
  if (d.gild) {
    s.gold += 2;
    ev?.push({ t: 'gold', n: 2 });
  }
  if (d.beacon) {
    s.movesLeft += 2;
    ev?.push({ t: 'moves', n: 2 });
  }
  if (d.torch) {
    const c = s.cols[col];
    for (let i = 0; i < c.length; i++) {
      if (!s.up[c[i]]) {
        flipCard(s, c[i], col, i, ev);
        break;
      }
    }
  }
  if (d.twin) {
    for (let ci = 0; ci < s.cellStart; ci++) {
      const c = s.cols[ci];
      for (let i = 0; i < c.length; i++) {
        if (!s.up[c[i]] && s.defs[c[i]].rank === d.rank) flipCard(s, c[i], ci, i, ev);
      }
    }
  }
}

/** Turn any newly exposed face-down cards and resolve the reveal cascade. */
export function settle(s: Sim, ev: SimEvent[] | null): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < s.cellStart; c++) {
      const col = s.cols[c];
      if (col.length === 0) continue;
      const id = col[col.length - 1];
      if (!s.up[id] && !s.defs[id].dim) {
        flipCard(s, id, c, col.length - 1, ev);
        changed = true;
      }
    }
  }
}

export function applyMove(s: Sim, mv: Move, ev: SimEvent[] | null = null): void {
  s.movesLeft -= mv.cost;
  s.movesUsed += mv.cost;

  if (mv.kind === 'f') {
    const col = s.cols[mv.from];
    flipCard(s, col[col.length - 1], mv.from, col.length - 1, ev);
  } else if (mv.kind === 'b') {
    const col = s.cols[mv.from];
    const id = col.pop()!;
    s.gone[id] = 1;
    ev?.push({ t: 'burn', id, from: mv.from });
  } else {
    const col = s.cols[mv.from];
    const moved = col.splice(mv.fromIdx);
    const tgt = s.cols[mv.to];
    for (const id of moved) tgt.push(id);
    ev?.push({ t: 'move', ids: moved, from: mv.from, to: mv.to });
  }
  settle(s, ev);
}

export type SimStatus = 'playing' | 'won' | 'lost';

export function status(s: Sim): SimStatus {
  if (isWon(s)) return 'won';
  if (s.movesLeft <= 0) return 'lost';
  if (legalMoves(s, true).length === 0) return 'lost';
  return 'playing';
}

export function sameMove(a: Move, b: Move): boolean {
  return a.kind === b.kind && a.from === b.from && a.fromIdx === b.fromIdx && a.to === b.to;
}
