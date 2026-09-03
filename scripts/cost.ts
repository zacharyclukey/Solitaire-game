/**
 * What a board costs, measured by playing it rather than solving it.
 *
 * The solver finds no line past roughly 32 cards, so from stage five onward the
 * difficulty model rests on a straight line fitted at 28 cards and extrapolated
 * a long way. The bot has no such ceiling: it cannot prove a board unwinnable,
 * but it can play any size of board, and what it spends to win one is a
 * measurement of that board's cost.
 *
 * Answers two questions the current numbers cannot. Is cost per card really
 * linear past 28 cards? And are the boards no solver can clear ones a player
 * still can — the difference between a hard game and a broken one.
 */
import { dealLevel } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { Rng } from '../src/game/rng.ts';
import type { DeckCard, Suit } from '../src/game/types.ts';

const PER = Number(process.argv[2] ?? 12);
const rng = new Rng(20250904);

/**
 * Grow a deck the way the game does, which is not the same as adding random
 * cards. `newCard` in run.ts extends the top of the rank ladder 65% of the time
 * and otherwise fills in below it, so the ranks stay contiguous.
 *
 * An earlier version of this harness added uniform ranks 1-13 to a starter deck
 * of ranks 1-7, which manufactured lone high cards with nothing to stack on
 * them and nothing beneath them to receive. Those decks were unwinnable, and
 * the conclusion drawn from them — that big decks break the game — was about
 * the harness rather than the game.
 */
function grow(base: DeckCard[], to: number): DeckCard[] {
  const d = base.map((c) => ({ ...c }));
  let uid = Math.max(...d.map((c) => c.uid)) + 1;
  while (d.length < to) {
    const hi = Math.max(...d.map((c) => c.rank));
    const rank = hi < 13 && rng.next() < 0.65 ? hi + 1 : rng.range(1, hi);
    d.push({ uid: uid++, rank, suit: rng.int(4) as Suit, ench: null, curse: null });
  }
  return d;
}

// Deck size was originally swept alongside stage, which confounds card count
// with modifier load — the same trap that made an earlier modifier sweep
// unusable. Stage is held fixed here so only the deck is moving.
const STAGE = Number(process.argv[3] ?? 6);
console.log(`stage ${STAGE} throughout, so only deck size varies\n`);
console.log('deck  stage   won    median spend   spend/card   solver saw it');
for (const [size, stage] of [[28, STAGE], [31, STAGE], [34, STAGE], [40, STAGE], [46, STAGE]] as const) {
  const spends: number[] = [];
  let won = 0;
  let saw = 0;
  for (let i = 0; i < PER; i++) {
    const run = newRun((8800 + i * 104729) >>> 0);
    run.stage = stage;
    const l = dealLevel({
      deck: grow(run.deck, size), charms: [], spec: stageSpec(run, stage),
      bonusMoves: 0, bonusCells: 0, bank: 99999,
    });
    if (l.plainSolved) saw++;
    const r = playBot(l.sim, CAREFUL, 900);
    if (r.won) {
      won++;
      spends.push(r.movesUsed);
    }
  }
  spends.sort((a, b) => a - b);
  const med = spends.length ? spends[Math.floor(spends.length / 2)] : NaN;
  console.log(
    `${String(size).padStart(4)}  ${String(stage).padStart(5)}   ${String(won).padStart(2)}/${PER}   ` +
    `${med.toFixed(0).padStart(12)}   ${(med / size).toFixed(2).padStart(10)}   ${String(saw).padStart(11)}/${PER}`,
  );
}
