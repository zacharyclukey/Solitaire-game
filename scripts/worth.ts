/**
 * What each enchantment is worth to a run, card by card.
 *
 * The board-rescue audit (`enchaudit.ts`) asks which cards turn a losing board
 * around, which is the claim the run-over screen makes. This asks the different
 * question a player asks in the shop: given the choice, which card leaves me
 * better off.
 *
 * Paired on identical boards so only the enchantment varies — honest shuffles
 * put plainPar anywhere from 33 to 61, which buries a card worth a few moves if
 * each variant is dealt separately.
 *
 * The metric is expected moves banked over ALL boards, counting a lost board as
 * zero. Taking a median over winners only, as an earlier version did, flatters
 * whatever clears fewer boards: the survivors are the easy ones. Banking
 * nothing is also what a lost board actually does.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { ENCHANT_LIST } from '../src/game/content.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';
import { makeCardDef, type EnchantId } from '../src/game/types.ts';

const PER = Number(process.argv[2] ?? 20);
const STAGE = 8;
const COPIES = 6;

/** The same board with `n` cards carrying `id`. */
function withCard(base: Sim, id: EnchantId | null, n: number): Sim {
  const s = cloneSim(base);
  if (id === null) return s;
  s.defs = s.defs.slice();
  for (let i = 0; i < n; i++) {
    const idx = (i * 3) % s.defs.length;
    const d = s.defs[idx];
    s.defs[idx] = makeCardDef({ uid: d.uid, rank: d.rank, suit: d.suit, ench: id, curse: d.curse });
  }
  return s;
}

const boards: Sim[] = [];
for (let i = 0; i < PER; i++) {
  const run = newRun((31337 + i * 104729) >>> 0);
  run.stage = STAGE;
  boards.push(dealLevel({
    deck: run.deck, charms: [], spec: stageSpec(run, STAGE),
    bonusMoves: 0, bonusCells: 0, bank: 0,
  }).sim);
}

function score(id: EnchantId | null): { kept: number; won: number } {
  let kept = 0;
  let won = 0;
  for (const b of boards) {
    const r = playBot(withCard(b, id, COPIES), CAREFUL);
    if (r.won) {
      won++;
      kept += r.movesLeft;
    }
  }
  return { kept: kept / boards.length, won };
}

const bare = score(null);
console.log(`stage ${STAGE}, ${PER} boards, ${COPIES} copies of one card, paired\n`);
console.log(`bare deck: ${bare.kept.toFixed(1)} expected moves banked, ${bare.won}/${PER} cleared\n`);
console.log('card             banked   vs bare   cleared');
const rows = ENCHANT_LIST.map((e) => ({ e, s: score(e.id) }));
for (const r of rows.sort((a, b) => b.s.kept - a.s.kept)) {
  const d = r.s.kept - bare.kept;
  console.log(
    `${r.e.name.padEnd(15)} ${r.s.kept.toFixed(1).padStart(6)}   ${(d >= 0 ? '+' : '')}${d.toFixed(1).padStart(6)}   ${String(r.s.won).padStart(2)}/${PER}`,
  );
}
