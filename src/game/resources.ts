/**
 * Level resources that are *spent* rather than rewound.
 *
 * Undo restores the board to a previous position, and the board's move
 * allowance goes back with it — that is the point of undo. But not everything
 * should travel backwards with it. Peeks are consumed. So are moves spent on
 * things that never entered the move history: hints, and the undo's own price.
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
  /** Off-the-books spend now, BEFORE this undo is charged for. */
  offBookBefore: number;
  /** Undos left that cost nothing, from charms. */
  freeUndos: number;
  /** Moves this undo costs when no free one is left. */
  undoCost: number;
}

export interface UndoOutcome {
  movesLeft: number;
  freeUndos: number;
  /** Moves this undo actually cost; 0 when a free one covered it. */
  charged: number;
}

/**
 * What the level's resources become after an undo.
 *
 * The allowance returns to its snapshot value minus everything spent off the
 * books since — so the move the undo reverses is refunded, and the hint that
 * was taken in between is not.
 *
 * Undos are unlimited and priced in moves rather than rationed by a counter.
 * The charge goes on the books here, which is what stops an undo from paying
 * for itself: restoring the snapshot would otherwise hand back the very move
 * being spent, and undo would be free however often it was used. Free undos
 * from charms are spent first.
 */
export function resolveUndo(input: UndoInput): UndoOutcome {
  const charged = input.freeUndos > 0 ? 0 : input.undoCost;
  const spentSince = Math.max(0, input.offBookBefore + charged - input.offBookAtSnapshot);
  return {
    movesLeft: input.restoredMovesLeft - spentSince,
    freeUndos: Math.max(0, input.freeUndos - 1),
    charged,
  };
}
