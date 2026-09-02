/**
 * The Oracle.
 *
 * Every board in this game has been solved before you see it, which means the
 * game knows things no other card game can know: whether you are still winning,
 * what the line is, and exactly which move threw it away. A hint button wastes
 * that. Asking it questions does not.
 *
 * Readings are paid for in Insight, a resource separate from the move
 * allowance — so asking for help never eats the margin you need to finish, and
 * the help itself is something you earn by playing well rather than something
 * you buy with the clock.
 */
import { analyse } from './postmortem.ts';
import { winnableInBudget } from './postmortem.ts';
import { cloneSim, type Sim } from './sim.ts';
import { findSolution, hint } from './solver.ts';
import type { Move } from './types.ts';

export type QuestionId = 'alive' | 'line' | 'wrong';

export interface Question {
  id: QuestionId;
  label: string;
  blurb: string;
  cost: number;
}

export const QUESTIONS: Question[] = [
  {
    id: 'alive',
    label: 'Am I still winning?',
    blurb: 'Whether a line still exists from here, inside the moves you have left.',
    cost: 1,
  },
  {
    id: 'line',
    label: 'What should I play?',
    blurb: 'The next move of a line that finishes the board.',
    cost: 2,
  },
  {
    id: 'wrong',
    label: 'Where did I go wrong?',
    blurb: 'The move that closed the line, if it is already gone.',
    cost: 2,
  },
];

export function questionById(id: QuestionId): Question {
  return QUESTIONS.find((q) => q.id === id)!;
}

export interface AskContext {
  /** The position as it stands. */
  sim: Sim;
  /** The deal as it began, for questions that need the whole history. */
  start: Sim | null;
  /** Moves played so far. */
  played: Move[];
  budgetMs?: number;
}

export interface Answer {
  text: string;
  tone: 'good' | 'bad' | 'flat';
  /** For "what should I play" — the move to light up on the board. */
  move?: Move | null;
  /** For "where did I go wrong" — how many moves back the line was still open. */
  rewind?: number | null;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ask(id: QuestionId, ctx: AskContext): Answer {
  const ms = ctx.budgetMs ?? 500;

  if (id === 'alive') {
    if (winnableInBudget(cloneSim(ctx.sim), ms)) {
      return { text: 'Yes. A line still finishes this board inside the moves you have left.', tone: 'good' };
    }
    // Distinguish "no line at all" from "no line you can still afford", which
    // are very different pieces of news.
    const loose = cloneSim(ctx.sim);
    loose.movesLeft = Number.MAX_SAFE_INTEGER / 4;
    const sol = findSolution(loose, ms);
    if (sol) {
      const short = sol.cost - Math.max(0, ctx.sim.movesLeft);
      return {
        text: `No — but only just. The board can still be finished; it needs ${plural(short, 'more move')} than you have.`,
        tone: 'bad',
      };
    }
    return { text: 'No. There is no line left from this position at any cost.', tone: 'bad' };
  }

  if (id === 'line') {
    const mv = hint(cloneSim(ctx.sim));
    if (!mv) return { text: 'Nothing to suggest — no line was found from here.', tone: 'bad', move: null };
    return { text: 'This is the next move of a line that finishes.', tone: 'good', move: mv };
  }

  // 'wrong'
  if (!ctx.start || ctx.played.length === 0) {
    return { text: 'Nothing has been played yet, so nothing has gone wrong.', tone: 'flat' };
  }
  const pm = analyse(ctx.start, ctx.played, { budgetMs: ms * 2 });
  if (pm.lastWinnableAfter === null) {
    return { text: pm.verdict, tone: 'flat' };
  }
  const after = pm.movesPlayed - pm.lastWinnableAfter;
  if (after === 0) {
    return { text: 'Nothing yet. The board was still winnable after every move you have made.', tone: 'good', rewind: 0 };
  }
  return {
    text: `The line was still open after move ${pm.lastWinnableAfter} of ${pm.movesPlayed}. It closed on the next one, and you have played ${plural(after - 1, 'move')} since.`,
    tone: 'bad',
    rewind: after,
  };
}
