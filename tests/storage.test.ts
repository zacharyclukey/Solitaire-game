/**
 * A save written by an older build must still load.
 *
 * `stats` and `settings` have always been merged against defaults, but the RUN
 * was taken verbatim — `run: parsed.run ?? null` — with two fields patched
 * afterwards by hand. RunState has twenty-three. Every field added since a save
 * was written therefore arrived as `undefined`, and the ones that are counters
 * turn into NaN the first time they are added to.
 *
 * This drops each field in turn rather than guessing which builds shipped when,
 * so a field added in future is covered without anyone remembering to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newRun, starterDeck, type RunState } from '../src/game/run.ts';
import { dealLevel, type LevelSpec } from '../src/game/deal.ts';
import { simKey } from '../src/game/sim.ts';

/** The test environment is node; storage.ts wants the browser's localStorage. */
function stubStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const KEY = 'facedown.save.v1';

/** Load storage.ts fresh, so its module-level cache does not leak between cases. */
async function freshStorage(): Promise<typeof import('../src/storage.ts')> {
  vi.resetModules();
  return await import('../src/storage.ts');
}

describe('loading a save written by an older build', () => {
  beforeEach(() => stubStorage());

  it('fills in every run field a past version could not have written', async () => {
    const complete = newRun(12345);
    const fields = Object.keys(complete) as (keyof RunState)[];
    const missing: string[] = [];

    for (const field of fields) {
      const old: Record<string, unknown> = { ...complete };
      delete old[field];
      localStorage.setItem(KEY, JSON.stringify({ version: 1, run: old }));
      const store = await freshStorage();
      const loaded = store.getRun() as Record<string, unknown> | null;
      if (loaded && loaded[field] === undefined) missing.push(field);
    }

    expect(missing, `these fields load as undefined from an older save: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the values a save actually carries', async () => {
    const run = newRun(999);
    run.depth = 7;
    run.gold = 123;
    run.bank = 45;
    localStorage.setItem(KEY, JSON.stringify({ version: 1, run }));
    const loaded = (await freshStorage()).getRun();
    expect(loaded?.depth).toBe(7);
    expect(loaded?.gold).toBe(123);
    expect(loaded?.bank).toBe(45);
    expect(loaded?.seed).toBe(999);
  });

  it('survives a corrupted save rather than trapping the player', async () => {
    localStorage.setItem(KEY, '{not json');
    const store = await freshStorage();
    expect(store.getRun()).toBeNull();
  });
});

/**
 * A resumed level re-deals from the saved spec and replays the saved moves into
 * the result. That is only sound while the same spec deals the same board — and
 * it does not. `dealLevel` picks its layout by win chance against the
 * allowance, so the allowance is part of the board's identity, and every
 * balance pass moves the allowance. `applyMove` checks nothing, so the old
 * moves were applied to the new layout regardless.
 */
describe('resuming a level saved by an older build', () => {
  beforeEach(() => stubStorage());

  const spec: LevelSpec = { stage: 6, kind: 'trial', modifiers: ['narrow'], seed: 0x1234 };
  const deal = (bonusMoves: number) =>
    dealLevel({ deck: starterDeck(), charms: [], spec, bonusMoves, bonusCells: 0, bank: 0 });

  const deepSpec: LevelSpec = { stage: 10, kind: 'trial', modifiers: ['narrow'], seed: 0x1234 };
  const deep = (bonusMoves: number) =>
    dealLevel({ deck: starterDeck(), charms: [], spec: deepSpec, bonusMoves, bonusCells: 0, bank: 0 });

  it('deals a different board for the same spec once the allowance moves', () => {
    // The whole reason the fingerprint has to exist: the spec does not
    // determine the board, because the layout is chosen against the allowance.
    // If this ever stops being true the guard becomes redundant rather than
    // wrong.
    //
    // Stage 10, not stage 6, and the difference is the point. The band is a
    // fixed width on the spend curve, so how much allowance it takes to leave it
    // depends on how steep the curve is at the stage's target. Stage 10 aims at
    // 1.10x, on the steep part, and six moves are enough. This test used to use
    // stage 6 and a five-move bump; that stopped moving the board when the curve
    // was re-fitted on 2026-09-12, because stage 6 aims at 1.40x where the curve
    // is flattening out.
    expect(simKey(deep(0).sim)).not.toBe(simKey(deep(6).sim));
  });

  it('can leave the board alone when the allowance moves inside the band', () => {
    // The flip side, pinned because it is easy to mistake for the guard being
    // unnecessary. At stage 6 twenty extra moves — 1.31x plainPar up to 1.79x —
    // buy the same board, because the band's upper reach is wide where the spend
    // curve flattens. The fingerprint is still required: which of these two
    // cases a given spec falls into is not something a save can know.
    expect(simKey(deal(0).sim)).toBe(simKey(deal(20).sim));
  });

  it('gives a save written before the field a fingerprint that cannot match', async () => {
    const run = newRun(999);
    run.depth = 3;
    const old: Record<string, unknown> = { ...run };
    delete old.levelKey;
    localStorage.setItem(KEY, JSON.stringify({ version: 1, run: old }));
    const loaded = (await freshStorage()).getRun();
    // null rather than undefined, and null is never equal to a dealt board's
    // key, so every pre-existing mid-level save replays nothing.
    expect(loaded?.levelKey).toBeNull();
    expect(loaded?.levelKey === simKey(deal(0).sim)).toBe(false);
  });

  it('carries a fingerprint the save does have through a round trip', async () => {
    const run = newRun(999);
    run.levelKey = simKey(deal(0).sim);
    localStorage.setItem(KEY, JSON.stringify({ version: 1, run }));
    const loaded = (await freshStorage()).getRun();
    expect(loaded?.levelKey).toBe(run.levelKey);
  });
});
