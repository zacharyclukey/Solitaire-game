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
 * found before the search budget runs out. Re-measured 2026-09-11 over 39 lost
 * boards from 120 dealt (`scripts/enchaudit.ts 40`): Anchor 69%, Ember 54%,
 * Bridge 41%, Prism 36%, Twin 31%, Chameleon 28%, Torch 26%, Kickback and
 * Featherweight 13%, Keystone and Beacon 3%.
 *
 * Every rate roughly TRIPLED against the 2026-09-08 table (Ember 21%, Anchor
 * 18%, Prism 16%), and the loss rate fell from 42% of dealt boards to 33%. The
 * two move together for one reason: this week's modifier floor and the three
 * wired rule variations made boards harder to PLAY without making them deader
 * to DEAL. `scripts/deadboards.ts` says the same thing independently — the
 * share of lost boards a searcher can still solve went from 17% to 42%. Fewer
 * losses, and far more of them recoverable positions rather than dead shuffles,
 * so one enchantment turns them much more often.
 *
 * This is the second time modifier selection has invalidated this audit. The
 * first was repricing Loose Weave; this one never touched an enchantment at
 * all. Anything that changes which modifiers get dealt changes what a rescue is
 * worth, so re-run this whenever the modifier pool or the threat budget moves.
 *
 * On the ORDER: only two positions are load-bearing at this sample. Anchor to
 * the front is a real 15-point gap over Ember, and Chameleon had to come up
 * from LAST — it was searched ninth at 28% behind two cards measuring 13%,
 * which is the one way this list can actively mislead, since the search returns
 * the first hit inside its deadline. The middle ordering (Bridge against Prism,
 * Torch against Chameleon) sits inside the noise at 39 lost boards and is not
 * worth churning on the next re-run.
 *
 * Conduit is deliberately absent, and Gilded and Resonance with it. All three
 * measure 0 of 43 — reaching for another enchanted card, or being paid, does
 * nothing for a board that has already gone wrong. Searching them here only
 * spends budget the cards that do rescue need.
 */
import { findSolution } from './solver.ts';
import { cloneSim, stock, type Sim } from './sim.ts';
import { cardLabel, makeCardDef, type EnchantId } from './types.ts';

const CANDIDATES: EnchantId[] = [
  'anchor', 'ember', 'bridge', 'prism', 'twin', 'wild', 'torch', 'spring', 'free',
];

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
