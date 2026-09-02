/**
 * Why the run ended.
 *
 * Every board is certified winnable before it is dealt, and the allowance comes
 * from a line the solver actually found — so a loss is always a line the player
 * missed rather than a deal they could not have cleared. That only helps if we
 * say so. This module replays the level that just ended and asks the solver two
 * questions:
 *
 *   1. From the position you finished in, how many more moves would a win have
 *      needed than you had left? (`shortBy`)
 *   2. Which move was the last one after which a win was still reachable inside
 *      the allowance you had at the time? (`lastWinnableAfter`)
 *
 * The second is the diagnostic one: it turns "you ran out" into "it slipped at
 * move 19, and you played eleven more after that".
 *
 * A caveat that runs through everything here: the solver returns null when it
 * finds no winning line *within its search budget*, which is not the same as
 * proving no line exists. Every claim this module makes in the other direction
 * — "the board was winnable through move k" — is backed by a line the solver
 * actually found, so it is safe. Claims of unwinnability are hedged in the
 * copy ("no line could be found") for exactly this reason.
 */
import { findSolution, solve } from './solver.ts';
import { applyMove, cloneSim, isWon, legalMoves, sameMove, type Sim } from './sim.ts';
import type { Move } from './types.ts';

export interface PostMortem {
  /** Moves played before the run ended. */
  movesPlayed: number;
  /** Total move cost spent. */
  costSpent: number;
  /**
   * How many more moves the final position needed to be winnable, ignoring the
   * allowance. null if the final position cannot be won at any cost.
   */
  shortBy: number | null;
  /**
   * Index into `played` of the last move after which a win was STILL reachable
   * inside the allowance that remained. 0 means the deal was already lost by
   * the first move; equal to played.length means it was winnable to the end
   * (so the player simply ran the clock out). null if it was never winnable
   * from the start, which should not happen for a dealt board.
   */
  lastWinnableAfter: number | null;
  /**
   * How many moves were played after the position stopped being winnable —
   * `played.length - lastWinnableAfter`, counting the move that closed the line
   * as the first of them. 0 means the line was still open at the end.
   */
  movesAfterLoss: number | null;
  /** One plain sentence for the player. Never blames luck. */
  verdict: string;
}

export interface PostMortemOptions {
  /** Wall-clock budget for the whole analysis. Default 1200. */
  budgetMs?: number;
}

/** A slip this close to the end reads as a near miss rather than a wrong turn. */
const NEAR_MISS = 2;

/** Share of the budget spent on the "how short were they" question. */
const SHORT_BY_SHARE = 0.3;

/** Below this there is no point starting another solver pass. */
const MIN_SLICE_MS = 40;

/**
 * Is a win still reachable from `sim` using only the moves it has left?
 *
 * Two passes, greedy first: for a yes/no question any line will do, and the
 * greedy weight finds one fast when one is there. The low-weight pass is the
 * backstop for positions where greed walks into a dead end.
 *
 * `false` means "no line found inside this search budget", which is weaker than
 * "provably unwinnable". Callers must not word it as proof.
 */
export function winnableInBudget(sim: Sim, maxMs = 220): boolean {
  if (isWon(sim)) return true;
  // Free outs, no search needed: nothing left to pay with, or nothing to play.
  if (sim.movesLeft <= 0) return false;
  if (legalMoves(sim, true).length === 0) return false;
  const opts = { respectBudget: true } as const;
  if (solve(sim, { ...opts, weight: 5, maxNodes: 12000, maxMs: maxMs * 0.55 })) return true;
  return solve(sim, { ...opts, weight: 1.8, maxNodes: 18000, maxMs: maxMs * 0.45 }) !== null;
}

/**
 * The position after each move: `states[i]` is the board with `i` moves played.
 *
 * A move that is not legal in the position it is handed ends the replay — a
 * post-mortem must never be the thing that throws on the loss screen.
 */
function replay(start: Sim, played: Move[]): Sim[] {
  const states: Sim[] = [cloneSim(start)];
  for (const mv of played) {
    const cur = states[states.length - 1];
    if (!legalMoves(cur, false).some((m) => sameMove(m, mv))) break;
    const next = cloneSim(cur);
    applyMove(next, mv, null);
    states.push(next);
  }
  return states;
}

interface Boundary {
  index: number | null;
  /** False when the wall-clock budget ran out before the search could answer. */
  complete: boolean;
}

/**
 * The last state in the played line from which a win was still reachable inside
 * the allowance remaining there, by binary search.
 *
 * WHY BINARY SEARCH IS VALID HERE. Let `W(i)` mean "a win exists from state i
 * using at most the moves state i has left". `W` is monotone: if `W(i+1)` held,
 * then that winning line, prefixed by the move that produced state i+1, is a
 * winning line from state i — and it fits, because state i's allowance is state
 * i+1's allowance plus the cost of that move. So `W(i+1) ⇒ W(i)`, and
 * contrapositively, once the position stops being winnable it never becomes
 * winnable again. `W` is therefore true on a prefix `[0, k]` and false after,
 * and the boundary `k` can be found in ~log2(n) solver calls instead of n.
 *
 * (The solver's incompleteness does not break the search's shape: a false
 * negative can only move the answer earlier, and the returned index is always
 * one the solver positively certified, so `lastWinnableAfter` is a lower bound
 * on the truth rather than a guess.)
 */
function lastWinnable(states: Sim[], deadline: number): Boundary {
  const n = states.length - 1;
  // Roughly the number of probes a binary search over [0, n] will make, plus
  // one for the verification of index 0. Used to size each probe's slice.
  let probesLeft = Math.max(1, Math.ceil(Math.log2(n + 1))) + 1;

  const probe = (i: number): boolean | null => {
    const left = deadline - Date.now();
    if (left < MIN_SLICE_MS) return null;
    const slice = Math.max(MIN_SLICE_MS, left / probesLeft);
    probesLeft = Math.max(1, probesLeft - 1);
    return winnableInBudget(states[i], Math.min(slice, left));
  };

  // The deal was certified winnable before it was handed over, so index 0 is
  // taken as winnable until the search actually depends on it (below).
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2); // bias up: we want the largest true
    const r = probe(mid);
    if (r === null) return { index: null, complete: false };
    if (r) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) {
    const r = probe(0);
    if (r === null) return { index: null, complete: false };
    if (!r) return { index: null, complete: true }; // never winnable at all
  }
  return { index: lo, complete: true };
}

/**
 * `start` must be the level's INITIAL simulation (nothing played yet) and
 * `played` the moves in the order they were made.
 */
export function analyse(start: Sim, played: Move[], opts: PostMortemOptions = {}): PostMortem {
  const deadline = Date.now() + (opts.budgetMs ?? 1200);
  const states = replay(start, played);
  const n = states.length - 1;
  const final = states[n];

  // How short were they? Win from the final position at any cost, then measure
  // that line against what the allowance had left.
  let shortBy: number | null = null;
  if (isWon(final)) {
    shortBy = 0;
  } else {
    const left = deadline - Date.now();
    if (left >= MIN_SLICE_MS) {
      const line = findSolution(final, Math.min(400, Math.max(MIN_SLICE_MS, left * SHORT_BY_SHARE)));
      if (line) shortBy = Math.max(0, line.cost - Math.max(0, final.movesLeft));
    }
  }

  const boundary = lastWinnable(states, deadline);
  const k = boundary.index;
  // The two searches ask the same question with different budgets, so they can
  // disagree at the edge. The budgeted one is the stricter test — and it is the
  // one backed by a line the solver actually found — so trust it.
  if (k === n) shortBy = 0;

  return {
    movesPlayed: n,
    costSpent: final.movesUsed - states[0].movesUsed,
    shortBy,
    lastWinnableAfter: k,
    movesAfterLoss: k === null ? null : n - k,
    verdict: verdictFor(n, k, shortBy, boundary.complete),
  };
}

/** `1 move` / `4 moves`. */
function moves(n: number): string {
  return `${n} move${n === 1 ? '' : 's'}`;
}

/**
 * The last thing a player reads before starting again.
 *
 * Rules for this copy: name a number they can act on, credit the part of the
 * line they actually played, never claim more certainty than the search has,
 * and never mention the deal, luck or their competence.
 */
function verdictFor(n: number, k: number | null, shortBy: number | null, complete: boolean): string {
  if (k === null) {
    if (!complete) {
      if (shortBy !== null && shortBy > 0) {
        return `A win was still ${moves(shortBy)} out of reach when this ended, though the analysis ran out of time before it could say where the line slipped.`;
      }
      return 'This one could not be checked — the analysis ran out of time before it reached an answer.';
    }
    return 'No winning line could be found even from the opening position, so there is nothing here to hold your play against.';
  }

  const after = n - k;

  if (after === 0) {
    return 'The board was still winnable when the level ended, so the allowance was not what beat you.';
  }

  // Checked before the near-miss case: "your first move" is the more useful
  // thing to hear, even on a line only two moves long.
  if (k === 0) {
    if (n === 1) {
      return 'The opening position had a win in it, and no line could be found after the one move you played.';
    }
    return `The opening position had a win in it, and no line could be found after your very first move — the ${moves(n - 1)} you played from there had nowhere to go.`;
  }

  if (after <= NEAR_MISS) {
    return `A near miss: the board was still winnable through move ${k} of ${n}, and no line could be found past move ${k + 1}.`;
  }

  if (shortBy !== null && shortBy > 0) {
    return `The board was winnable through move ${k} of ${n}; you played ${moves(after)} from there and finished ${moves(shortBy)} short of a win.`;
  }

  if (shortBy === 0) {
    return `The board was winnable through move ${k} of ${n}, and a win was still within reach at the end — the allowance was what ran out.`;
  }

  return `The board was winnable through move ${k} of ${n}; no line could be found after move ${k + 1}, and you played ${moves(after - 1)} more from there.`;
}
