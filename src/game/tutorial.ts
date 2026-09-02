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
 *   draw            — the board deliberately locks solid until you do
 *   2♦ onto 3♠      — which empties a column
 *   8♠ run to empty — an ordered run travels as one move
 *   ...then free play to finish.
 *
 * Two properties of this layout are load-bearing and asserted by tests: at the
 * start there is exactly one stacking move and it turns a card, and after it
 * there is no tableau move at all, so the draw lesson is forced by the board
 * rather than merely asked for by the text.
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
  [down(5, H), up(4, S)],
  [down(1, C), up(4, D)],
  [down(6, D), up(7, S)],
];

/** The draw pile, bottom first — so the last entry is turned first. */
const STOCK: Slot[] = [down(8, H), down(2, C), down(5, D), down(3, S)];

export const TUTORIAL_BUDGET = 34;

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

  const add = (slot: Slot): number => {
    const id = defs.length;
    defs.push(makeCardDef({ uid: id + 1, rank: slot.rank, suit: slot.suit, ench: null, curse: null }));
    flags.push(slot.up);
    return id;
  };

  for (const column of LAYOUT) cols.push(column.map(add));
  const stockCards = STOCK.map(add);

  const faceUp = Uint8Array.from(flags, (v) => (v ? 1 : 0));
  const rules = { ...DEFAULT_RULES, baseRank: 8 };
  const sim = createSim(defs, cols, stockCards, faceUp, rules, TUTORIAL_BUDGET);

  return {
    spec: TUTORIAL_SPEC,
    sim,
    columns: LAYOUT.length,
    stockSize: STOCK.length,
    relaxed: 0,
    modifiers: [],
    undosLeft: 99,
    undoCostsMove: false,
    timeLimit: 0,
    peeksLeft: 0,
    solution: null,
    par: 16,
    budget: TUTORIAL_BUDGET,
    baseGold: 0,
    freeFirstMove: false,
  };
}

/* ------------------------------------------------------------------ script */

/** Running tally of the kinds of move the player has made. */
export interface CoachTally {
  stacked: number; // placed a card onto another card
  drew: number; // turned a card off the draw pile
  emptied: number; // left a tableau column empty
  grouped: number; // moved two or more cards at once
}

export function emptyTally(): CoachTally {
  return { stacked: 0, drew: 0, emptied: 0, grouped: 0 };
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
    text: 'Uncovering a card turns it — that is the whole goal.\n\nNothing on the table can move now. Turn a card off the draw pile.',
    coach: true,
    done: (_s, t) => t.drew > 0,
  },
  {
    text: 'Every card in that pile has to be turned too, and each turn costs a move. Play what you draw while you can — the next one buries it.\n\nNow empty a column.',
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
  const onto = (m: Move): boolean => m.kind === 'm' && m.to < sim.tableau && sim.cols[m.to].length > 0;
  const toEmpty = (m: Move): boolean => m.kind === 'm' && m.to < sim.tableau && sim.cols[m.to].length === 0;
  const size = (m: Move): number => sim.cols[m.from].length - m.fromIdx;

  switch (step) {
    case 0:
      return moves.find(onto) ?? null;
    case 1:
      return moves.find((m) => m.kind === 'd') ?? null;
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
