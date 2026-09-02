/**
 * The guided first level.
 *
 * Hand-authored rather than generated: the point is that every early move is
 * forced or obvious, so each lesson lands in the order it is taught. The board
 * is verified winnable by a test rather than by the solver at deal time, so
 * starting the tutorial is instant.
 *
 * The intended line, in order:
 *   6♠ onto 7♥      — stacking, and the card underneath turns
 *   9♠ to reserve   — nothing is a ten, so the reserve is the only home
 *   2♦ onto 3♠      — which empties a column
 *   8♠ run to empty — an ordered run travels as one move
 *   ...then nine moves of free play to finish.
 */
import type { Level, LevelSpec } from './deal.ts';
import { createSim, legalMoves, type Sim } from './sim.ts';
import { DEFAULT_RULES, makeCardDef, type CardDef, type Move, type Suit } from './types.ts';

const S = 0 as Suit;
const H = 1 as Suit;
const D = 2 as Suit;
const C = 3 as Suit;

interface Slot {
  rank: number;
  suit: Suit;
  up: boolean;
}

const up = (rank: number, suit: Suit): Slot => ({ rank, suit, up: true });
const down = (rank: number, suit: Suit): Slot => ({ rank, suit, up: false });

/** Columns bottom-first, exactly as they are dealt. */
const LAYOUT: Slot[][] = [
  [down(4, C), up(8, S), up(7, H)],
  [down(2, D), up(6, S)],
  [down(5, H), up(3, S), up(9, S)],
  [down(1, C), up(8, H), up(4, D)],
  [down(6, D), up(2, C), up(7, S)],
];

export const TUTORIAL_CELLS = 3;
export const TUTORIAL_BUDGET = 30;

export const TUTORIAL_SPEC: LevelSpec = {
  depth: 0,
  kind: 'tutorial',
  modifiers: [],
  seed: 0,
};

export function buildTutorialLevel(): Level {
  const defs: CardDef[] = [];
  const cols: number[][] = [];
  const flags: boolean[] = [];

  for (const column of LAYOUT) {
    const ids: number[] = [];
    for (const slot of column) {
      const id = defs.length;
      defs.push(makeCardDef({ uid: id + 1, rank: slot.rank, suit: slot.suit, ench: null, curse: null }));
      flags.push(slot.up);
      ids.push(id);
    }
    cols.push(ids);
  }

  const faceUp = Uint8Array.from(flags, (v) => (v ? 1 : 0));
  const rules = { ...DEFAULT_RULES, baseRank: 9 };
  const sim = createSim(defs, cols, faceUp, rules, TUTORIAL_BUDGET, TUTORIAL_CELLS);

  return {
    spec: TUTORIAL_SPEC,
    sim,
    columns: LAYOUT.length,
    cells: TUTORIAL_CELLS,
    relaxed: 0,
    modifiers: [],
    undosLeft: 99,
    undoCostsMove: false,
    timeLimit: 0,
    peeksLeft: 0,
    solution: null,
    par: 14,
    budget: TUTORIAL_BUDGET,
    baseGold: 0,
    freeFirstMove: false,
  };
}

/* ------------------------------------------------------------------ script */

/** Running tally of the kinds of move the player has made. */
export interface CoachTally {
  stacked: number; // placed a card onto another card
  reserved: number; // parked a card in the reserve
  emptied: number; // left a tableau column empty
  grouped: number; // moved two or more cards at once
}

export function emptyTally(): CoachTally {
  return { stacked: 0, reserved: 0, emptied: 0, grouped: 0 };
}

export interface CoachStep {
  /** The lesson, in one or two short sentences. */
  text: string;
  /** Highlight the suggested move while this step is showing. */
  coach: boolean;
  done(sim: Sim, tally: CoachTally): boolean;
}

export const COACH_STEPS: CoachStep[] = [
  {
    text: 'Turn every face-down card and the level is won. Nothing ever leaves the board.\n\nStack the 6♠ on the 7♥ — one rank lower, opposite colour.',
    coach: true,
    done: (_s, t) => t.stacked > 0,
  },
  {
    text: 'Uncovering a card turns it. Four still face down.\n\nNothing here is a ten, so the 9♠ has nowhere to stack. Park it in the reserve.',
    coach: true,
    done: (_s, t) => t.reserved > 0,
  },
  {
    text: 'Reserve cards come back out whenever you want them.\n\nNow empty a column: the 2♦ goes on the 3♠.',
    coach: true,
    done: (_s, t) => t.emptied > 0,
  },
  {
    text: 'An empty column will take any card at all.\n\nAn ordered run travels as one move — send the 8♠ and everything on it into the gap.',
    coach: true,
    done: (_s, t) => t.grouped > 0,
  },
  {
    text: 'That is the whole game. The number up top is your move allowance — spend it all in a real run and the run ends.\n\nFinish the board.',
    coach: false,
    done: (s) => s.hidden === 0,
  },
];

/**
 * The move a lesson is pointing at.
 *
 * Chosen by matching the lesson rather than by asking the solver, so the
 * highlight can never contradict the sentence next to it — and it re-derives
 * itself after every move, so a player who improvises still gets a live arrow.
 */
export function coachMove(sim: Sim, step: number): Move | null {
  const moves = legalMoves(sim, true);
  const onto = (m: Move): boolean => m.kind === 'm' && m.to < sim.cellStart && sim.cols[m.to].length > 0;
  const toCell = (m: Move): boolean => m.kind === 'm' && m.to >= sim.cellStart;
  const toEmpty = (m: Move): boolean => m.kind === 'm' && m.to < sim.cellStart && sim.cols[m.to].length === 0;
  const size = (m: Move): number => sim.cols[m.from].length - m.fromIdx;

  switch (step) {
    case 0:
      return moves.find(onto) ?? null;
    case 1:
      return (
        moves.find((m) => toCell(m) && sim.defs[sim.cols[m.from][m.fromIdx]].rank === 9) ??
        moves.find(toCell) ??
        null
      );
    case 2:
      return moves.find((m) => onto(m) && m.fromIdx === 0) ?? moves.find(onto) ?? null;
    case 3:
      return moves.find((m) => toEmpty(m) && size(m) >= 2) ?? moves.find(toEmpty) ?? null;
    default:
      return null;
  }
}

/** Which lesson the tally satisfies, so a player who improvises still advances. */
export function stepFor(sim: Sim, tally: CoachTally): number {
  let i = 0;
  while (i < COACH_STEPS.length - 1 && COACH_STEPS[i].done(sim, tally)) i++;
  return i;
}
