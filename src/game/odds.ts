/**
 * How likely is a board to be won?
 *
 * Deals are not certified against the player's deck any more, so the generator
 * needs to know what it is handing out. Simulating fallible play per deal costs
 * seconds; this costs arithmetic, because the two things that decide a loss
 * were measured once and separately (`scripts/odds.ts`, 96 boards across stages
 * 1 to 20, bounded-lookahead player, unlimited bank so the budget is never the
 * constraint):
 *
 *   P(win) = P(a line is findable at all) x P(spend fits the budget | findable)
 *
 * Splitting them matters because moves only fix the second. A board with no
 * line a player can find does not become winnable by handing over more moves,
 * and roughly one board in seven is that board.
 */

/**
 * The ceiling. However many moves are handed over, about a fifth of boards are
 * lost anyway, and no allowance recovers them — the allowance is measured to be
 * self-neutralising, because a richer purse buys a harder board at the same win
 * chance rather than an easier level.
 *
 * WHY they are lost is less settled than this comment used to claim. It said
 * the solver finds a line on "only about one in six of them even when driven at
 * 1,000,000 nodes, some 45x its shipping cap". That measurement was not what it
 * said: `deadboards.ts` passed a MILLISECOND budget under a parameter named
 * `nodes`, so the search depended on machine load and nothing was ever driven
 * at 1,000,000 nodes. Re-measured 2026-09-11 with a real node bound and the
 * control clean at 24/24, the solver finds a line on **10 of 24** boards the
 * bot lost — 42%, not one in six.
 *
 * So a large minority of these are missed lines rather than dead shuffles. That
 * does NOT make them humanly winnable: a 1,000,000-node weighted A* is not a
 * person, and neither deeper nor wider bot lookahead recovers any of them. What
 * it means is that the gap between "no line exists" and "no line a player will
 * find" is much wider than was recorded, which makes legibility and the escapes
 * a live lever where this comment used to say none existed.
 * (`scripts/deadboards.ts`, and docs/ECONOMY.md for the full table.)
 */
export const FINDABLE = 0.78;

/**
 * Win rate against budget, as a multiple of plainPar. Measured directly at the
 * budgets it describes (`scripts/odds.ts curve`): certify a board, re-budget it
 * to exactly the multiple under test, and play it. 80 boards per point, pooled
 * from two independent sweeps across stages 1, 6, 12 and 18.
 *
 * The second sweep was run after deals became honest shuffles and after the
 * deck cap, to check the numbers had not been left behind by the generator
 * underneath them. They had not: every point moved by 5 points or less, inside
 * the noise at 40 samples. It transfers where earlier attempts did not because
 * it re-budgets boards that already exist rather than inferring a budget from a
 * spend distribution, which made it independent of how those boards were
 * chosen.
 *
 * An earlier version derived this from a spend distribution gathered at an
 * unlimited bank and it was wrong in both directions — 72% predicted against
 * 88% real at stage 1, and 17% against 0% at stage 12. A player with infinite
 * moves does not economise, so that distribution sat too far right. A win rate
 * has to be measured under the pressure it is meant to describe.
 *
 * Note how narrow the useful range is: everything between certain loss and the
 * ceiling happens between 1.0x and 1.4x. That makes the allowance a very sharp
 * dial, and it means the bands have to come off measurements rather than
 * intuition.
 */
const WIN_CURVE: readonly (readonly [number, number])[] = [
  [0.9, 0.0], [1.0, 0.01], [1.1, 0.21], [1.2, 0.36],
  [1.4, 0.68], [1.6, 0.71], [2.0, 0.78], [2.6, 0.78],
];

/** Interpolated win rate at a given multiple of plainPar. */
export function coverAt(multiple: number): number {
  if (multiple <= WIN_CURVE[0][0]) return 0;
  const last = WIN_CURVE[WIN_CURVE.length - 1];
  if (multiple >= last[0]) return last[1];
  for (let i = 1; i < WIN_CURVE.length; i++) {
    const [x1, y1] = WIN_CURVE[i];
    if (multiple <= x1) {
      const [x0, y0] = WIN_CURVE[i - 1];
      return y0 + ((y1 - y0) * (multiple - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

export function winChance(budget: number, plainPar: number, solved = true): number {
  if (!solved) return 0.02;
  if (plainPar <= 0) return 1;
  return coverAt(budget / plainPar);
}
