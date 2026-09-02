import { describe, expect, it } from 'vitest';
import {
  buildTutorialLevel,
  COACH_STEPS,
  emptyTally,
  stepFor,
  TUTORIAL_BUDGET,
} from '../src/game/tutorial.ts';
import { applyMove, isWon, legalMoves, stock } from '../src/game/sim.ts';
import { findSolution } from '../src/game/solver.ts';
import { RANK_LABEL, SUIT_GLYPH } from '../src/game/types.ts';

const label = (sim: ReturnType<typeof buildTutorialLevel>['sim'], id: number): string =>
  `${RANK_LABEL[sim.defs[id].rank]}${SUIT_GLYPH[sim.defs[id].suit]}`;

describe('the guided first level', () => {
  it('is winnable well inside its allowance', () => {
    const level = buildTutorialLevel();
    const solution = findSolution(level.sim, 900);
    expect(solution).not.toBeNull();
    expect(solution!.cost).toBeLessThanOrEqual(TUTORIAL_BUDGET);
    for (const mv of solution!.moves) applyMove(level.sim, mv, null);
    expect(isWon(level.sim)).toBe(true);
  });

  it('opens on the stacking move the first lesson asks for, and only that one', () => {
    const { sim } = buildTutorialLevel();
    const stacking = legalMoves(sim).filter((m) => m.kind === 'm' && sim.cols[m.to].length > 0);
    expect(stacking).toHaveLength(1);
    const mv = stacking[0];
    expect(label(sim, sim.cols[mv.from][mv.fromIdx])).toBe('6♠');
    expect(label(sim, sim.cols[mv.to][sim.cols[mv.to].length - 1])).toBe('7♥');
  });

  it('turns a card the moment that first lesson is followed', () => {
    const { sim } = buildTutorialLevel();
    const before = sim.hidden;
    const mv = legalMoves(sim).find((m) => m.kind === 'm' && sim.cols[m.to].length > 0)!;
    applyMove(sim, mv, null);
    expect(sim.hidden).toBe(before - 1);
  });

  it('locks the tableau solid after it, so the draw lesson is forced', () => {
    const { sim } = buildTutorialLevel();
    applyMove(sim, legalMoves(sim).find((m) => m.kind === 'm' && sim.cols[m.to].length > 0)!, null);
    const moves = legalMoves(sim);
    expect(moves.every((m) => m.kind === 'd')).toBe(true);
    expect(stock(sim).length).toBeGreaterThan(0);
  });

  it('walks the lessons forward as the tally grows', () => {
    const { sim } = buildTutorialLevel();
    const tally = emptyTally();
    expect(stepFor(sim, tally)).toBe(0);
    tally.stacked = 1;
    expect(stepFor(sim, tally)).toBe(1);
    tally.drew = 1;
    expect(stepFor(sim, tally)).toBe(2);
    tally.emptied = 1;
    expect(stepFor(sim, tally)).toBe(3);
    tally.grouped = 1;
    expect(stepFor(sim, tally)).toBe(4);
    expect(COACH_STEPS[4].done(sim, tally)).toBe(false);
  });

  it('never runs the player out of moves', () => {
    const level = buildTutorialLevel();
    expect(level.budget).toBeGreaterThan(level.par);
    expect(level.undosLeft).toBeGreaterThan(10);
  });
});
