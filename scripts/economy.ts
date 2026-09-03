/**
 * What the build is actually worth, in moves.
 *
 * Deals the same stages with decks of increasing enchantment count and reports
 * the bill (par), the price (stipend, from the stripped board) and what the
 * player keeps (surplus). If surplus does not climb with build strength, the
 * economy is not paying for the build and the whole design is decorative.
 */
import { dealLevel, ratioFor, type LevelSpec } from '../src/game/deal.ts';
import { starterDeck } from '../src/game/run.ts';
import type { DeckCard, EnchantId } from '../src/game/types.ts';

const KIT: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism'];

function deck(n: number): DeckCard[] {
  const d = starterDeck().map((c) => ({ ...c }));
  for (let i = 0; i < n; i++) d[(i * 3) % d.length].ench = KIT[i % KIT.length];
  return d;
}

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);
const BANK = 45;

console.log('stage ratio ench  par plain stip surp  dealMs  unafford');
for (const stage of [2, 6, 10, 14, 18, 22]) {
  for (const n of [0, 4, 8]) {
    const cards = deck(n);
    let par = 0, plain = 0, stip = 0, surp = 0, ms = 0, bad = 0;
    for (const seed of SEEDS) {
      const spec: LevelSpec = { stage, kind: 'trial', modifiers: [], seed };
      const t = Date.now();
      const l = dealLevel({ deck: cards, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank: BANK });
      ms += Date.now() - t;
      par += l.par; plain += l.plainPar; stip += l.stipend; surp += l.surplus;
      if (!l.affordable) bad++;
    }
    const k = SEEDS.length;
    console.log(
      `${String(stage).padStart(5)} ${ratioFor(stage).toFixed(2)} ${String(n).padStart(4)} ` +
      `${(par / k).toFixed(1).padStart(4)} ${(plain / k).toFixed(1).padStart(5)} ` +
      `${(stip / k).toFixed(1).padStart(4)} ${(surp / k).toFixed(1).padStart(5)} ` +
      `${(ms / k).toFixed(0).padStart(6)}  ${String(bad).padStart(3)}/${k}`,
    );
  }
}
