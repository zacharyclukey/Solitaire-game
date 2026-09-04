/**
 * The move economy: moves are a bank carried across a run, funded each level by
 * a stipend that is deliberately blind to the player's build.
 */
import { describe, expect, it } from 'vitest';
import { dealLevel, ratioFor, stipendFor } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { applyMove, cloneSim } from '../src/game/sim.ts';
import { starterDeck } from '../src/game/run.ts';
import type { LevelSpec } from '../src/game/deal.ts';
import type { DeckCard, EnchantId } from '../src/game/types.ts';

const KIT: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism', 'conduit', 'resonance'];

/** The same deck every time, with the first `n` distinct cards enchanted. */
function deck(n: number): DeckCard[] {
  const d = starterDeck().map((c) => ({ ...c }));
  for (let i = 0; i < n; i++) d[(i * 3) % d.length].ench = KIT[i % KIT.length];
  return d;
}

function level(cards: DeckCard[], stage: number, seed: number, bank: number) {
  const spec: LevelSpec = { stage, kind: 'trial', modifiers: [], seed };
  return dealLevel({ deck: cards, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank });
}

/**
 * The median share of plainPar a bounded-lookahead player actually spends,
 * measured flat across stages 1-18 by `scripts/humanrun.ts boards`. This, not
 * 1.0, is the line the curve has to cross: paying par exactly is already a loss
 * for anyone who is not a search algorithm.
 */
const NEED = 1.2;

describe('the ratio curve', () => {
  it('starts above what a player needs and ends below it', () => {
    expect(ratioFor(1)).toBeGreaterThan(NEED);
    expect(ratioFor(30)).toBeLessThan(NEED);
  });

  it('opens generously enough that early levels bank something', () => {
    // The first curve paid 1.30 against a median need of 1.29, so a real player
    // banked nothing and had nothing to spend when the ratio turned against
    // them. Opening levels have to fund the rest of the run.
    expect(ratioFor(1)).toBeGreaterThan(NEED * 1.25);
  });

  it('never stops falling, so no build can outrun it forever', () => {
    for (let s = 18; s < 40; s++) expect(ratioFor(s + 1)).toBeLessThan(ratioFor(s));
  });

  it('prices a level off the plain board, not the player, and node kind still bites', () => {
    // Priced off deck size now: 28 cards at about 1.36 moves each.
    expect(stipendFor(28, 1, [], 'trial')).toBeGreaterThan(28 * 1.36 * NEED);
    expect(stipendFor(28, 30, [], 'trial')).toBeLessThan(28 * 1.36 * NEED);
    expect(stipendFor(28, 12, [], 'boss')).toBeLessThan(stipendFor(28, 12, [], 'trial'));
    expect(stipendFor(28, 12, [], 'cache')).toBeGreaterThan(stipendFor(28, 12, [], 'trial'));
  });
});

describe('the stipend is blind to the build', () => {
  const SEEDS = [4242, 90210, 1357, 60613, 20250903, 31337, 7, 555];

  // Note two decks on the same seed do NOT get the same board: the deal
  // relaxes until it finds a line, and each attempt draws from the same rng, so
  // a deck that solves on the first try lands somewhere different from one that
  // needs a second. Build-blindness is therefore a claim about the aggregate,
  // not about a single pair of deals.
  function mean(cards: DeckCard[], pick: (l: ReturnType<typeof level>) => number): number {
    return SEEDS.reduce((a, s) => a + pick(level(cards, 8, s, 40)), 0) / SEEDS.length;
  }

  it('does not quietly charge the player for getting better', () => {
    const plainStipend = mean(deck(0), (l) => l.stipend);
    const builtStipend = mean(deck(8), (l) => l.stipend);
    // The old budget was priced off the player's own line, so a better build
    // shrank it. Priced off the stripped board, it must not.
    expect(builtStipend).toBeGreaterThanOrEqual(plainStipend * 0.98);
  });

  it('leaves the build strictly better off in moves it keeps', () => {
    expect(mean(deck(8), (l) => l.surplus)).toBeGreaterThan(mean(deck(0), (l) => l.surplus));
  });

  it('never prices a board below the line the solver actually found', () => {
    for (const n of [0, 4, 8]) {
      for (const s of SEEDS) {
        const l = level(deck(n), 8, s, 40);
        expect(l.plainPar).toBeGreaterThanOrEqual(l.par);
      }
    }
  });
});

describe('the bank', () => {
  it('is what the level is actually played with', () => {
    const a = level(deck(0), 5, 8080, 0);
    const b = level(deck(0), 5, 8080, 25);
    expect(a.budget).toBe(a.bank + a.stipend);
    expect(b.budget).toBe(b.stipend + 25);
    expect(b.sim.movesLeft).toBe(b.budget);
    // The board itself is untouched by how rich the player is.
    expect(b.par).toBe(a.par);
  });

  it('goes bankrupt rather than dealing a board that cannot be paid for', () => {
    // Deep enough that the geometric tail has taken the ratio under 1.0, which
    // is where an empty bank stops being survivable at all.
    const broke = level(deck(0), 30, 5150, 0);
    expect(broke.affordable).toBe(false);
    expect(broke.budget).toBeLessThan(broke.par);
  });

  it('is solvent at the same stage once the run has banked anything worth having', () => {
    const flush = level(deck(0), 30, 5150, 60);
    expect(flush.affordable).toBe(true);
    expect(flush.budget).toBeGreaterThanOrEqual(flush.par);
  });

  it('funds the early game generously enough to build one', () => {
    for (const seed of [11, 22, 33]) {
      const first = level(deck(0), 1, seed, 0);
      expect(first.affordable).toBe(true);
      expect(first.surplus).toBeGreaterThan(0);
    }
  });
});

describe('the bounded-lookahead player', () => {
  it('clears an opening board when moves are not the constraint', () => {
    // Deliberately given a bank, because this tests the instrument rather than
    // the balance. At the stipend an opening level actually pays, this same
    // player clears only about half of them — which is a fact about the ratio
    // curve, recorded in docs/ECONOMY.md and owned by the retune, not a fact
    // about whether the bot works.
    const l = level(deck(0), 1, 4242, 999);
    const r = playBot(l.sim, CAREFUL);
    expect(r.won).toBe(true);
    expect(r.movesUsed).toBeLessThan(l.par * 2);
  });

  it('is degraded by over-valuing empty columns, so the term is load-bearing', () => {
    // Measured: emptyValue 5 roughly doubles moves-over-par. Values between 0
    // and 2.5 were indistinguishable at 12 boards, so 2.5 is a model choice
    // rather than a tuned one — see docs/ECONOMY.md.
    const l = level(deck(0), 4, 8080, 999);
    const sane = playBot(cloneSim(l.sim), CAREFUL).movesUsed;
    const obsessed = playBot(cloneSim(l.sim), { ...CAREFUL, emptyValue: 12 }).movesUsed;
    expect(obsessed).toBeGreaterThan(sane);
  });

  it('stops rather than looping when a board is dead', () => {
    const l = level(deck(0), 1, 4242, 0);
    l.sim.movesLeft = 2;
    const r = playBot(l.sim, CAREFUL);
    expect(r.won).toBe(false);
    expect(r.movesUsed).toBeLessThanOrEqual(l.par);
  });
});

describe('which deck a level is guaranteed against', () => {
  it('promises early boards to a standard deck, so a build is pure advantage', () => {
    // While the ratio pays for the whole plain board, the budget is lifted to
    // cover plainPar outright. Without this the deal quietly assumes the
    // player's enchantments, and no board can ever produce the thought "I
    // needed the card I passed on".
    for (const stage of [1, 4, 8, 12]) {
      for (const seed of [4242, 90210, 1357]) {
        const l = level(deck(0), stage, seed, 0);
        expect(ratioFor(stage)).toBeGreaterThanOrEqual(1);
        expect(l.budget).toBeGreaterThanOrEqual(l.plainPar);
        expect(l.needsBuild).toBe(false);
        expect(l.slack).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('withdraws that promise once the ratio drops under 1.0', () => {
    // Deep enough that the geometric tail has taken the ratio below 1: the
    // budget no longer covers the plain line and the difference is the build's
    // to find. A bare deck at an empty bank simply cannot afford it.
    const stage = 30;
    expect(ratioFor(stage)).toBeLessThan(1);
    const l = level(deck(0), stage, 5150, 0);
    expect(l.slack).toBeLessThan(0);
    expect(l.needsBuild).toBe(true);
  });

  it('no longer promises the board is winnable, only that it is worth attempting', () => {
    // The old contract was that every dealt board could be cleared with the
    // resources in hand. That is gone on purpose: deals are honest shuffles and
    // the game is losable by default. What survives is a floor — a board with
    // essentially no chance is not dealt at all.
    for (const stage of [1, 10, 20, 30]) {
      for (const seed of [4242, 90210]) {
        const l = level(deck(8), stage, seed, 80);
        if (l.affordable) expect(l.chance).toBeGreaterThan(0.02);
      }
    }
  });

  it('spreads difficulty across shuffles instead of levelling it', () => {
    // Pricing the stipend off this deal's own plainPar made every deal at a
    // stage identically hard, so there was no such thing as an unlucky shuffle.
    const chances = [11, 22, 33, 44, 55, 66].map((s) => level(deck(0), 8, s * 101, 0).chance);
    expect(Math.max(...chances) - Math.min(...chances)).toBeGreaterThan(0.1);
  });
});

describe('the solution a level hands back', () => {
  it('always belongs to the board it was dealt with', () => {
    // A line found on one layout indexes cards another does not have. When the
    // generator falls back to a fresh board it must drop the old line with it,
    // or replaying it walks off the end of the card table.
    for (const stage of [1, 8, 20, 30]) {
      for (const seed of [4242, 90210, 1357]) {
        const l = level(deck(4), stage, seed, 40);
        if (!l.solution) continue;
        // Replayed in sequence, which is the only way a line is meaningful.
        const s = cloneSim(l.sim);
        expect(() => {
          for (const mv of l.solution!) applyMove(s, mv, null);
        }).not.toThrow();
      }
    }
  });
});
