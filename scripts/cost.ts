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

function grow(base: DeckCard[], to: number): DeckCard[] {
  const d = base.map((c) => ({ ...c }));
  let uid = Math.max(...d.map((c) => c.uid)) + 1;
  while (d.length < to) {
    d.push({ uid: uid++, rank: rng.range(1, 13), suit: rng.int(4) as Suit, ench: null, curse: null });
  }
  return d;
}

console.log('deck  stage   won    median spend   spend/card   solver saw it');
for (const [size, stage] of [[28, 3], [34, 8], [40, 13], [46, 18], [52, 23]] as const) {
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
