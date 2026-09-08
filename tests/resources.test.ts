import { describe, expect, it } from 'vitest';
import { resolveUndo } from '../src/game/resources.ts';

const undo = (o: Partial<Parameters<typeof resolveUndo>[0]> = {}) =>
  resolveUndo({
    restoredMovesLeft: 40,
    offBookAtSnapshot: 0,
    offBookBefore: 0,
    freeUndos: 0,
    undoCost: 1,
    ...o,
  });

describe('undoing', () => {
  it('charges the undo against the allowance it restores', () => {
    // Restoring alone would hand back the move being spent, making undo free.
    expect(undo({ restoredMovesLeft: 40, undoCost: 1 }).movesLeft).toBe(39);
    expect(undo({ restoredMovesLeft: 40, undoCost: 2 }).movesLeft).toBe(38);
  });

  it('spends free undos first, and those cost nothing', () => {
    const free = undo({ freeUndos: 2 });
    expect(free.charged).toBe(0);
    expect(free.movesLeft).toBe(40);
    expect(free.freeUndos).toBe(1);
  });

  it('starts charging once the free ones are gone', () => {
    const last = undo({ freeUndos: 1 });
    expect(last.charged).toBe(0);
    expect(last.freeUndos).toBe(0);
    const next = undo({ freeUndos: last.freeUndos });
    expect(next.charged).toBe(1);
    expect(next.movesLeft).toBe(39);
  });

  it('never runs the free count below zero', () => {
    expect(undo({ freeUndos: 0 }).freeUndos).toBe(0);
  });

  it('does not refund what was spent off the books since the snapshot', () => {
    // A hint taken after the snapshot stays paid for: undo rewinds the board,
    // not the purchase.
    const r = undo({ restoredMovesLeft: 40, offBookAtSnapshot: 0, offBookBefore: 3 });
    expect(r.movesLeft).toBe(36); // 40 - 3 spent - 1 for this undo
  });

  it('charges every undo in a row, so repeating one is never free', () => {
    let offBook = 0;
    let moves = 40;
    for (let i = 0; i < 4; i++) {
      const r = resolveUndo({
        restoredMovesLeft: 40,
        offBookAtSnapshot: 0,
        offBookBefore: offBook,
        freeUndos: 0,
        undoCost: 1,
      });
      offBook += r.charged;
      moves = r.movesLeft;
    }
    expect(offBook).toBe(4);
    expect(moves).toBe(36);
  });
});
