/**
 * The raw material for estimating a deal's win chance without simulating it.
 *
 * Two separable things decide whether a board is lost. It can be structurally
 * dead — no line the player can find at any move count — or it can simply cost
 * more than the budget. Moves fix the second and do nothing for the first, so
 * they are measured apart:
 *
 *   P(win at budget m x plainPar) = P(findable) x P(spend <= m | findable)
 *
 * Played at an unlimited bank so the budget is never the constraint, which is
 * what makes the spend distribution a property of the player rather than of the
 * allowance it happened to be given.
 *
 * `curve` and `validate` both take an optional seed base as the last argument,
 * so a second sweep draws genuinely different boards. Two invocations at the
 * same seed are NOT independent: they differ only by the one or two boards that
 * shift because `dealLevel` sizes allowances against a wall clock.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';

const PER = Number(process.argv[3] ?? 14);
const STAGES = [1, 4, 8, 12, 16, 20];

/**
 * Does the estimate predict reality? Deals at a real bank and compares the
 * model's number against what the player actually does. Run before trusting
 * the estimate to gate anything.
 */
async function validate(per: number, seed: number): Promise<void> {
  const { winChance } = await import('../src/game/odds.ts');
  console.log('stage  bank   predicted   actual');
  for (const stage of [1, 6, 12]) {
    for (const bank of [0, 30]) {
      let won = 0;
      let pred = 0;
      for (let i = 0; i < per; i++) {
        const run = newRun((seed + i * 104729) >>> 0);
        run.stage = stage;
        const l = dealLevel({
          deck: run.deck, charms: [], spec: stageSpec(run, stage),
          bonusMoves: 0, bonusCells: 0, bank,
        });
        pred += winChance(l.budget, l.plainPar, stage);
        if (playBot(l.sim, CAREFUL).won) won++;
      }
      console.log(
        `${String(stage).padStart(5)}  ${String(bank).padStart(4)}   ` +
        `${(pred / per * 100).toFixed(0).padStart(8)}%   ${(won / per * 100).toFixed(0).padStart(5)}%`,
      );
    }
  }
}

/**
 * P(win) measured directly at the budget it will actually be used at.
 *
 * The first attempt derived this from a spend distribution gathered at an
 * unlimited bank, and it did not transfer: a player with infinite moves does
 * not economise, so the distribution sat too far right, and the estimate came
 * out pessimistic in the middle (72% against a real 88% at stage 1) while still
 * being optimistic where budgets are tight (17% against a real 0% at stage 12).
 * A win rate has to be measured under the pressure it is meant to describe.
 */
async function curve(per: number, seed: number): Promise<void> {
  const MULTIPLES = [0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 2.0, 2.6];
  const STAGES_HERE = [1, 6, 12, 18];
  console.log(`seed ${seed}, ${per} boards per stage per point (budget = multiple x plainPar, no bank)`);
  console.log(`multiple  pooled   ${STAGES_HERE.map((s) => `st${s}`.padStart(6)).join('')}`);
  for (const m of MULTIPLES) {
    let won = 0;
    let n = 0;
    const perStage: string[] = [];
    for (const stage of STAGES_HERE) {
      let sWon = 0;
      for (let i = 0; i < per; i++) {
        const run = newRun((seed + i * 104729) >>> 0);
        run.stage = stage;
        const l = dealLevel({
          deck: run.deck, charms: [], spec: stageSpec(run, stage),
          bonusMoves: 0, bonusCells: 0, bank: 9999,
        });
        // Re-budget the certified board to exactly the multiple under test.
        l.sim.movesLeft = Math.round(m * l.plainPar);
        l.sim.movesUsed = 0;
        n++;
        if (playBot(l.sim, CAREFUL).won) { won++; sWon++; }
      }
      perStage.push(`${sWon}/${per}`.padStart(6));
    }
    console.log(
      `${m.toFixed(1).padStart(8)}  ${(won / n * 100).toFixed(0).padStart(4)}%` +
      ` (${won}/${n})${perStage.join('')}`,
    );
  }
}

/**
 * What the stage's acceptance band actually accepts.
 *
 * `dealLevel` takes the first board whose estimated spend share is within
 * TOLERANCE of `spendAt(ratioFor(stage))`. Wherever that curve saturates, the
 * estimate cannot tell two boards apart, and nothing above the saturation point
 * can be rejected for being too easy. This
 * reports the realised ratio of the boards actually dealt against the ratio
 * the stage was designed around, so the band can be checked rather than
 * reasoned about.
 *
 * It was written to check a prediction, and the prediction was half wrong. Above
 * stage 6 the target falls far enough that the band is two-sided and there is no
 * loose tail at all. Below it, target + TOLERANCE reached the curve's maximum,
 * so no board could be rejected for being too EASY — and at
 * stages 4 and 6 that shows up, 8-16% of boards landing more than 0.3 above the
 * ratio the stage was designed around and reaching 1.96x against a 1.40x design
 * point. At stages 1 and 2 the same one-sidedness is harmless, because the
 * board population there is too narrow to reach that far. Measured 2026-09-12,
 * `band 25` on seeds 606061 and 313171, which agree.
 *
 * The fallback column is why this matters to anyone changing the band. A
 * two-sided test rejects more shuffles, and `dealLevel` races a deadline: past
 * it, selection gives up and hands out a shallow standard board. Baseline that
 * column before and after, or a harder band will quietly buy easier levels.
 */
async function band(per: number, seed: number): Promise<void> {
  const { ratioFor } = await import('../src/game/deal.ts');
  const { spendAt } = await import('../src/game/odds.ts');
  console.log('stage  ratioFor  spend@   solved  fallbk   realised ratio (stipend/plainPar)');
  console.log('                                          median    p90     max   share>+0.3');
  for (const stage of [1, 2, 4, 6, 8, 10, 14, 18]) {
    const ratios: number[] = [];
    let solved = 0;
    let fell = 0;
    for (let i = 0; i < per; i++) {
      const run = newRun((seed + i * 104729) >>> 0);
      run.stage = stage;
      const l = dealLevel({
        deck: run.deck, charms: [], spec: stageSpec(run, stage),
        bonusMoves: 0, bonusCells: 0, bank: 0,
      });
      if (l.plainSolved) solved++;
      if (l.fallback) fell++;
      if (l.plainPar > 0) ratios.push(l.stipend / l.plainPar);
    }
    ratios.sort((a, b) => a - b);
    const at = (q: number) => ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))];
    const want = ratioFor(stage);
    const loose = ratios.filter((r) => r > want + 0.3).length / ratios.length;
    console.log(
      `${String(stage).padStart(5)}  ${want.toFixed(2).padStart(8)}  ` +
      `${(spendAt(want) * 100).toFixed(0).padStart(5)}%  ` +
      `${(solved / per * 100).toFixed(0).padStart(5)}%  ` +
      `${(fell / per * 100).toFixed(0).padStart(5)}%   ` +
      `${at(0.5).toFixed(2).padStart(7)} ${at(0.9).toFixed(2).padStart(6)} ` +
      `${ratios[ratios.length - 1].toFixed(2).padStart(7)}  ${(loose * 100).toFixed(0).padStart(8)}%`,
    );
  }
}

if (process.argv[2] === 'curve') {
  await curve(Number(process.argv[3] ?? 10), Number(process.argv[4] ?? 51001));
  process.exit(0);
}

/**
 * How much of a board's identity is the allowance?
 *
 * A resumed level stores its `LevelSpec` and its moves, re-deals from the spec
 * and replays the moves in. That is only sound while one spec deals one board,
 * and it does not: selection compares the realised spend ratio against the
 * stage's target, so the allowance is part of what gets dealt. This reports how
 * often changing only the allowance changes the layout.
 *
 * docs/DESIGN.md 6h-ter carried "68 of 240 boards (28%)" for this, measured ad
 * hoc against the old stage-blind curve with an unrecorded delta. This exists so
 * the figure can be re-run instead of inherited.
 *
 * `delta` is in moves, and 6 is roughly what the 2026-09-08 `ratioFor`
 * tightening was worth against a 40-move plainPar.
 */
async function identity(per: number, delta: number, seed: number): Promise<void> {
  const { simKey } = await import('../src/game/sim.ts');
  const STAGES_HERE = [1, 2, 4, 6, 8, 10, 14, 18];
  console.log(`same spec and seed, allowance +${delta} moves, ${per} boards per stage`);
  console.log('stage   differing');
  let diff = 0;
  let n = 0;
  for (const stage of STAGES_HERE) {
    let d = 0;
    for (let i = 0; i < per; i++) {
      const run = newRun((seed + i * 104729) >>> 0);
      run.stage = stage;
      const spec = stageSpec(run, stage);
      const at = (bonusMoves: number) => dealLevel({
        deck: run.deck, charms: [], spec, bonusMoves, bonusCells: 0, bank: 0,
      });
      if (simKey(at(0).sim) !== simKey(at(delta).sim)) d++;
      n++;
    }
    diff += d;
    console.log(`${String(stage).padStart(5)}   ${String(d).padStart(3)}/${per}  ${(d / per * 100).toFixed(0)}%`);
  }
  console.log(`\npooled: ${diff}/${n} = ${(diff / n * 100).toFixed(0)}%`);
}

if (process.argv[2] === 'band') {
  await band(Number(process.argv[3] ?? 20), Number(process.argv[4] ?? 606061));
  process.exit(0);
}

if (process.argv[2] === 'identity') {
  await identity(Number(process.argv[3] ?? 30), Number(process.argv[4] ?? 6), Number(process.argv[5] ?? 414143));
  process.exit(0);
}

if (process.argv[2] === 'validate') {
  await validate(Number(process.argv[3] ?? 14), Number(process.argv[4] ?? 77003));
  process.exit(0);
}

const spends: number[] = [];
let findable = 0;
let total = 0;

for (const stage of STAGES) {
  for (let i = 0; i < PER; i++) {
    const run = newRun((31337 + i * 104729) >>> 0);
    run.stage = stage;
    const l = dealLevel({
      deck: run.deck, charms: [], spec: stageSpec(run, stage),
      bonusMoves: 0, bonusCells: 0, bank: 9999,
    });
    const r = playBot(l.sim, CAREFUL);
    total++;
    if (r.won) {
      findable++;
      spends.push(r.movesUsed / l.plainPar);
    }
  }
}

spends.sort((a, b) => a - b);
console.log(`findable: ${findable}/${total} = ${(findable / total).toFixed(3)}\n`);
console.log('multiple of plainPar -> share of findable boards cleared within it');
for (let m = 0.9; m <= 3.01; m += 0.1) {
  const within = spends.filter((s) => s <= m + 1e-9).length;
  console.log(`${m.toFixed(1)}  ${(within / spends.length).toFixed(3)}`);
}
