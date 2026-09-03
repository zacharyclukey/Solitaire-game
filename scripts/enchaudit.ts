/**
 * Which enchantments actually save a run?
 *
 * The run-over screen tells a player which enchantment would have covered the
 * gap. That is only honest if enchantments genuinely flip losses, so this
 * measures it: find boards the bounded-lookahead player loses at a realistic
 * budget, then put each enchantment on each of a few plausible cards and see
 * which ones turn the loss into a win.
 *
 * The player is the fallible bot rather than the solver, deliberately. A solver
 * extracts value from an enchantment that a person would never find, so a
 * solver-measured audit would vouch for advice no player could act on.
 */
import { dealLevel, type LevelSpec } from '../src/game/deal.ts';
import { CASUAL, playBot } from '../src/game/bot.ts';
import { ENCHANT_LIST } from '../src/game/content.ts';
import { newRun, stageSpec } from '../src/game/run.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';
import { makeCardDef, type EnchantId } from '../src/game/types.ts';

const STAGES = [4, 8, 12];
const BOARDS_PER_STAGE = Number(process.argv[2] ?? 8);
/** Cards tried per enchantment. Models "the player had it somewhere useful". */
const PLACEMENTS = 6;

/** The same board with `id` fixed to one card, so only the enchantment differs. */
function withEnchant(base: Sim, cardIdx: number, id: EnchantId): Sim {
  const s = cloneSim(base);
  const d = s.defs[cardIdx];
  s.defs = s.defs.slice();
  s.defs[cardIdx] = makeCardDef({ uid: d.uid, rank: d.rank, suit: d.suit, ench: id, curse: d.curse });
  return s;
}

/**
 * Where to try an enchantment.
 *
 * A first version of this sampled only deep face-down cards, and scored every
 * placement enchantment at zero — not because they are weak but because the
 * cards carrying them never came into play. The spread matters more than the
 * count: buried cards for the reveal effects, column tops for the ones that
 * change what can be stacked, and draw-pile cards for the rest.
 */
function candidates(s: Sim): number[] {
  const buried: number[] = [];
  const tops: number[] = [];
  for (let c = 0; c < s.tableau; c++) {
    const col = s.cols[c];
    if (!col.length) continue;
    for (const id of col) if (!s.up[id]) buried.push(id);
    tops.push(col[col.length - 1]);
  }
  const stock = s.cols[s.tableau].slice(0, 2);
  const out: number[] = [];
  const pools = [buried, tops, stock];
  for (let i = 0; out.length < PLACEMENTS && i < 6; i++) {
    for (const pool of pools) {
      const pick = pool[i];
      if (pick !== undefined && !out.includes(pick)) out.push(pick);
      if (out.length >= PLACEMENTS) break;
    }
  }
  return out;
}

const saves: Record<string, number> = {};
const tried: Record<string, number> = {};
for (const e of ENCHANT_LIST) {
  saves[e.id] = 0;
  tried[e.id] = 0;
}

let losses = 0;
let dealt = 0;
for (const stage of STAGES) {
  const run = newRun(31337);
  for (let i = 0; i < BOARDS_PER_STAGE; i++) {
    run.stage = stage;
    const spec: LevelSpec = { ...stageSpec(run, stage), seed: (2000 + i * 7919) >>> 0 };
    const level = dealLevel({ deck: run.deck, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank: 20 });
    dealt++;
    const base = cloneSim(level.sim);
    if (playBot(cloneSim(base), CASUAL).won) continue; // already winnable, nothing to save
    losses++;
    const spots = candidates(base);
    for (const e of ENCHANT_LIST) {
      tried[e.id]++;
      for (const idx of spots) {
        if (playBot(withEnchant(base, idx, e.id), CASUAL).won) {
          saves[e.id]++;
          break;
        }
      }
    }
  }
}

console.log(`${dealt} boards dealt, ${losses} lost by the bounded-lookahead player at a realistic budget\n`);
console.log('enchantment      saves  rate');
const rows = ENCHANT_LIST.map((e) => ({ e, n: saves[e.id], d: tried[e.id] })).sort((a, b) => b.n - a.n);
for (const r of rows) {
  const rate = r.d ? (r.n / r.d) * 100 : 0;
  console.log(`${r.e.name.padEnd(15)} ${String(r.n).padStart(4)}/${r.d}  ${rate.toFixed(0).padStart(3)}%`);
}
