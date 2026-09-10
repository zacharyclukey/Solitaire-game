/**
 * What would loosening the allowance actually buy?
 *
 * `ratioFor` was tightened 0.15 at every step on 2026-09-08, alongside the bank
 * cap and the removal of the under-par `bonusMoves` grant. Each was measured
 * alone. Measured together afterwards, 30 of 30 no-build runs end OUT OF MOVES
 * — every run in the reference sample now ends on the allowance rather than on
 * the board, which is what the standing brief says must not happen.
 *
 * Whether that is too far is the owner's call. This exists so the call is made
 * against numbers rather than a feeling: it plays whole runs at several ratio
 * settings and reports where they end and why.
 *
 * HOW THE ARMS ARE BUILT, and what that costs. A ratio delta is applied as the
 * flat allowance it is worth — `deckSize x PLAIN_PAR_PER_CARD x delta` — passed
 * as `bonusMoves`, which is the same field a charm uses. That is faithful in
 * the way that matters: it lands in `stipendBase`, so it changes the board the
 * selector picks exactly as a real ratio change would, rather than merely
 * funding a board chosen for a poorer purse.
 *
 * It is not perfectly faithful. `austere` scales the ratio term by 0.85 and the
 * node kinds scale it too, and a flat add escapes both. The error is second
 * order and always in the same direction across arms, so the COMPARISON holds
 * even where an absolute number would not. Read the gaps.
 */
import { bankCap, dealLevel, PLAIN_PAR_PER_CARD } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { growCard, MAX_DECK, newRun, stageSpec } from '../src/game/run.ts';
import { Rng } from '../src/game/rng.ts';
import type { DeckCard } from '../src/game/types.ts';

const MAX_STAGE = 40;
type Cause = 'bankrupt' | 'ran out of moves' | 'stuck with moves left' | 'reached the cap';

function playRun(seed: number, delta: number): { depth: number; cause: Cause; peakBank: number } {
  const run = newRun(seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const deck: DeckCard[] = run.deck.map((c) => ({ ...c }));
  let uid = Math.max(...deck.map((c) => c.uid)) + 1;
  let bank = 0;
  let peakBank = 0;

  for (let stage = 1; stage <= MAX_STAGE; stage++) {
    run.stage = stage;
    const bonusMoves = Math.round(deck.length * PLAIN_PAR_PER_CARD * delta);
    const level = dealLevel({
      deck, charms: [], spec: stageSpec(run, stage), bonusMoves, bonusCells: 0, bank,
    });
    if (!level.affordable) return { depth: stage - 1, cause: 'bankrupt', peakBank };

    const r = playBot(level.sim, CAREFUL);
    if (!r.won) {
      return { depth: stage - 1, cause: r.movesLeft <= 0 ? 'ran out of moves' : 'stuck with moves left', peakBank };
    }
    bank = Math.min(r.movesLeft, bankCap(level));
    peakBank = Math.max(peakBank, bank);
    if (deck.length < MAX_DECK) deck.push(growCard(deck, rng, uid++));
  }
  return { depth: MAX_STAGE, cause: 'reached the cap', peakBank };
}

const RUNS = Number(process.argv[2] ?? 20);
// 0 is the game as it stands; +0.15 restores the pre-tightening ratio exactly.
const DELTAS = [0, 0.05, 0.075, 0.15];

console.log(`${RUNS} runs an arm, no build, no charms, no escapes\n`);
console.log('ratio delta   median  mean   peak bank   out of moves   stuck   bankrupt');
for (const d of DELTAS) {
  const out = Array.from({ length: RUNS }, (_, i) => playRun(4242 + i * 7919, d));
  const depths = out.map((o) => o.depth).sort((a, b) => a - b);
  const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
  const peak = Math.round(out.reduce((a, o) => a + o.peakBank, 0) / out.length);
  const n = (c: Cause) => out.filter((o) => o.cause === c).length;
  console.log(
    `${(d === 0 ? 'current' : `+${d}`).padEnd(13)} ${String(depths[depths.length >> 1]).padStart(6)} ` +
    `${mean.toFixed(1).padStart(5)} ${String(peak).padStart(11)} ${String(n('ran out of moves')).padStart(14)} ` +
    `${String(n('stuck with moves left')).padStart(7)} ${String(n('bankrupt')).padStart(10)}`,
  );
}
