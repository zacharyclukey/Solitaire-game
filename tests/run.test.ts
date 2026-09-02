import { describe, expect, it } from 'vitest';
import { columnsFor, dealLevel, slackFor, stockFor, type LevelSpec } from '../src/game/deal.ts';
import { MODIFIERS, type ModifierId } from '../src/game/content.ts';
import {
  addCharm,
  bankStage,
  computeScore,
  makeQueue,
  MAX_MARKET_CREDIT,
  nextWarden,
  skippable,
  takeSkip,
  stageSpec,
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

function spec(stage: number, modifiers: ModifierId[] = [], seed = 1234): LevelSpec {
  return { stage, kind: 'trial', modifiers, seed };
}

function deal(depth: number, mods: ModifierId[] = [], seed = 999) {
  return dealLevel({
    deck: starterDeck(),
    charms: [],
    spec: spec(depth, mods, seed),
    bonusMoves: 0,
    bonusCells: 0, insightBonus: 0,
  });
}

describe('dealing', () => {
  it('deals a staircase: one card face-up per column, deepening to the right', () => {
    const level = deal(6, [], 31337);
    const heights = level.sim.cols.slice(0, level.columns).map((c) => c.length);
    expect(heights[heights.length - 1]).toBeGreaterThan(heights[0]);
    for (let c = 0; c < level.columns; c++) {
      const col = level.sim.cols[c];
      const faceUp = col.filter((id) => level.sim.up[id]).length;
      expect(faceUp).toBe(1);
      expect(level.sim.up[col[col.length - 1]]).toBe(1); // and it is the top one
    }
  });

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
      // No modifier may scale the allowance below the line the solver found.
      expect(level.budget).toBeGreaterThan(level.par);
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
  it('shows the next few stages, so a run can be read ahead', () => {
    const run = newRun(31337);
    const queue = makeQueue(run);
    expect(queue).toHaveLength(3);
    expect(queue.map((q) => q.spec.stage)).toEqual([1, 2, 3]);
    // Deterministic: reading ahead has to agree with what actually arrives.
    run.stage = 1;
    expect(makeQueue(run)[0].spec).toEqual(queue[1].spec);
  });

  it('telegraphs the Warden from the start of its stretch', () => {
    const run = newRun(5);
    expect(nextWarden(run).stage).toBe(5);
    expect(nextWarden(run).kind).toBe('boss');
    run.stage = 5;
    expect(nextWarden(run).stage).toBe(10);
  });

  it('will not let a Warden be walked past', () => {
    expect(skippable(5)).toBe(false);
    expect(skippable(10)).toBe(false);
    expect(skippable(4)).toBe(true);
    // Nor the opening board, which is where the run is learnt.
    expect(skippable(1)).toBe(false);
  });

  it('pays nothing at the moment of walking away', () => {
    const run = newRun(808);
    run.stage = 3;
    run.gold = 40;
    const before = { gold: run.gold, deck: run.deck.length, charms: run.charms.length, moves: run.bonusMoves };
    takeSkip(run);
    expect(run.gold).toBe(before.gold);
    expect(run.deck).toHaveLength(before.deck);
    expect(run.charms).toHaveLength(before.charms);
    expect(run.bonusMoves).toBe(before.moves);
    // The debt exists but nothing has vouched for it yet.
    expect(run.skipsPending).toBe(1);
    expect(run.marketCredit).toBe(0);
  });

  it('only honours a skip once a board has been cleared', () => {
    const run = newRun(808);
    takeSkip(run);
    takeSkip(run);
    expect(run.marketCredit).toBe(0); // two ducked, nothing earned
    bankStage(run);
    expect(run.skipsPending).toBe(0);
    expect(run.marketCredit).toBe(2); // the clear vouches for both
  });

  it('lets a run that never clears anything earn nothing at all', () => {
    const run = newRun(808);
    for (let i = 0; i < 4; i++) takeSkip(run);
    expect(run.marketCredit).toBe(0);
    expect(makeShop(run).some((it) => (it as { setAside?: boolean }).setAside)).toBe(false);
  });

  it('caps what one market will honour', () => {
    const run = newRun(808);
    for (let i = 0; i < 6; i++) takeSkip(run);
    bankStage(run);
    expect(run.marketCredit).toBe(MAX_MARKET_CREDIT);
  });

  it('sets aside stock for a skip that was made good on, at a discount', () => {
    const plain = newRun(4242);
    plain.stage = 6;
    const baseline = makeShop(plain).length;

    const owed = newRun(4242);
    owed.stage = 4;
    takeSkip(owed); // stage 5, one ducked
    bankStage(owed); // stage 6, and a board cleared, which vouches for it
    expect(owed.stage).toBe(plain.stage); // same shelf, so the diff is the credit
    const shop = makeShop(owed);
    const aside = shop.filter((it) => (it as { setAside?: boolean }).setAside);
    expect(aside).toHaveLength(1);
    expect(shop.length).toBe(baseline + 1);
    // Set-aside stock is worth having: better shelf, half price.
    expect(['ench', 'charm']).toContain(aside[0].t);
    expect(aside[0].price).toBeGreaterThan(0);
  });

  it('marks which queued stages can be walked past', () => {
    const run = newRun(808);
    run.stage = 2;
    const queue = makeQueue(run);
    expect(queue.map((q) => q.spec.stage)).toEqual([3, 4, 5]);
    expect(queue.map((q) => q.canSkip)).toEqual([true, true, false]);
  });

  it('walking past a stage costs the score but not the escalation', () => {
    const run = newRun(99);
    run.stage = 2;
    const before = { stage: run.stage, depth: run.depth };
    takeSkip(run);
    expect(run.stage).toBe(before.stage + 1);
    expect(run.depth).toBe(before.depth); // nothing banked
    // ...and the board after it is scaled to the stage, not the score.
    expect(stageSpec(run, run.stage + 1).stage).toBe(4);
  });

  it('banking a stage moves both counters', () => {
    const run = newRun(99);
    bankStage(run);
    expect(run.stage).toBe(1);
    expect(run.depth).toBe(1);
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
    const run = newRun(20240601);
    for (let d = 1; d <= 10; d++) {
      const node = stageSpec(run, d);
      const level = dealLevel({
        deck: run.deck,
        charms: run.charms,
        spec: node,
        bonusMoves: run.bonusMoves,
        bonusCells: run.bonusCells, insightBonus: 0,
      });
      expect(level.solution).not.toBeNull();
      for (const mv of level.solution!) applyMove(level.sim, mv, null);
      expect(isWon(level.sim)).toBe(true);
      expect(level.sim.movesLeft).toBeGreaterThanOrEqual(0);
      bankStage(run);
      run.gold += level.baseGold;
      const rewards = makeRewards(run, node.kind, rewardCount(run, node.kind));
      expect(rewards.length).toBeGreaterThan(0);
    }
    expect(run.depth).toBe(10);
  }, 60000);
});
