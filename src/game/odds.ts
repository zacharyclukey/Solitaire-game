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
 * Share of boards where this player finds a win at all, given unlimited moves.
 * The rest are lost to structure — a tableau played into a corner, or a line
 * too narrow for bounded lookahead to see.
 */
export const FINDABLE = 0.854;

/**
 * Cumulative share of findable boards cleared within a given multiple of
 * plainPar. Measured, not modelled: the steep stretch between 1.0 and 1.4 is
 * where nearly half the distribution sits, which is why small changes to the
 * allowance move the win rate so sharply there.
 */
const SPEND_CDF: readonly (readonly [number, number])[] = [
  [0.9, 0.0], [1.0, 0.024], [1.1, 0.256], [1.2, 0.463], [1.3, 0.671],
  [1.4, 0.768], [1.5, 0.793], [1.6, 0.841], [1.8, 0.841], [2.0, 0.866],
  [2.2, 0.902], [2.4, 0.927], [2.6, 0.951], [3.0, 0.951],
];

/** Share of findable boards clearable within `multiple` x plainPar. */
export function spendCoverage(multiple: number): number {
  if (multiple <= SPEND_CDF[0][0]) return 0;
  const last = SPEND_CDF[SPEND_CDF.length - 1];
  if (multiple >= last[0]) return last[1];
  for (let i = 1; i < SPEND_CDF.length; i++) {
    const [x1, y1] = SPEND_CDF[i];
    if (multiple <= x1) {
      const [x0, y0] = SPEND_CDF[i - 1];
      return y0 + ((y1 - y0) * (multiple - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/**
 * Estimated chance a fallible player clears this board with this many moves.
 *
 * `solved` is whether the solver found a line at all. When it did not, the
 * board is treated as one of the unfindable ones rather than being given the
 * benefit of the doubt — the whole point of the estimate is to stop pretending
 * a board is winnable because nobody checked.
 */
export function winChance(budget: number, plainPar: number, solved = true): number {
  if (!solved) return 0.02;
  if (plainPar <= 0) return 1;
  return FINDABLE * spendCoverage(budget / plainPar);
}
