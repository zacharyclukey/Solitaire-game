import { describe, expect, it } from 'vitest';
import { resolveUndo } from '../src/game/resources.ts';

const undo = (o: Partial<Parameters<typeof resolveUndo>[0]> = {}) =>
  resolveUndo({ restoredMovesLeft: 40, offBookAtSnapshot: 0, offBookNow: 0, undosLeft: 3, ...o });

describe('undo does not refund what was spent off the books', () => {
  it('gives back the move it reverses', () => {
    expect(undo().movesLeft).toBe(40);
  });

  it('always consumes an undo', () => {
    expect(undo({ undosLeft: 3 }).undosLeft).toBe(2);
  });

  it('consumes one on every successive undo, not just the first', () => {
    // The bug this pins: snapshots taken before any undo all carry the same
    // count, so deriving the new total from the snapshot let a player undo
    // for ever with the counter stuck one below where it started.
    let left = 3;
    for (const expected of [2, 1, 0]) {
      left = resolveUndo({ restoredMovesLeft: 40, offBookAtSnapshot: 0, offBookNow: 0, undosLeft: left }).undosLeft;
      expect(left).toBe(expected);
    }
  });

  it('never goes below zero', () => {
    expect(undo({ undosLeft: 0 }).undosLeft).toBe(0);
  });

  it('keeps a hint charged when the move after it is undone', () => {
    // Move taken at 40 (snapshot), a hint spent one move, then undo.
    // The move comes back; the hint does not.
    expect(undo({ restoredMovesLeft: 40, offBookAtSnapshot: 0, offBookNow: 1 }).movesLeft).toBe(39);
  });

  it('keeps several hints charged across one undo', () => {
    expect(undo({ restoredMovesLeft: 40, offBookAtSnapshot: 1, offBookNow: 4 }).movesLeft).toBe(37);
  });

  it('charges the Glasswork surcharge for the undo itself', () => {
    // The caller adds this undo's own cost to offBookNow before asking.
    expect(undo({ restoredMovesLeft: 39, offBookAtSnapshot: 0, offBookNow: 1 }).movesLeft).toBe(38);
  });

  it('charges every Glasswork undo, not only the most recent', () => {
    // Two moves played from 40, then undone twice under Glasswork: both moves
    // are refunded and both undos are charged.
    const first = resolveUndo({ restoredMovesLeft: 39, offBookAtSnapshot: 0, offBookNow: 1, undosLeft: 3 });
    expect(first.movesLeft).toBe(38);
    const second = resolveUndo({ restoredMovesLeft: 40, offBookAtSnapshot: 0, offBookNow: 2, undosLeft: first.undosLeft });
    expect(second.movesLeft).toBe(38);
    expect(second.undosLeft).toBe(1);
  });

  it('ignores an off-book total that somehow went backwards', () => {
    expect(undo({ offBookAtSnapshot: 5, offBookNow: 2 }).movesLeft).toBe(40);
  });
});
