/**
 * The move economy: moves are a bank carried across a run, funded each level by
 * a stipend that is deliberately blind to the player's build.
 */
import { describe, expect, it } from 'vitest';
import { dealLevel, ratioFor, stipendFor } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { cloneSim } from '../src/game/sim.ts';
import { starterDeck } from '../src/game/run.ts';
import type { LevelSpec } from '../src/game/deal.ts';
import type { DeckCard, EnchantId } from '../src/game/types.ts';

const KIT: EnchantId[] = ['torch', 'bridge', 'wild', 'free', 'spring', 'twin', 'anchor', 'prism'];

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

describe('the ratio curve', () => {
  it('starts above 1.0 and falls below it', () => {
    expect(ratioFor(1)).toBeGreaterThan(1);
    expect(ratioFor(10)).toBeLessThan(1);
  });

  it('never stops falling, so no build can outrun it forever', () => {
    for (let s = 18; s < 40; s++) expect(ratioFor(s + 1)).toBeLessThan(ratioFor(s));
  });

  it('prices a level off the plain board, not the player, and node kind still bites', () => {
    expect(stipendFor(40, 1, [], 'trial')).toBeGreaterThan(40);
    expect(stipendFor(40, 12, [], 'trial')).toBeLessThan(40);
    expect(stipendFor(40, 12, [], 'boss')).toBeLessThan(stipendFor(40, 12, [], 'trial'));
    expect(stipendFor(40, 12, [], 'cache')).toBeGreaterThan(stipendFor(40, 12, [], 'trial'));
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
    const broke = level(deck(0), 16, 5150, 0);
    expect(broke.affordable).toBe(false);
    expect(broke.budget).toBeLessThan(broke.par);
  });

  it('is solvent at the same stage once the run has banked anything worth having', () => {
    const flush = level(deck(0), 16, 5150, 60);
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
