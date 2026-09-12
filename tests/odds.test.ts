import { describe, expect, it } from 'vitest';
import { affordableAt, ceilingFor, spendAt, winChance } from '../src/game/odds.ts';

describe('the spend curve', () => {
  it('never promises a board that par alone would clear', () => {
    // Spending exactly the solver's line is something almost no fallible player
    // manages. Measured 2026-09-12 at 1.0x plainPar: 7 of 160 boards, and 4.4%
    // of them in absolute terms at the shallow ceiling.
    expect(winChance(40, 40, 1)).toBeLessThan(0.08);
    expect(spendAt(0.8)).toBe(0);
  });

  it('rises steeply where the distribution actually sits', () => {
    expect(spendAt(1.2)).toBeGreaterThan(spendAt(1.1));
    expect(spendAt(1.4) - spendAt(1.0)).toBeGreaterThan(0.6);
  });

  it('reaches the whole ceiling only at a budget that never binds', () => {
    // The curve is normalised to each stage's own plateau, so its top is 1 by
    // construction — but it must not get there early, or the estimate cannot
    // tell a generous board from an absurd one. That blindness above 2.0x is
    // what the old stage-blind curve had, and it is why nothing could be
    // rejected for being too easy at the shallow stages.
    expect(spendAt(2.6)).toBe(1);
    expect(spendAt(2.0)).toBeLessThan(1);
    expect(spendAt(1.6)).toBeLessThan(spendAt(2.0));
  });
});

describe('the findability ceiling', () => {
  it('falls with depth, which the estimate used to be blind to', () => {
    expect(ceilingFor(1)).toBeCloseTo(0.88);
    expect(ceilingFor(6)).toBeCloseTo(0.88);
    expect(ceilingFor(12)).toBeCloseTo(0.62);
    expect(ceilingFor(18)).toBeCloseTo(0.45);
  });

  it('is monotone non-increasing and never reaches zero', () => {
    // A floor here would be a ceiling on difficulty; a zero would make deep
    // boards formally hopeless. Neither is wanted, so the tail decays.
    let prev = Infinity;
    for (let stage = 1; stage <= 60; stage++) {
      const c = ceilingFor(stage);
      expect(c).toBeLessThanOrEqual(prev + 1e-9);
      expect(c).toBeGreaterThan(0);
      prev = c;
    }
    expect(ceilingFor(60)).toBeLessThan(ceilingFor(18));
  });
});

describe('the win-chance estimate', () => {
  it('is capped by the boards no budget can rescue, at this depth', () => {
    // Even infinite moves leave the structurally lost ones lost, and how many
    // that is depends on the stage. A stage-blind cap was the bug.
    for (const stage of [1, 6, 12, 18, 30]) {
      expect(winChance(100000, 40, stage)).toBeCloseTo(ceilingFor(stage));
    }
    expect(winChance(100000, 40, 18)).toBeLessThan(winChance(100000, 40, 1) - 0.3);
  });

  it('treats an unsolved board as very unlikely rather than unknown', () => {
    expect(winChance(100000, 40, 1, false)).toBeLessThan(0.05);
  });

  it('is monotone in the budget', () => {
    let prev = -1;
    for (let b = 20; b <= 120; b += 5) {
      const p = winChance(b, 40, 6);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('the affordability floor', () => {
  it('rejects a board the money cannot pay for, at the ratio it always did', () => {
    // This crossed over at 1.005x par when it was written as a probability
    // threshold against the old curve. Pinning it here is the point: a floor
    // expressed in probability moves whenever the curve is re-fitted, and it
    // silently loosened to 0.937x during the 2026-09-12 restructure before this
    // test existed.
    expect(affordableAt(100, 100)).toBe(false);
    expect(affordableAt(100.4, 100)).toBe(false);
    expect(affordableAt(101, 100)).toBe(true);
    expect(affordableAt(200, 100)).toBe(true);
  });

  it('does not gate on findability, which no purse can fix', () => {
    // A deep board is honestly unlikely and is still dealt. Gating the floor on
    // winChance would end runs with a bankruptcy screen for being deep.
    expect(winChance(200, 100, 30)).toBeLessThan(0.4);
    expect(affordableAt(200, 100)).toBe(true);
  });

  it('treats a board with no measurable par as affordable', () => {
    expect(affordableAt(40, 0)).toBe(true);
  });
});
