/**
 * Cross-run achievements.
 *
 * A roguelite lives on the reason to start run number two, and depth alone is a
 * thin one. Each entry is a pure predicate over a context the controller
 * assembles at three moments — a level cleared, a run ended, the guided board
 * finished — so the whole set is testable without a browser.
 */
import type { Level } from './deal.ts';
import type { RunState } from './run.ts';

/** Counters for the level being played. Reset on every deal. */
export interface LevelTally {
  hints: number;
  undos: number;
  /** Cards still stranded on the waste when the board was cleared. */
  wasteLeft: number;
  /** Most cards turned by a single move — Torch and Twin can cascade. */
  maxFlips: number;
  spare: number;
  secondsLeft: number;
}

/** Counters for the run as a whole. Reset when a run starts. */
export interface RunStreak {
  cleanLevels: number; // cleared with no hint
  patientLevels: number; // cleared with no undo
}

export interface AchieveCtx {
  totals: { cardsTurned: number; runs: number };
  run: RunState | null;
  level: Level | null;
  tally: LevelTally;
  streak: RunStreak;
}

export interface Achievement {
  id: string;
  name: string;
  text: string;
  test(c: AchieveCtx): boolean;
}

export function emptyTally(): LevelTally {
  return { hints: 0, undos: 0, wasteLeft: 0, maxFlips: 0, spare: 0, secondsLeft: 0 };
}

export function emptyStreak(): RunStreak {
  return { cleanLevels: 0, patientLevels: 0 };
}

const depthAt = (c: AchieveCtx, n: number): boolean => (c.run?.depth ?? 0) >= n;
const deck = (c: AchieveCtx): RunState['deck'] => c.run?.deck ?? [];

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'taught',
    name: 'Taught',
    text: 'Finish the guided board.',
    test: () => false, // awarded directly when the tutorial is completed
  },
  { id: 'depth3', name: 'First Descent', text: 'Clear three levels in one run.', test: (c) => depthAt(c, 3) },
  { id: 'depth5', name: 'Warden Down', text: 'Clear five levels in one run.', test: (c) => depthAt(c, 5) },
  { id: 'depth10', name: 'Ten Deep', text: 'Clear ten levels in one run.', test: (c) => depthAt(c, 10) },
  { id: 'depth15', name: 'Fifteen Deep', text: 'Clear fifteen levels in one run.', test: (c) => depthAt(c, 15) },
  { id: 'depth20', name: 'The Abyss', text: 'Clear twenty levels in one run.', test: (c) => depthAt(c, 20) },
  {
    id: 'tight',
    name: 'Not a Move Wasted',
    text: 'Clear a level with two moves or fewer to spare.',
    test: (c) => c.level !== null && c.tally.spare <= 2,
  },
  {
    id: 'clean',
    name: 'Read the Room',
    text: 'Clear a level playing every single card you drew.',
    test: (c) => c.level !== null && c.level.stockSize > 0 && c.tally.wasteLeft === 0,
  },
  {
    id: 'unaided',
    name: 'Unaided',
    text: 'Clear five levels in one run without a hint.',
    test: (c) => c.streak.cleanLevels >= 5,
  },
  {
    id: 'patient',
    name: 'Steady Hands',
    text: 'Clear five levels in one run without an undo.',
    test: (c) => c.streak.patientLevels >= 5,
  },
  {
    id: 'quick',
    name: 'Quickfire',
    text: 'Clear a timed level with a minute still on the clock.',
    test: (c) => (c.level?.timeLimit ?? 0) > 0 && c.tally.secondsLeft >= 60,
  },
  {
    id: 'cascade',
    name: 'Chain Reaction',
    text: 'Turn four cards with a single move.',
    test: (c) => c.tally.maxFlips >= 4,
  },
  { id: 'thin', name: 'Scalpel', text: 'Cut your deck to eighteen cards.', test: (c) => deck(c).length > 0 && deck(c).length <= 18 },
  { id: 'fat', name: 'Hoarder', text: 'Grow your deck to forty cards.', test: (c) => deck(c).length >= 40 },
  {
    id: 'adorned',
    name: 'Well Appointed',
    text: 'Hold eight enchanted cards at once.',
    test: (c) => deck(c).filter((x) => x.ench).length >= 8,
  },
  {
    id: 'burdened',
    name: 'Bearing It',
    text: 'Clear a level carrying three cursed cards.',
    test: (c) => c.level !== null && deck(c).filter((x) => x.curse).length >= 3,
  },
  { id: 'collector', name: 'Collector', text: 'Hold five charms at once.', test: (c) => (c.run?.charms.length ?? 0) >= 5 },
  {
    id: 'excavator',
    name: 'Excavator',
    text: 'Turn a thousand cards, all runs counted.',
    test: (c) => c.totals.cardsTurned >= 1000,
  },
  {
    id: 'ritual',
    name: 'Daily Ritual',
    text: 'Clear three levels of a daily deal.',
    test: (c) => c.run?.daily === true && c.run.depth >= 3,
  },
  { id: 'persistent', name: 'Persistent', text: 'Begin ten runs.', test: (c) => c.totals.runs >= 10 },
];

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;

/** Ids newly satisfied by this context, ignoring any already unlocked. */
export function newlyEarned(c: AchieveCtx, unlocked: Record<string, number>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !unlocked[a.id] && a.test(c));
}

export function byId(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
