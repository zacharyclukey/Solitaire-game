/**
 * The rules engine.
 *
 * One implementation is shared by the playable game and by the solver, so a
 * deal that the solver certifies as winnable is winnable under exactly the
 * rules the player sees. State is a plain object that clones cheaply.
 *
 * Layout of `cols`: the tableau occupies `[0, tableau)`, then the draw pile at
 * `stockIdx` and the waste at `wasteIdx`. Modelling all three as columns keeps
 * every index, key and search step working on one shape.
 */
import type { CardDef, EnchantId, Move, RuleSet } from './types.ts';

export interface Sim {
  defs: CardDef[];
  cols: number[][];
  /** Number of tableau columns; also the index of the draw pile. */
  tableau: number;
  /** 1 = face up. Indexed by card index (position in `defs`). */
  up: Uint8Array;
  /** 1 = removed from the board by Ember. */
  gone: Uint8Array;
  hidden: number; // face-down cards anywhere, the draw pile included
  movesLeft: number;
  movesUsed: number;
  revealed: number; // cards turned during play; drives Frozen thaw
  gold: number;
  /** Times the waste may still be turned back into the draw pile. */
  passesLeft: number;
  rules: RuleSet;
}

export type SimEvent =
  | { t: 'move'; ids: number[]; from: number; to: number }
  | { t: 'draw'; ids: number[] }
  | { t: 'recycle'; n: number }
  | { t: 'flip'; id: number; col: number; idx: number }
  | { t: 'burn'; id: number; from: number }
  | { t: 'gold'; n: number; src?: EnchantId }
  | { t: 'moves'; n: number; src?: EnchantId }
  /** An enchantment turned cards the move itself would not have. */
  | { t: 'cascade'; src: EnchantId; n: number }
  /** An enchantment made this move cost less than it should have. */
  | { t: 'discount'; src: EnchantId; saved: number };

export const stockIdx = (s: Sim): number => s.tableau;
export const wasteIdx = (s: Sim): number => s.tableau + 1;
export const stock = (s: Sim): number[] => s.cols[s.tableau];
export const waste = (s: Sim): number[] => s.cols[s.tableau + 1];

export function createSim(
  defs: CardDef[],
  tableauCols: number[][],
  stockCards: number[],
  faceUp: Uint8Array,
  rules: RuleSet,
  moveBudget: number,
): Sim {
  let hidden = 0;
  for (let i = 0; i < defs.length; i++) if (!faceUp[i]) hidden++;
  const cols = tableauCols.map((c) => c.slice());
  const tableau = cols.length;
  cols.push(stockCards.slice()); // draw pile
  cols.push([]); // waste
  return {
    defs,
    cols,
    tableau,
    up: faceUp.slice(),
    gone: new Uint8Array(defs.length),
    hidden,
    movesLeft: moveBudget,
    movesUsed: 0,
    revealed: 0,
    gold: 0,
    passesLeft: rules.passes,
    rules,
  };
}

export function cloneSim(s: Sim): Sim {
  return {
    defs: s.defs,
    tableau: s.tableau,
    cols: s.cols.map((c) => c.slice()),
    up: s.up.slice(),
    gone: s.gone.slice(),
    hidden: s.hidden,
    movesLeft: s.movesLeft,
    movesUsed: s.movesUsed,
    revealed: s.revealed,
    gold: s.gold,
    passesLeft: s.passesLeft,
    rules: s.rules,
  };
}

/**
 * Cards not yet face-up in a tableau column — the real measure of what is left
 * to do. A card sitting on the waste has been seen but not sorted, and turning
 * the whole draw pile over is not progress.
 *
 * The draw pile has to be checked card by card rather than trusted to `hidden`.
 * A card that has never been drawn is face-down and `hidden` counts it, but one
 * turned over on an earlier pass and then sent back round is face-up while
 * sitting in the pile, and `hidden` does not. Without this loop, recycling a
 * waste into the pile with a fully face-up tableau emptied both terms at once
 * and won the level outright with every one of those cards still unplaced.
 *
 * Turning them face-down again would be the tidier model and is not available:
 * re-drawing them would re-fire Gilded, Beacon and Torch, so a player could
 * farm gold and moves by cycling the pile.
 */
export function remaining(s: Sim): number {
  let out = s.hidden + waste(s).length;
  for (const id of stock(s)) if (s.up[id]) out++;
  return out;
}

export function isWon(s: Sim): boolean {
  return remaining(s) === 0;
}

/**
 * Tableau columns are interchangeable so they sort; the draw pile and the waste
 * are ordered stacks, so their sequence is part of the state.
 */
export function simKey(s: Sim): string {
  const t: string[] = [];
  for (let c = 0; c < s.tableau; c++) {
    let p = '';
    for (const id of s.cols[c]) p += (s.up[id] ? 'u' : 'd') + id.toString(36) + ',';
    t.push(p);
  }
  t.sort();
  return `${t.join('|')}#${stock(s).join(',')}#${waste(s).join(',')}#${s.passesLeft}`;
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

/** May this card be dropped into an empty tableau column? */
export function canPlaceEmpty(d: CardDef, R: RuleSet): boolean {
  if (d.key) return true;
  if (d.stuck) return false;
  if (R.empty === 'none') return false;
  // "Royal Gates" admits the three ranks nearest the natural base of a stack.
  if (R.empty === 'top') return Math.abs(d.rank - R.baseRank) <= 2;
  return true;
}

export function isFrozen(s: Sim, id: number): boolean {
  return s.defs[id].frozen && s.revealed < s.rules.thawAt;
}

export function moveCost(s: Sim, headId: number, toCol: number): number {
  const d = s.defs[headId];
  let cost = d.free ? 0 : 1;
  if (d.heavy) cost += 1;
  const intoEmpty = toCol >= 0 && toCol < s.tableau && s.cols[toCol].length === 0;
  if (intoEmpty) {
    // Keystone sets the base for nothing. Bypassing the empty-column rules was
    // its whole effect, and under standard rules there are none to bypass —
    // measured, it saved 0 of 19 lost boards. Making the move itself free gives
    // it something to do on every board rather than only under Royal Gates,
    // Sealed Vaults or Tithe.
    if (d.key) return 0;
    cost += s.rules.emptyCost;
  }
  if (d.spring) cost -= 1;
  return Math.max(0, cost);
}

/**
 * Lowest index in tableau column `c` from which the cards above form a legal,
 * face-up, movable run.
 */
export function runStart(s: Sim, c: number): number {
  const col = s.cols[c];
  let i = col.length - 1;
  if (i < 0) return 0;
  if (c >= s.tableau) return i; // only the top of the waste ever moves
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
  const nT = s.tableau;

  // Turning the next card off the draw pile. Always available while it has
  // cards, which is why a board is rarely "stuck" before the pile runs dry.
  if (stock(s).length > 0 && (!affordableOnly || R.drawCost <= s.movesLeft)) {
    out.push({ kind: 'd', from: stockIdx(s), fromIdx: stock(s).length - 1, to: wasteIdx(s), cost: R.drawCost });
  } else if (stock(s).length === 0 && waste(s).length > 0 && s.passesLeft > 0) {
    // Turning the waste back over. Without this a card drawn with nowhere to
    // go would strand the level permanently, since every card has to be placed.
    if (!affordableOnly || R.drawCost <= s.movesLeft) {
      out.push({ kind: 'r', from: wasteIdx(s), fromIdx: 0, to: stockIdx(s), cost: R.drawCost });
    }
  }

  // Empty tableau columns are interchangeable: only ever offer the first.
  let firstEmpty = -1;
  for (let t = 0; t < nT; t++) {
    if (s.cols[t].length === 0) {
      firstEmpty = t;
      break;
    }
  }

  // Sources: every tableau column, plus the top of the waste.
  const sources: number[] = [];
  for (let c = 0; c < nT; c++) sources.push(c);
  if (waste(s).length > 0) sources.push(wasteIdx(s));

  for (const c of sources) {
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

    const start = runStart(s, c);

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

      for (let t = 0; t < nT; t++) {
        if (t === c) continue;
        const tcol = s.cols[t];
        if (tcol.length === 0) {
          if (t !== firstEmpty) continue;
          if (!canPlaceEmpty(d, R)) continue;
          // Sliding a whole tableau column into an empty one achieves nothing.
          if (i === 0 && c < nT) continue;
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
    ev?.push({ t: 'gold', n: 2, src: 'gild' });
  }
  if (d.beacon) {
    s.movesLeft += 2;
    ev?.push({ t: 'moves', n: 2, src: 'beacon' });
  }
  if (d.torch) {
    // The most buried tableau column, so a Torch drawn off the pile still
    // earns its keep instead of firing into an all-face-up waste.
    let best = -1;
    let bestDepth = -1;
    for (let ci = 0; ci < s.tableau; ci++) {
      const c = s.cols[ci];
      let n = 0;
      for (const cid of c) if (!s.up[cid]) n++;
      if (n > bestDepth) {
        bestDepth = n;
        best = ci;
      }
    }
    if (best >= 0 && bestDepth > 0) {
      const c = s.cols[best];
      for (let i = 0; i < c.length; i++) {
        if (!s.up[c[i]]) {
          const before = s.revealed;
          flipCard(s, c[i], best, i, ev);
          if (s.revealed > before) ev?.push({ t: 'cascade', src: 'torch', n: s.revealed - before });
          break;
        }
      }
    }
  }
  if (d.resonance) {
    // Pays for the build's density rather than for any one card. It counts what
    // is already face-up, so a deck that commits to enchantments compounds as
    // the board opens up instead of adding a fixed amount per card.
    let others = 0;
    for (let i = 0; i < s.defs.length; i++) {
      if (i !== id && s.defs[i].ench !== null && s.up[i] && !s.gone[i]) others++;
    }
    if (others > 0) {
      s.movesLeft += others;
      ev?.push({ t: 'moves', n: others, src: 'resonance' });
    }
  }
  if (d.conduit) {
    // Reaches for another card the player chose, so chains are buildable rather
    // than accidental: a Conduit into a Torch into a Twin does more than the
    // three of them apart, and a Conduit into a Conduit runs the whole line.
    // flipCard returns early on an already-turned card, so a chain terminates.
    let best = -1;
    let bestIdx = -1;
    let bestCol = -1;
    for (let ci = 0; ci < s.tableau; ci++) {
      const c = s.cols[ci];
      for (let i = c.length - 1; i >= 0; i--) {
        const cid = c[i];
        if (!s.up[cid] && s.defs[cid].ench !== null) {
          // Nearest means closest to the top of its column: the one the player
          // would have reached soonest anyway.
          if (i > bestIdx) {
            best = cid;
            bestIdx = i;
            bestCol = ci;
          }
          break;
        }
      }
    }
    if (best >= 0) {
      const before = s.revealed;
      flipCard(s, best, bestCol, bestIdx, ev);
      if (s.revealed > before) ev?.push({ t: 'cascade', src: 'conduit', n: s.revealed - before });
    }
  }
  if (d.twin) {
    const before = s.revealed;
    for (let ci = 0; ci < s.tableau; ci++) {
      const c = s.cols[ci];
      for (let i = 0; i < c.length; i++) {
        if (!s.up[c[i]] && s.defs[c[i]].rank === d.rank) flipCard(s, c[i], ci, i, ev);
      }
    }
    if (s.revealed > before) ev?.push({ t: 'cascade', src: 'twin', n: s.revealed - before });
  }
}

/** Turn any newly exposed face-down tableau cards and resolve the cascade. */
export function settle(s: Sim, ev: SimEvent[] | null): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < s.tableau; c++) {
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

  if (mv.kind === 'd') {
    const from = stock(s);
    const to = waste(s);
    const ids: number[] = [];
    for (let n = 0; n < s.rules.drawCount && from.length > 0; n++) {
      const id = from.pop()!;
      to.push(id);
      ids.push(id);
    }
    ev?.push({ t: 'draw', ids });
    // A card coming round on a later pass is already known, so it turns only
    // the first time it is seen.
    for (const id of ids) flipCard(s, id, wasteIdx(s), to.indexOf(id), ev);
  } else if (mv.kind === 'r') {
    const from = waste(s);
    const to = stock(s);
    const n = from.length;
    while (from.length) to.push(from.pop()!);
    s.passesLeft -= 1;
    ev?.push({ t: 'recycle', n });
  } else if (mv.kind === 'f') {
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

    // Featherweight and Kickback work by quietly making a move cheaper, which
    // meant the player saw a number that was lower than expected and nothing
    // telling them why. Announce the saving and name the card that made it.
    const head = s.defs[moved[0]];
    if (head.free) ev?.push({ t: 'discount', src: 'free', saved: 1 });
    else if (head.spring) ev?.push({ t: 'discount', src: 'spring', saved: 1 });
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
