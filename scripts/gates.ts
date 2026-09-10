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
 *
 * Worth knowing what that costs, since it is a harness assumption. `dealLevel`
 * picks its layout by win chance against the allowance, so an unlimited bank
 * does not merely fund these boards, it CHANGES which boards are dealt — the
 * selector aims at a band, and a huge purse moves the band. The comparison
 * stays sound because all four cells run on the same boards, but the sample is
 * the set the selector picks for a generous allowance rather than the set a
 * real stage-10 run would face. Read the gaps between cells, never the absolute
 * clear rates against the difficulty curve.
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

/*
 * ---------------------------------------------------------------------------
 * Second question: should Locksmith cover Tithe as well?
 *
 * Its text says "Empty-column restrictions never apply to you", and Tithe — two
 * extra moves to enter an empty column — is one. Covering it would take the
 * charm from 18.0% of deep boards to 32.0%, near enough double.
 *
 * This needs a DIFFERENT instrument from the measurement above, and getting
 * that wrong would produce confident nonsense. Royal Gates changes what is
 * LEGAL, so it is measured at an unlimited budget where only structure shows.
 * Tithe changes what things COST, and at an unlimited budget a cost is
 * invisible by construction — the arms would come out identical and the honest
 * reading of that would be "no effect", which would be an artifact of the
 * instrument rather than a fact about the charm. So this runs at the real
 * allowance, on boards dealt WITH Tithe, so the stipend has already paid for
 * the threat exactly as it would in a run.
 *
 * The result is not assumed. Keystone's free entry looked like a pure gift and
 * measured at -6pp, because entering an empty column is usually a bad move and
 * making it cheap is what gets it played. Waiving Tithe is the same shape of
 * change.
 *
 * BANK, and why it is not zero. A first pass ran this at bank 0 and the control
 * cleared 1 of 120. That is not a finding, it is a floor: at zero carry on a
 * deep Warden a bare deck is already dead, and against a control pinned at zero
 * ANY move-saving effect measures enormous — it read +32pp, which says nothing
 * about Tithe and everything about the regime. It is the mirror of the failure
 * the Keystone pass hit from the other side, where a control at 9 of 40 was too
 * low for a fractional effect to clear the noise.
 *
 * So it runs with the bank a player actually arrives holding. `humanrun.ts`
 * measures peak bank at 21 after the cap, so that is the number, and the arms
 * are only worth reading while the control sits somewhere measurable rather
 * than against either wall.
 */
const REAL_BANK = 21;
const TITHE_PER = Number(process.argv[3] ?? PER);
const titheBoards: { sim: Sim }[] = [];
for (let i = 0; i < TITHE_PER; i++) {
  const run = newRun((77003 + i * 104729) >>> 0);
  run.stage = STAGE;
  const spec = { ...stageSpec(run, STAGE), modifiers: ['tithe' as const] };
  titheBoards.push({
    sim: dealLevel({ deck: run.deck, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank: REAL_BANK }).sim,
  });
}

function titheScore(waived: boolean): number {
  let won = 0;
  for (const b of titheBoards) {
    const s = cloneSim(b.sim);
    s.rules = { ...s.rules, emptyCost: waived ? 0 : 2 };
    if (playBot(s, CAREFUL).won) won++;
  }
  return won;
}

const tOff = titheScore(false);
const tOn = titheScore(true);
console.log(`\nTithe boards, ${TITHE_PER} boards, arriving with ${REAL_BANK} banked`);
console.log(`  paying the tax   ${tOff}/${TITHE_PER} (${((tOff / TITHE_PER) * 100).toFixed(0)}%)`);
console.log(`  Locksmith waives ${tOn}/${TITHE_PER} (${((tOn / TITHE_PER) * 100).toFixed(0)}%)`);
console.log(`  worth ${(((tOn - tOff) / TITHE_PER) * 100).toFixed(0)}pp`);
if (tOff <= TITHE_PER * 0.05 || tOff >= TITHE_PER * 0.95) {
  console.log('  !! control is against a wall — this number is the regime, not the charm');
}
