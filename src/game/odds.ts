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
 * How often that is the board depends on the STAGE — see `ceilingFor`. Measured
 * 2026-09-12 at a budget large enough never to bind, it is 1 board in 8 at
 * stages 1 and 6, but 3 in 8 at stage 12 and more than half at stage 18. This
 * comment used to say "roughly one board in seven", full stop; that is the
 * shallow end only, and the estimate was blind to the difference until the two
 * terms below were finally split apart.
 */

/**
 * The ceiling. However many moves are handed over, some boards are lost anyway
 * and no allowance recovers them — the allowance is measured to be
 * self-neutralising, because a richer purse buys a harder board at the same win
 * chance rather than an easier level.
 *
 * "About a fifth" was the figure carried here for a long time. It is a pooled
 * average over a stage mix, not a property of a board, so the per-stage numbers
 * in `CEILING` below are what to reason with.
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
 * stage 6, 62% at stage 12 and 45% at stage 18**.
 *
 * There was a `FINDABLE = 0.78` here holding the pooled average. It was the
 * `P(findable)` term of the decomposition above, it was never wired into
 * `winChance`, and it had no consumer but its own test. `ceilingFor` replaces
 * it and is wired in.
 */

/**
 * P(a line the player finds exists), by depth — the term above, measured.
 *
 * `scripts/odds.ts curve 20` on two independent seeds, 40 boards per stage per
 * point, played at 2.6x plainPar: a budget that large essentially never binds,
 * so what is left is whether a line gets found at all.
 *
 * Stages 1 and 6 measured identically, which is why the head of this curve is
 * flat rather than interpolated down from stage 1.
 */
const CEILING: readonly (readonly [number, number])[] = [
  [1, 0.88], [6, 0.88], [12, 0.62], [18, 0.45],
];

/**
 * The deepest stage anyone has measured is 18. Past it this decays
 * geometrically, which is an EXTRAPOLATION and is not measured — it is shaped
 * the way `ratioFor`'s tail is shaped, and for the same reason: a floor here
 * would be a ceiling on difficulty, and runs have to end. 0.95 per stage is
 * close to the measured 12-to-18 slope continued.
 */
const CEILING_DECAY = 0.95;

export function ceilingFor(stage: number): number {
  const first = CEILING[0];
  if (stage <= first[0]) return first[1];
  const last = CEILING[CEILING.length - 1];
  if (stage >= last[0]) return last[1] * Math.pow(CEILING_DECAY, stage - last[0]);
  for (let i = 1; i < CEILING.length; i++) {
    const [x1, y1] = CEILING[i];
    if (stage <= x1) {
      const [x0, y0] = CEILING[i - 1];
      return y0 + ((y1 - y0) * (stage - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/**
 * The spend curve: how much of a stage's own ceiling is reached at a given
 * multiple of plainPar. Measured directly at the budgets it describes
 * (`scripts/odds.ts curve`): certify a board, re-budget it to exactly the
 * multiple under test, and play it.
 *
 * These numbers are the 2026-09-12 sweep — 160 boards a point, two independent
 * seeds, stages 1/6/12/18 — divided by each stage's own plateau and averaged.
 * Normalising is what makes them transferable: the raw clear rates differ
 * hugely by depth (88/88/62/45 at the plateau) while these barely do, spread
 * 0.14 or less from 1.6x up and 0.23 at the steep points. So the shape is a
 * property of the player and the ceiling is a property of the depth, which is
 * the split this file's header always claimed and did not implement until now.
 *
 * Before that it was a single stage-blind win rate topping out at 0.78, taken
 * on 80 boards a point across the same stages.
 *
 * The second sweep was run after deals became honest shuffles and after the
 * deck cap, to check the numbers had not been left behind by the generator
 * underneath them. They had not: every point moved by 5 points or less, inside
 * the noise at 40 samples. It transfers where earlier attempts did not because
 * it re-budgets boards that already exist rather than inferring a budget from a
 * spend distribution, which made it independent of how those boards were
 * chosen.
 *
 * THE OLD SHAPE DID NOT SURVIVE THE DIFFICULTY PASS, and a vertical re-fit was
 * the wrong answer. Pooled, the old curve read 12 points high at 1.4x and 2.0x
 * and 7 high at the plateau (2.3 to 3.8 sd on 160 boards). But `validate 25`
 * showed why lowering it would not help: at a real bank it predicted 78% at
 * stage 1 against an actual 84% and 67% at stage 12 against an actual 60%, so
 * moving the plateau down fixes the second and breaks the first. The error was
 * stage-shaped, not vertical, which is what the split above is for.
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
const SPEND_CURVE: readonly (readonly [number, number])[] = [
  // 0.9x measured 1 board in 160, which rounds to nothing and is held at zero
  // so the guard below and the first point agree.
  [0.9, 0.0], [1.0, 0.07], [1.1, 0.33], [1.2, 0.51],
  [1.4, 0.78], [1.6, 0.86], [2.0, 0.92], [2.6, 1.0],
];

/**
 * Share of this stage's own ceiling reached at a given multiple of plainPar —
 * the `P(spend fits the budget)` term, and the ONLY term the allowance moves.
 *
 * This is what board selection compares against, deliberately, rather than the
 * full win chance. Scaling the comparison by the stage's ceiling would mean
 * rejecting boards for being deep, which is the one thing no amount of money
 * can fix and exactly what "losable by default" declines to protect against.
 */
export function spendAt(multiple: number): number {
  if (multiple <= SPEND_CURVE[0][0]) return 0;
  const last = SPEND_CURVE[SPEND_CURVE.length - 1];
  if (multiple >= last[0]) return last[1];
  for (let i = 1; i < SPEND_CURVE.length; i++) {
    const [x1, y1] = SPEND_CURVE[i];
    if (multiple <= x1) {
      const [x0, y0] = SPEND_CURVE[i - 1];
      return y0 + ((y1 - y0) * (multiple - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/**
 * The floor: below this multiple of par, the money cannot pay for the board and
 * it is not dealt.
 *
 * Expressed as a RATIO rather than a probability, deliberately. It used to be
 * `coverAt(budget / par) > 0.02` against the old stage-blind curve, which
 * crossed over at 1.005x par. Re-pointing that same 0.02 at the new spend curve
 * would have moved the crossover to 0.937x — a looser floor, shipped by
 * accident, invisible to every instrument here because no sampled board sits
 * near the boundary. A ratio cannot drift when the curve underneath it is
 * re-fitted, so the floor is a ratio now.
 *
 * And it is a floor on SPEND, never on `winChance`. The win chance is honestly
 * low at depth because the findability ceiling is in it — 0.45 at stage 18
 * before any budget is counted — and gating on that would end runs with a
 * bankruptcy screen for a reason no purse can fix. That was a real bug once: it
 * pinned every deep level to the unaffordable floor and ended runs at stage
 * five.
 */
export const AFFORDABLE_AT = 1.005;

export function affordableAt(budget: number, par: number): boolean {
  if (par <= 0) return true;
  return budget / par > AFFORDABLE_AT;
}

/**
 * The honest estimate: both terms, so it is allowed to be low at depth.
 *
 * `stage` is required rather than defaulted. A default would silently hand back
 * the shallow answer for a stage-18 board, which is the exact error this
 * function was restructured to remove.
 */
export function winChance(budget: number, plainPar: number, stage: number, solved = true): number {
  if (!solved) return 0.02;
  if (plainPar <= 0) return 1;
  return ceilingFor(stage) * spendAt(budget / plainPar);
}
