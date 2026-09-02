import { describe, expect, it } from 'vitest';
import { columnsFor, dealLevel, slackFor, stockFor, type LevelSpec } from '../src/game/deal.ts';
import { MODIFIERS, type ModifierId } from '../src/game/content.ts';
import { Rng } from '../src/game/rng.ts';
import {
  addCharm,
  computeScore,
  makeFork,
  makeRewards,
  makeShop,
  MIN_DECK,
  newRun,
  removeCard,
  rewardCount,
  starterDeck,
  subSeed,
} from '../src/game/run.ts';
import { applyMove, isWon, legalMoves, simKey, status } from '../src/game/sim.ts';

function spec(depth: number, modifiers: ModifierId[] = [], seed = 1234): LevelSpec {
  return { depth, kind: 'trial', modifiers, seed };
}

function deal(depth: number, mods: ModifierId[] = [], seed = 999) {
  return dealLevel({
    deck: starterDeck(),
    charms: [],
    spec: spec(depth, mods, seed),
    bonusMoves: 0,
    bonusCells: 0,
  });
}

describe('dealing', () => {
  it('always produces a board the solver can clear inside the allowance', () => {
    for (let i = 0; i < 12; i++) {
      const level = deal(1 + (i % 10), [], 1000 + i * 7919);
      expect(level.sim.hidden).toBeGreaterThan(0);
      expect(level.budget).toBeGreaterThanOrEqual(level.par);
      const sol = level.solution;
      expect(sol).not.toBeNull();
      const sim = level.sim;
      for (const mv of sol!) {
        expect(legalMoves(sim, false).some((m) => m.from === mv.from && m.fromIdx === mv.fromIdx && m.to === mv.to && m.kind === mv.kind)).toBe(true);
        applyMove(sim, mv, null);
      }
      expect(isWon(sim)).toBe(true);
      expect(sim.movesLeft).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = deal(6, ['thindraw'], 4242);
    const b = deal(6, ['thindraw'], 4242);
    expect(simKey(a.sim)).toBe(simKey(b.sim));
    expect(a.budget).toBe(b.budget);
  });

  it('survives every single modifier', () => {
    for (const id of Object.keys(MODIFIERS) as ModifierId[]) {
      const level = deal(Math.max(1, MODIFIERS[id].minDepth), [id], 77);
      expect(level.solution ?? []).toBeTruthy();
      expect(level.sim.cols.length).toBe(level.columns + 2); // tableau + pile + waste
      expect(status(level.sim)).not.toBe('lost');
    }
  });

  it('scales columns and reserve with modifiers', () => {
    expect(columnsFor(28, ['narrow'], [])).toBeLessThan(columnsFor(28, [], []));
    expect(columnsFor(28, ['wide'], [])).toBeGreaterThan(columnsFor(28, [], []));
    expect(stockFor(28, ['thindraw'], [], 0)).toBe(stockFor(28, [], [], 0) - 4);
    expect(stockFor(28, ['deepdraw'], [], 0)).toBe(stockFor(28, [], [], 0) + 4);
    expect(stockFor(28, [], ['casing'], 0)).toBe(stockFor(28, [], [], 0) + 2);
  });

  it('tightens the allowance as the run goes deeper, then holds at the floor', () => {
    // Never rises, and is meaningfully tighter by the time a run is ten deep.
    for (let d = 1; d < 40; d++) expect(slackFor(d + 1)).toBeLessThanOrEqual(slackFor(d));
    expect(slackFor(10)).toBeLessThan(slackFor(1) - 0.25);
    // The floor stays above 1: the line the solver found must always fit, or a
    // loss would be the deal's fault rather than the player's.
    expect(slackFor(40)).toBeGreaterThan(1);
  });
});

describe('run progression', () => {
  it('offers a fork of distinct options that grows in threat', () => {
    const run = newRun(31337);
    expect(run.fork.length).toBeGreaterThanOrEqual(2);
    run.depth = 6;
    const later = makeFork(run);
    expect(later.length).toBe(3);
    expect(later.map((n) => n.kind)).toContain('gauntlet');
  });

  it('puts a warden on every fifth level', () => {
    const run = newRun(5);
    run.depth = 4;
    const fork = makeFork(run);
    expect(fork.length).toBe(1);
    expect(fork[0].kind).toBe('boss');
  });

  it('never breaks the one-rule-modifier budget', () => {
    for (let seed = 0; seed < 40; seed++) {
      const run = newRun(seed * 7919 + 13);
      for (let d = 0; d < 24; d++) {
        run.depth = d;
        for (const node of makeFork(run)) {
          const rules = node.modifiers.filter((m) => MODIFIERS[m].tag === 'rule').length;
          expect(rules).toBeLessThanOrEqual(node.kind === 'boss' ? 2 : 1);
          for (const m of node.modifiers) expect(MODIFIERS[m].minDepth).toBeLessThanOrEqual(node.depth);
        }
      }
    }
  });

  it('generates rewards without duplicates', () => {
    const run = newRun(808);
    run.depth = 4;
    const rewards = makeRewards(run, 'trial', rewardCount(run, 'trial'));
    expect(rewards.length).toBeGreaterThan(0);
    const keys = rewards.map((r) => (r.t === 'ench' ? `e${r.ench}` : r.t === 'charm' ? `c${r.id}` : r.t));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('guarantees a charm from a warden', () => {
    const run = newRun(4242);
    run.depth = 5;
    expect(makeRewards(run, 'boss', 4).some((r) => r.t === 'charm')).toBe(true);
  });

  it('stocks a shop the player can actually use', () => {
    const run = newRun(1001);
    run.depth = 3;
    const shop = makeShop(run);
    expect(shop.length).toBeGreaterThanOrEqual(4);
    for (const item of shop) expect(item.price).toBeGreaterThan(0);
  });

  it('refuses to thin the deck below the floor', () => {
    const run = newRun(1);
    while (run.deck.length > MIN_DECK) removeCard(run, run.deck[0].uid);
    const before = run.deck.length;
    removeCard(run, run.deck[0].uid);
    expect(run.deck.length).toBe(before);
  });

  it('scores depth above everything else', () => {
    const shallow = newRun(1);
    shallow.depth = 3;
    shallow.gold = 900;
    const deep = newRun(1);
    deep.depth = 4;
    expect(computeScore(deep)).toBeGreaterThan(computeScore(shallow));
  });

  it('derives independent sub-seeds', () => {
    const seen = new Set<number>();
    for (let d = 0; d < 50; d++) for (const salt of [0, 1, 2, 3]) seen.add(subSeed(12345, d, salt));
    expect(seen.size).toBe(200);
  });

  it('does not hand out a charm twice', () => {
    const run = newRun(77);
    addCharm(run, 'sleeve');
    addCharm(run, 'sleeve');
    expect(run.charms).toEqual(['sleeve']);
  });
});

describe('a full simulated run', () => {
  it('plays ten levels end to end using the solver as the player', () => {
    const rng = new Rng(2024);
    const run = newRun(20240601);
    for (let d = 1; d <= 10; d++) {
      run.fork = makeFork(run);
      const node = rng.pick(run.fork);
      const level = dealLevel({
        deck: run.deck,
        charms: run.charms,
        spec: node,
        bonusMoves: run.bonusMoves,
        bonusCells: run.bonusCells,
      });
      expect(level.solution).not.toBeNull();
      for (const mv of level.solution!) applyMove(level.sim, mv, null);
      expect(isWon(level.sim)).toBe(true);
      expect(level.sim.movesLeft).toBeGreaterThanOrEqual(0);
      run.depth = d;
      run.gold += level.baseGold;
      const rewards = makeRewards(run, node.kind, rewardCount(run, node.kind));
      expect(rewards.length).toBeGreaterThan(0);
    }
    expect(run.depth).toBe(10);
  }, 60000);
});
