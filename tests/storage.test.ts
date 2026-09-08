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
import { newRun, type RunState } from '../src/game/run.ts';

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
