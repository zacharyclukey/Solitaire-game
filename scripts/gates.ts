/**
 * What Keystone and Locksmith are worth now that something restricts empty
 * columns.
 *
 * Both were measured as doing nothing, and both had the same cause: their whole
 * effect is bypassing empty-column restrictions, and until Royal Gates was
 * wired there were none in the game to bypass. Keystone measured +0.6 moves and
 * 4% of lost boards; Locksmith set `RuleSet.empty` to the value it already had
 * and was a literal no-op.
 *
 * So the question is conditional and has to be measured that way. Deal ONE
 * board and flip the gate on a clone — dealing the arms separately lets the
 * win-chance selector pick easier layouts for the harder rule and cancel the
 * effect, which is how Suit Lock once measured easier than a plain board.
 *
 * Locksmith needs no arm of its own: on a gated board the charm sets `empty`
 * back to 'any', which is exactly the ungated arm. Its value is the gap between
 * the two gated columns, paid only on boards that carry a gate.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';
import { makeCardDef } from '../src/game/types.ts';

const PER = Number(process.argv[2] ?? 40);
const STAGE = 10;
const COPIES = 6;
/**
 * Unlimited, so only structure is under test.
 *
 * A first pass ran this at the real allowance and measured nothing usable: a
 * bare deck clears 9 of 40 at stage 10 and 4 of 40 once gated, so expected
 * moves banked sits near zero in every cell and an effect worth a fraction of a
 * move cannot show above that floor. The question here is whether Keystone
 * opens columns the gate closed, which is a question about the board rather
 * than about the purse.
 */
const BANK = 9999;

function withKeystone(base: Sim, on: boolean): Sim {
  const s = cloneSim(base);
  if (!on) return s;
  s.defs = s.defs.slice();
  for (let i = 0; i < COPIES; i++) {
    const idx = (i * 3) % s.defs.length;
    const d = s.defs[idx];
    s.defs[idx] = makeCardDef({ uid: d.uid, rank: d.rank, suit: d.suit, ench: 'key', curse: d.curse });
  }
  return s;
}

function gated(base: Sim, on: boolean): Sim {
  const s = cloneSim(base);
  s.rules = { ...s.rules, empty: on ? 'top' : 'any' };
  return s;
}


const boards: Sim[] = [];
for (let i = 0; i < PER; i++) {
  const run = newRun((31337 + i * 104729) >>> 0);
  run.stage = STAGE;
  boards.push(dealLevel({
    deck: run.deck, charms: [], spec: stageSpec(run, STAGE),
    bonusMoves: 0, bonusCells: 0, bank: BANK,
  }).sim);
}

function score(gate: boolean, key: boolean): number {
  let won = 0;
  for (const b of boards) if (playBot(withKeystone(gated(b, gate), key), CAREFUL).won) won++;
  return won;
}

console.log(`stage ${STAGE}, ${PER} boards, ${COPIES} copies, gate flipped in place, unlimited budget\n`);
console.log('board            cleared, no Keystone   cleared, with Keystone   Keystone is worth');
for (const [label, gate] of [['plain', false], ['Royal Gates', true]] as const) {
  const off = score(gate, false);
  const on = score(gate, true);
  const pp = ((on - off) / PER) * 100;
  console.log(
    `${label.padEnd(14)} ${String(off).padStart(3)}/${PER} (${((off / PER) * 100).toFixed(0).padStart(3)}%)          ` +
    `${String(on).padStart(3)}/${PER} (${((on / PER) * 100).toFixed(0).padStart(3)}%)          ` +
    `${pp >= 0 ? '+' : ''}${pp.toFixed(0)}pp`,
  );
}
