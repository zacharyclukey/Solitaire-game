/**
 * A bounded-lookahead player: the instrument for asking whether the game is
 * beatable by somebody who is not a search algorithm.
 *
 * Every balance number the solver produces is a claim about perfect play, and
 * the move economy is entirely a question about imperfect play — a solver banks
 * moves nobody would bank. So this plays the way a decent human plays: a few
 * moves of lookahead, a strong preference for turning cards over, no memory of
 * positions it has already rejected, and no ability to back out of a line once
 * it is committed.
 *
 * It is deliberately not the solver with a smaller budget. It has a hard
 * horizon and a narrow branching cap, so it walks into dead ends that a
 * searcher would see coming, which is the entire point of having it.
 */
import { applyMove, cloneSim, isWon, legalMoves, remaining, simKey, type Sim } from './sim.ts';
import type { Move } from './types.ts';
import { heuristic } from './solver.ts';

export interface BotOptions {
  /** Plies of lookahead. 1 is purely greedy; 3 is a thoughtful player. */
  depth: number;
  /** Moves considered per ply. A human does not evaluate all 30 either. */
  width: number;
  /** How much the player dislikes spending a move to gain position. */
  costWeight: number;
  /**
   * What an empty column is worth, in cards-not-yet-placed.
   *
   * The solver's heuristic does not price these at all, because a searcher
   * finds the line that uses one whether or not it was aiming for it. A human
   * cannot see that far and plays for the empty column deliberately — it is the
   * only real sink on a board with no foundations. Without this term the bot
   * strands its last few cards on boards the solver clears comfortably.
   */
  emptyValue: number;
}

export const CASUAL: BotOptions = { depth: 2, width: 4, costWeight: 0.35, emptyValue: 2 };
export const CAREFUL: BotOptions = { depth: 3, width: 6, costWeight: 0.35, emptyValue: 2.5 };

/** Lower is better: work remaining, plus what the line cost to get here. */
function evaluate(s: Sim, spent: number, o: BotOptions): number {
  let empties = 0;
  for (let c = 0; c < s.tableau; c++) if (s.cols[c].length === 0) empties++;
  return heuristic(s) - empties * o.emptyValue + spent * o.costWeight;
}

/**
 * Immediate appeal of a move, used only to decide which handful of moves are
 * worth thinking about. This is the shortcut that makes the bot fallible: a
 * good move that looks bad right now never gets searched.
 */
function shallow(s: Sim, mv: Move, o: BotOptions): number {
  const next = cloneSim(s);
  applyMove(next, mv, null);
  return evaluate(next, mv.cost, o);
}

function best(s: Sim, depth: number, o: BotOptions): number {
  if (isWon(s)) return -1000;
  if (depth === 0 || s.movesLeft <= 0) return evaluate(s, 0, o);
  const moves = legalMoves(s, true);
  if (!moves.length) return evaluate(s, 0, o) + 500; // dead end, and it hurts
  const shortlist = moves
    .map((mv) => ({ mv, v: shallow(s, mv, o) }))
    .sort((a, b) => a.v - b.v)
    .slice(0, o.width);
  let v = Infinity;
  for (const { mv } of shortlist) {
    const next = cloneSim(s);
    applyMove(next, mv, null);
    v = Math.min(v, best(next, depth - 1, o) + mv.cost * o.costWeight);
  }
  return v;
}

/**
 * The move this player would make here, or null if it sees nothing to do.
 *
 * `seen` holds positions already reached this game. Without it the player
 * shuffles a card back and forth forever, which no human does and which made
 * the first version of this bot burn twenty moves failing to place two cards.
 * It is not search memory — the bot still cannot see past its horizon — it is
 * just the ordinary human refusal to walk in a circle.
 */
export function botMove(s: Sim, o: BotOptions = CASUAL, seen?: Set<string>): Move | null {
  const moves = legalMoves(s, true);
  if (!moves.length) return null;
  const shortlist = moves
    .map((mv) => ({ mv, v: shallow(s, mv, o) }))
    .sort((a, b) => a.v - b.v)
    .slice(0, o.width);
  let pick: Move | null = null;
  let bestV = Infinity;
  for (const { mv } of shortlist) {
    const next = cloneSim(s);
    applyMove(next, mv, null);
    let v = best(next, o.depth - 1, o) + mv.cost * o.costWeight;
    if (seen?.has(simKey(next))) v += 100;
    if (v < bestV) {
      bestV = v;
      pick = mv;
    }
  }
  return pick;
}

export interface BotResult {
  won: boolean;
  movesUsed: number;
  /** Moves left on the table — what a real run would carry forward. */
  movesLeft: number;
  /** Cards still to place when it gave up. */
  remaining: number;
}

/** Plays a board to a finish. The sim is mutated. */
export function playBot(s: Sim, o: BotOptions = CASUAL, moveCap = 400): BotResult {
  const seen = new Set<string>([simKey(s)]);
  for (let i = 0; i < moveCap; i++) {
    if (isWon(s)) break;
    if (s.movesLeft <= 0) break;
    const mv = botMove(s, o, seen);
    if (!mv) break;
    applyMove(s, mv, null);
    seen.add(simKey(s));
  }
  return {
    won: isWon(s),
    movesUsed: s.movesUsed,
    movesLeft: Math.max(0, s.movesLeft),
    remaining: remaining(s),
  };
}

/**
 * Could a person finish this board at all?
 *
 * "Clearable" has meant clearable by a weighted A* search, and past the mid
 * game that stopped meaning clearable by a player: the bot lost four of eight
 * stage-10 boards with 999 moves in hand. This asks the weaker question the
 * player actually cares about — is there a line a bounded-lookahead player can
 * find — with moves deliberately not the constraint, so it tests the shape of
 * the board rather than the size of the purse.
 *
 * The bot is a lower bound on human skill, so this filter is conservative in
 * the player's favour: boards it rejects might well have been clearable by a
 * person, but boards it accepts almost certainly are.
 */
export function humanlyClearable(s: Sim, budget: number, o: BotOptions = CAREFUL): boolean {
  const probe = cloneSim(s);
  probe.movesLeft = budget;
  probe.movesUsed = 0;
  return playBot(probe, o).won;
}
