/**
 * What would have saved this board.
 *
 * A loss is only fair if the player can see the thing they were missing. Once
 * deals stop being certified against the deck in hand, some boards will be lost
 * to the shuffle rather than to a misplay, and the difference between that
 * feeling like a roguelite and feeling like bad luck is entirely whether the
 * game can say "a Bridge on the seven of spades wins this".
 *
 * So: take the board as it was dealt, try an enchantment on a card, and ask the
 * solver whether the line now fits the moves the player actually had. The first
 * one that does is the answer.
 *
 * Ordered by measured worth rather than flavour, so the likeliest answer is
 * found before the search budget runs out. Re-measured against honest shuffles
 * (`scripts/enchaudit.ts`, 14 lost boards): Ember and Anchor both save 57% of
 * them, Chameleon and Twin 36%, and Torch, Bridge and Prism 29%.
 *
 * Conduit is deliberately absent. It is one of the strongest cards to own and
 * it rescues nothing — 0 of 14 — because reaching for another enchanted card
 * does nothing for a board that has already gone wrong. Searching it here only
 * spent budget that the cards which do rescue needed.
 */
import { findSolution } from './solver.ts';
import { cloneSim, stock, type Sim } from './sim.ts';
import { cardLabel, makeCardDef, type EnchantId } from './types.ts';

const CANDIDATES: EnchantId[] = ['ember', 'anchor', 'wild', 'twin', 'torch', 'bridge', 'prism'];

export interface Rescue {
  ench: EnchantId;
  /** The card it would have gone on, as "7♠". */
  card: string;
}

/** Cards worth trying, spread across where an enchantment can matter. */
function targets(s: Sim, limit: number): number[] {
  const buried: number[] = [];
  const tops: number[] = [];
  for (let c = 0; c < s.tableau; c++) {
    const col = s.cols[c];
    if (!col.length) continue;
    for (const id of col) if (!s.up[id]) buried.push(id);
    tops.push(col[col.length - 1]);
  }
  const out: number[] = [];
  const pools = [buried, tops, stock(s).slice(0, 2)];
  for (let i = 0; out.length < limit && i < 8; i++) {
    for (const pool of pools) {
      const pick = pool[i];
      if (pick !== undefined && !out.includes(pick)) out.push(pick);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export interface RescueOptions {
  /** Wall clock for the whole search. Default 900ms. */
  budgetMs?: number;
  /** Cards tried per enchantment. */
  spots?: number;
}

/**
 * An enchantment and a card that together bring the board inside the moves the
 * player had, or null if none was found in the time allowed.
 *
 * Null is not proof that nothing would have helped — the search is bounded on
 * both axes — so the copy built from this should never claim the board was
 * unsalvageable.
 */
export function findRescue(start: Sim, budget: number, opts: RescueOptions = {}): Rescue | null {
  const deadline = Date.now() + (opts.budgetMs ?? 900);
  const spots = targets(start, opts.spots ?? 3);

  for (const ench of CANDIDATES) {
    for (const id of spots) {
      if (Date.now() >= deadline) return null;
      const d = start.defs[id];
      if (d.ench !== null) continue; // already carries one; not a card they lacked
      const s = cloneSim(start);
      s.defs = s.defs.slice();
      s.defs[id] = makeCardDef({ uid: d.uid, rank: d.rank, suit: d.suit, ench, curse: d.curse });
      const left = deadline - Date.now();
      const sol = findSolution(s, Math.max(60, Math.min(180, left)));
      if (sol && sol.cost <= budget) return { ench, card: cardLabel(d) };
    }
  }
  return null;
}
