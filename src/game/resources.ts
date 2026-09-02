/**
 * Level resources that are *spent* rather than rewound.
 *
 * Undo restores the board to a previous position, and the board's move
 * allowance goes back with it — that is the point of undo. But not everything
 * should travel backwards with it. Undos themselves are consumed. So are
 * peeks. So are moves spent on things that never entered the move history:
 * hints, and the undo surcharge under Glasswork.
 *
 * Rewinding those turned each of them free — take a hint, undo, and the board
 * hands the move back. This is the arithmetic that stops it, kept separate
 * from the controller so it can be tested on its own.
 */

export interface UndoInput {
  /** `movesLeft` recorded in the snapshot being restored. */
  restoredMovesLeft: number;
  /** Off-the-books spend at the moment that snapshot was taken. */
  offBookAtSnapshot: number;
  /** Off-the-books spend now, INCLUDING this undo's own surcharge. */
  offBookNow: number;
  /** Undos remaining before this one is taken. */
  undosLeft: number;
}

export interface UndoOutcome {
  movesLeft: number;
  undosLeft: number;
}

/**
 * What the level's resources become after an undo.
 *
 * The allowance returns to its snapshot value minus everything spent off the
 * books since — so the move the undo reverses is refunded, and the hint that
 * was taken in between is not.
 */
export function resolveUndo(input: UndoInput): UndoOutcome {
  const spentSince = Math.max(0, input.offBookNow - input.offBookAtSnapshot);
  return {
    movesLeft: input.restoredMovesLeft - spentSince,
    undosLeft: Math.max(0, input.undosLeft - 1),
  };
}
