import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  emptyStreak,
  emptyTally,
  newlyEarned,
  type AchieveCtx,
} from '../src/game/achievements.ts';
import { addCharm, newRun, type RunState } from '../src/game/run.ts';
import { buildTutorialLevel } from '../src/game/tutorial.ts';

function ctx(over: Partial<AchieveCtx> = {}): AchieveCtx {
  return {
    totals: { cardsTurned: 0, runs: 0 },
    run: null,
    level: null,
    tally: emptyTally(),
    streak: emptyStreak(),
    ...over,
  };
}

const run = (patch: Partial<RunState> = {}): RunState => Object.assign(newRun(7), patch);

describe('achievements', () => {
  it('has unique ids and no empty copy', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.text.endsWith('.')).toBe(true);
    }
  });

  it('awards nothing on an empty context', () => {
    // 'taught' is granted directly by the tutorial, never by a predicate.
    expect(newlyEarned(ctx(), {})).toEqual([]);
  });

  it('awards depth milestones as a run goes deeper, and only once', () => {
    const c = ctx({ run: run({ depth: 5 }) });
    const ids = newlyEarned(c, {}).map((a) => a.id);
    expect(ids).toContain('depth3');
    expect(ids).toContain('depth5');
    expect(ids).not.toContain('depth10');
    const already = Object.fromEntries(ids.map((i) => [i, 1]));
    expect(newlyEarned(c, already)).toEqual([]);
  });

  it('rewards a level cleared on fumes', () => {
    const level = buildTutorialLevel();
    const tight = ctx({ level, tally: { ...emptyTally(), spare: 2, wasteLeft: 1 } });
    expect(newlyEarned(tight, {}).map((a) => a.id)).toContain('tight');
    const loose = ctx({ level, tally: { ...emptyTally(), spare: 9, wasteLeft: 1 } });
    expect(newlyEarned(loose, {}).map((a) => a.id)).not.toContain('tight');
  });

  it('rewards leaving nothing stranded on the waste, but only when a pile existed', () => {
    const level = buildTutorialLevel();
    expect(newlyEarned(ctx({ level }), {}).map((a) => a.id)).toContain('clean');
    const stranded = ctx({ level, tally: { ...emptyTally(), wasteLeft: 1 } });
    expect(newlyEarned(stranded, {}).map((a) => a.id)).not.toContain('clean');

    const noStock = { ...level, stockSize: 0 };
    expect(newlyEarned(ctx({ level: noStock }), {}).map((a) => a.id)).not.toContain('clean');
  });

  it('tracks hint-free and undo-free streaks', () => {
    const c = ctx({ streak: { cleanLevels: 5, patientLevels: 4 } });
    const ids = newlyEarned(c, {}).map((a) => a.id);
    expect(ids).toContain('unaided');
    expect(ids).not.toContain('patient');
  });

  it('rewards a cascade of four turned cards', () => {
    expect(newlyEarned(ctx({ tally: { ...emptyTally(), maxFlips: 4 } }), {}).map((a) => a.id)).toContain('cascade');
    expect(newlyEarned(ctx({ tally: { ...emptyTally(), maxFlips: 3 } }), {}).map((a) => a.id)).not.toContain('cascade');
  });

  it('reads deck shape, curses and charms off the run', () => {
    const thin = run();
    thin.deck = thin.deck.slice(0, 18);
    expect(newlyEarned(ctx({ run: thin }), {}).map((a) => a.id)).toContain('thin');

    const cursed = run();
    for (let i = 0; i < 3; i++) cursed.deck[i].curse = 'heavy';
    const withLevel = ctx({ run: cursed, level: buildTutorialLevel() });
    expect(newlyEarned(withLevel, {}).map((a) => a.id)).toContain('burdened');
    // ...but only on a cleared level, not merely for owning cursed cards.
    expect(newlyEarned(ctx({ run: cursed }), {}).map((a) => a.id)).not.toContain('burdened');

    const charmed = run();
    for (const id of ['sleeve', 'dice', 'crowbar', 'ring', 'scalpel'] as const) addCharm(charmed, id);
    expect(newlyEarned(ctx({ run: charmed }), {}).map((a) => a.id)).toContain('collector');
  });

  it('rewards a daily deal only when it is a daily deal', () => {
    const daily = run({ depth: 3, daily: true });
    expect(newlyEarned(ctx({ run: daily }), {}).map((a) => a.id)).toContain('ritual');
    expect(newlyEarned(ctx({ run: run({ depth: 3 }) }), {}).map((a) => a.id)).not.toContain('ritual');
  });

  it('rewards lifetime totals', () => {
    const c = ctx({ totals: { cardsTurned: 1000, runs: 10 } });
    const ids = newlyEarned(c, {}).map((a) => a.id);
    expect(ids).toContain('excavator');
    expect(ids).toContain('persistent');
  });
});
