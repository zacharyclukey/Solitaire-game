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
async function validate(per: number): Promise<void> {
  const { winChance } = await import('../src/game/odds.ts');
  console.log('stage  bank   predicted   actual');
  for (const stage of [1, 6, 12]) {
    for (const bank of [0, 30]) {
      let won = 0;
      let pred = 0;
      for (let i = 0; i < per; i++) {
        const run = newRun((77003 + i * 104729) >>> 0);
        run.stage = stage;
        const l = dealLevel({
          deck: run.deck, charms: [], spec: stageSpec(run, stage),
          bonusMoves: 0, bonusCells: 0, bank,
        });
        pred += winChance(l.budget, l.plainPar);
        if (playBot(l.sim, CAREFUL).won) won++;
      }
      console.log(
        `${String(stage).padStart(5)}  ${String(bank).padStart(4)}   ` +
        `${(pred / per * 100).toFixed(0).padStart(8)}%   ${(won / per * 100).toFixed(0).padStart(5)}%`,
      );
    }
  }
}

if (process.argv[2] === 'validate') {
  await validate(Number(process.argv[3] ?? 14));
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
