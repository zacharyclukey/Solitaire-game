import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  emptyStreak,
  emptyTally,
  newlyEarned,
  type AchieveCtx,
} from '../src/game/achievements.ts';
import { readFileSync } from 'node:fs';
import { addCard, addCharm, MAX_DECK, MIN_DECK, newRun, type RunState } from '../src/game/run.ts';
import { buildTutorialLevel } from '../src/game/tutorial.ts';
import { CHARMS, MODIFIERS, type CharmId } from '../src/game/content.ts';
import { Rng } from '../src/game/rng.ts';
import { dealLevel } from '../src/game/deal.ts';
import { starterDeck } from '../src/game/run.ts';
import type { Suit } from '../src/game/types.ts';

const CHARM_IDS = Object.keys(CHARMS) as CharmId[];

/**
 * What Time Crunch actually puts on the clock, read off a real deal.
 *
 * Written as a literal 120 first, which re-encodes the assumption this whole
 * sweep exists to catch: drop the limit to 30 in deal.ts and a hardcoded test
 * still passes while 'quick' — which needs 60 seconds left — becomes
 * unreachable. Ask the generator instead.
 */
const RUSH_SECONDS = dealLevel({
  deck: starterDeck(),
  charms: [],
  spec: { stage: 6, kind: 'trial', modifiers: ['rush'], seed: 0x9a11 },
  bonusMoves: 0,
  bonusCells: 0,
  bank: 400,
}).timeLimit;
void MODIFIERS;

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

/**
 * Completeness, rather than one test per achievement.
 *
 * Three consecutive reviews asked for this, and the case that prompted it is
 * recorded on the `fat` entry: it asked for a forty-card deck long after the
 * deck was capped at thirty-two, so it was unwinnable by construction and
 * nothing noticed. The individual tests above cover the achievements that
 * existed when they were written; what was missing is the guarantee that a NEW
 * achievement cannot be added dead.
 *
 * Every context here is built from the game's own constants and objects — real
 * decks grown by `addCard`, `MAX_DECK`, the real charm list — so a bound the
 * game cannot actually reach fails rather than being satisfied by a number
 * invented for the test.
 */
describe('every achievement is reachable', () => {
  /**
   * The one predicate that is meant never to fire. It is granted directly when
   * the guided board is finished, so the exemption is real — but it is checked
   * rather than trusted, because an exemption list is exactly where a dead
   * achievement would hide.
   */
  const AWARDED_DIRECTLY = ['taught'];

  it('grants the directly-awarded ones somewhere in the game code', () => {
    const src = readFileSync('src/app.ts', 'utf8') + readFileSync('src/game/tutorial.ts', 'utf8');
    for (const id of AWARDED_DIRECTLY) {
      expect(src.includes(`'${id}'`), `${id} is exempt from the predicate test but nothing awards it`).toBe(true);
    }
  });

  /** A deck grown the way the game grows it, to `n` cards. */
  function grown(n: number): RunState {
    const r = newRun(4242);
    const rng = new Rng(99);
    while (r.deck.length < n) addCard(r, { uid: r.nextUid++, rank: 8, suit: (r.deck.length % 4) as Suit, ench: null, curse: null });
    void rng;
    return r;
  }

  /** A context that should satisfy `id`, or null if this test cannot build one. */
  function satisfying(id: string): AchieveCtx | null {
    const level = buildTutorialLevel();
    switch (id) {
      case 'depth3': return ctx({ run: run({ depth: 3 }) });
      case 'depth5': return ctx({ run: run({ depth: 5 }) });
      case 'depth10': return ctx({ run: run({ depth: 10 }) });
      case 'depth15': return ctx({ run: run({ depth: 15 }) });
      case 'depth20': return ctx({ run: run({ depth: 20 }) });
      case 'tight': return ctx({ level, tally: { ...emptyTally(), spare: 2 } });
      case 'clean': return ctx({ level: { ...level, stockSize: 4 }, tally: { ...emptyTally(), wasteLeft: 0 } });
      case 'underpar': return ctx({ level, tally: { ...emptyTally(), underPar: 1 } });
      case 'unaided': return ctx({ streak: { ...emptyStreak(), cleanLevels: 5 } });
      case 'patient': return ctx({ streak: { ...emptyStreak(), patientLevels: 5 } });
      case 'quick': return ctx({ level: { ...level, timeLimit: RUSH_SECONDS }, tally: { ...emptyTally(), secondsLeft: 60 } });
      case 'cascade': return ctx({ tally: { ...emptyTally(), maxFlips: 4 } });
      case 'thin': {
        const r = newRun(1);
        r.deck = r.deck.slice(0, MIN_DECK);
        return ctx({ run: r });
      }
      case 'fat': return ctx({ run: grown(MAX_DECK) });
      case 'adorned': {
        const r = newRun(2);
        r.deck.slice(0, 8).forEach((c) => { c.ench = 'torch'; });
        return ctx({ run: r });
      }
      case 'burdened': {
        const r = newRun(3);
        r.deck.slice(0, 3).forEach((c) => { c.curse = 'heavy'; });
        return ctx({ level, run: r });
      }
      case 'collector': {
        const r = newRun(5);
        for (const c of CHARM_IDS.slice(0, 5)) addCharm(r, c);
        return ctx({ run: r });
      }
      case 'excavator': return ctx({ totals: { cardsTurned: 1000, runs: 0 } });
      case 'ritual': return ctx({ run: run({ daily: true, depth: 3 }) });
      case 'persistent': return ctx({ totals: { cardsTurned: 0, runs: 10 } });
      default: return null;
    }
  }

  it('can be satisfied by a context the game could actually produce', () => {
    const unreachable: string[] = [];
    const unmodelled: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (AWARDED_DIRECTLY.includes(a.id)) continue;
      const c = satisfying(a.id);
      // A new achievement with no case here fails loudly rather than silently
      // passing, which is the whole point of the sweep.
      if (!c) { unmodelled.push(a.id); continue; }
      if (!newlyEarned(c, {}).some((x) => x.id === a.id)) unreachable.push(a.id);
    }
    expect(unmodelled, `no reachability case is written for: ${unmodelled.join(', ')}`).toEqual([]);
    expect(unreachable, `these cannot be earned by any context the game produces: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('asks only for things the game can supply', () => {
    // The bounds, checked against the constants that move. `fat` asking for 40
    // cards after the cap dropped to 32 is the bug this class is named for.
    expect(MAX_DECK).toBeGreaterThanOrEqual(newRun(0).deck.length);
    expect(MIN_DECK).toBeLessThanOrEqual(18); // 'thin' asks for 18 or fewer
    expect(CHARM_IDS.length).toBeGreaterThanOrEqual(5); // 'collector' asks for 5
    expect(MAX_DECK).toBeGreaterThanOrEqual(8); // 'adorned' asks for 8 enchanted
    expect(RUSH_SECONDS).toBeGreaterThanOrEqual(60); // 'quick' asks for 60 left
  });
});
