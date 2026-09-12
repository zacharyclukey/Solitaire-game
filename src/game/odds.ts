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
 * line a player can find does not become winnable by handing over more moves.
 *
 * How often that is the board depends on the stage, which this file does not
 * know — see the note on FINDABLE. Measured 2026-09-12 at a budget large enough
 * never to bind, it is 1 board in 8 at stage 1 and 6, but 3 in 8 at stage 12 and
 * more than half at stage 18. This comment used to say "roughly one board in
 * seven", full stop; that is the shallow end only.
 */

/**
 * The ceiling. However many moves are handed over, about a fifth of boards are
 * lost anyway — pooled across stages; see the per-stage breakdown below, which
 * is the number that matters — and no allowance recovers them — the allowance is measured to be
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
 *
 * AND IT IS NOT ONE NUMBER. Re-measured 2026-09-12 (`scripts/odds.ts curve 20`,
 * two independent seeds, 40 boards per stage per point), the share of boards
 * cleared at a budget so large it never binds is **88% at stage 1, 88% at
 * stage 6, 62% at stage 12 and 45% at stage 18**. 0.78 is the average over
 * that mix, not a property of a board, and it flatters depth badly.
 *
 * This constant has no consumer outside its own test. It is the `P(findable)`
 * term of the decomposition at the top of this file, which was never wired up
 * — `winChance` returns `coverAt` alone. Wiring it up means making it take the
 * stage, and the measurement above is what it should return. See task #45.
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
 * IT DID NOT SURVIVE THE DIFFICULTY PASS. Re-measured 2026-09-12 on 160 boards
 * a point (two independent seeds, stages 1/6/12/18 as before), the bottom half
 * holds and the top half does not:
 *
 *     multiple   here   measured   delta
 *        0.9-1.2  as below  within 1.5pt   -- holds
 *        1.4       0.68      0.556        -12.4  (3.4 sd)
 *        1.6       0.71      0.619         -9.1  (2.5 sd)
 *        2.0       0.78      0.656        -12.4  (3.8 sd)
 *        2.6       0.78      0.706         -7.4  (2.3 sd)
 *
 * The numbers below are DELIBERATELY LEFT AS THEY WERE, because the error is
 * not a vertical drift and re-fitting them would trade one wrong answer for
 * another. Broken out by stage, the plateau is 88/88/62/45 for stages
 * 1/6/12/18 — the pooled top half fell because the deep stages fell, and this
 * function is blind to the stage. Normalised by each stage's own plateau the
 * shape is near stage-invariant (spread 0.14 or less from 1.6x up), so the
 * shape here is right and the ceiling is what is wrong.
 *
 * Checked against `scripts/odds.ts validate 25`, which plays at a real bank:
 * the current numbers predict 78% at stage 1 with a 30-move bank against an
 * actual 84%, and 67% at stage 12 against an actual 60%. Lowering the plateau
 * to the pooled 0.71 would fix the second and break the first. The fix is a
 * stage-aware ceiling, not a re-fit. See task #45.
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
