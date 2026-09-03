import { describe, expect, it } from 'vitest';
import { FINDABLE, coverAt, winChance } from '../src/game/odds.ts';

describe('the win-chance estimate', () => {
  it('never promises a board that par alone would not clear', () => {
    // Spending exactly the solver's line is something almost no fallible player
    // manages: measured, 2.4% of them.
    expect(coverAt(1.0)).toBeLessThan(0.05);
    expect(coverAt(0.8)).toBe(0);
  });

  it('rises steeply where the distribution actually sits', () => {
    expect(coverAt(1.2)).toBeGreaterThan(coverAt(1.1));
    expect(coverAt(1.4) - coverAt(1.0)).toBeGreaterThan(0.6);
  });

  it('is capped by the boards no budget can rescue', () => {
    // Even infinite moves leave the structurally lost ones lost.
    expect(winChance(100000, 40)).toBeLessThanOrEqual(FINDABLE);
    expect(winChance(100000, 40)).toBeGreaterThan(0.7);
  });

  it('treats an unsolved board as very unlikely rather than unknown', () => {
    expect(winChance(100000, 40, false)).toBeLessThan(0.05);
  });

  it('is monotone in the budget', () => {
    let prev = -1;
    for (let b = 20; b <= 120; b += 5) {
      const p = winChance(b, 40);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});
