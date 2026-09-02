import { describe, expect, it } from 'vitest';
import { dealLevel, type LevelSpec } from '../src/game/deal.ts';
import { analyse, winnableInBudget } from '../src/game/postmortem.ts';
import { Rng } from '../src/game/rng.ts';
import { starterDeck } from '../src/game/run.ts';
import { applyMove, cloneSim, createSim, legalMoves, simKey, status, type Sim } from '../src/game/sim.ts';
import { DEFAULT_RULES, makeCardDef, type DeckCard, type Move, type Suit } from '../src/game/types.ts';

function card(rank: number, suit: Suit): DeckCard {
  return { uid: rank * 10 + suit, rank, suit, ench: null, curse: null };
}

function build(cols: DeckCard[][], up: boolean[][], budget: number, stockCards: DeckCard[] = []): Sim {
  const defs = [...cols.flat(), ...stockCards].map(makeCardDef);
  let n = 0;
  const idx: number[][] = cols.map((c) => c.map(() => n++));
  const stockIds = stockCards.map(() => n++);
  const flags = new Uint8Array(defs.length);
  up.forEach((col, ci) => col.forEach((v, i) => { if (v) flags[idx[ci][i]] = 1; }));
  return createSim(defs, idx, stockIds, flags, DEFAULT_RULES, budget);
}

/**
 * A hand-made board with exactly three openings and two face-down cards.
 *
 *   col0  5♠ down, 9♥      col1  10♠      col2  4♣ down, 6♦      col3  7♠      col4  8♥
 *
 * 9♥ onto 10♠ turns the 5♠ and 6♦ onto 7♠ turns the 4♣ — that pair is the whole
 * win, and it costs two moves. The only other legal move is 7♠ onto 8♥, which
 * turns nothing. So with a two-move allowance the board is won by playing the
 * pair and lost by playing anything else, which makes the boundary exact.
 */
function trap(budget: number): Sim {
  return build(
    [[card(5, 0), card(9, 1)], [card(10, 0)], [card(4, 3), card(6, 2)], [card(7, 0)], [card(8, 1)]],
    [[false, true], [true], [false, true], [true], [true]],
    budget,
  );
}

/** The one legal move from `from` to `to` in this position. */
function pick(s: Sim, from: number, to: number): Move {
  const mv = legalMoves(s).find((m) => m.kind === 'm' && m.from === from && m.to === to);
  if (!mv) throw new Error(`no move ${from} -> ${to}`);
  return mv;
}

/** Replays `played` onto a copy of `start` and hands back every position. */
function positions(start: Sim, played: Move[]): Sim[] {
  const states = [cloneSim(start)];
  for (const mv of played) {
    const next = cloneSim(states[states.length - 1]);
    applyMove(next, mv, null);
    states.push(next);
  }
  return states;
}

/** Plays the given moves from a fresh copy of `start`. */
function after(start: Sim, played: Move[]): Sim {
  const states = positions(start, played);
  return states[states.length - 1];
}

/** Plays at random until the level is over, recording what was played. */
function fumble(sim: Sim, rng: Rng, cap = 300): Move[] {
  const played: Move[] = [];
  while (status(sim) === 'playing' && played.length < cap) {
    const options = legalMoves(sim, true);
    if (options.length === 0) break;
    const mv = options[rng.int(options.length)];
    applyMove(sim, mv, null);
    played.push(mv);
  }
  return played;
}

function level(depth: number, seed: number) {
  const spec: LevelSpec = { stage: depth, kind: 'trial', modifiers: [], seed };
  return dealLevel({ deck: starterDeck(), charms: [], spec, bonusMoves: 0, bonusCells: 0 });
}

describe('what the run spent', () => {
  it('counts the moves played and the cost they carried', () => {
    const start = trap(4);
    const waste = pick(start, 3, 4);
    const good = pick(after(start, [waste]), 0, 1);
    const pm = analyse(start, [waste, good]);
    expect(pm.movesPlayed).toBe(2);
    expect(pm.costSpent).toBe(2);
  });

  it('leaves the starting position untouched', () => {
    const start = trap(2);
    const before = simKey(start);
    const movesLeft = start.movesLeft;
    analyse(start, [pick(start, 3, 4)]);
    expect(simKey(start)).toBe(before);
    expect(start.movesLeft).toBe(movesLeft);
  });

  it('stops at a move that is not legal rather than throwing', () => {
    const start = trap(4);
    const waste = pick(start, 3, 4);
    const bogus: Move = { kind: 'm', from: 1, fromIdx: 0, to: 2, cost: 1 };
    const pm = analyse(start, [waste, bogus, waste]);
    expect(pm.movesPlayed).toBe(1);
    expect(pm.verdict.length).toBeGreaterThan(0);
  });
});

describe('where the line was lost', () => {
  it('reports a board that is still winnable when nothing has been played', () => {
    const pm = analyse(trap(2), []);
    expect(pm.lastWinnableAfter).toBe(0);
    expect(pm.movesAfterLoss).toBe(0);
    expect(pm.shortBy).toBe(0);
    expect(pm.verdict).toMatch(/still winnable/);
  });

  it('names the first move when the first move was the one that closed the line', () => {
    const start = trap(2);
    const waste = pick(start, 3, 4);
    const good = pick(after(start, [waste]), 0, 1);
    const pm = analyse(start, [waste, good]);
    expect(pm.lastWinnableAfter).toBe(0);
    expect(pm.movesAfterLoss).toBe(2);
    // One move — 6♦ onto 7♠ — still turns the last card, at a cost of one.
    expect(pm.shortBy).toBe(1);
    expect(pm.verdict).toMatch(/very first move/);
  });

  it('calls it a near miss when the last move was the one that closed the line', () => {
    const start = trap(2);
    const good = pick(start, 0, 1);
    const waste = pick(after(start, [good]), 3, 4);
    const pm = analyse(start, [good, waste]);
    expect(pm.lastWinnableAfter).toBe(1);
    expect(pm.movesAfterLoss).toBe(1);
    expect(pm.shortBy).toBe(1);
    expect(pm.verdict).toMatch(/near miss/);
    expect(pm.verdict).toContain('move 1 of 2');
  });

  it('clears the player when the line was still open at the end', () => {
    // Every move here is one the solver itself played, so nothing the player
    // did closed the line — this is the "you simply ran out of clock" branch.
    const level = dealLevel({
      deck: starterDeck(),
      charms: [],
      spec: { stage: 4, kind: 'trial', modifiers: [], seed: 8123 } as LevelSpec,
      bonusMoves: 0,
      bonusCells: 0,
    });
    const played = level.solution!.slice(0, 4);
    expect(played.length).toBe(4);
    const pm = analyse(level.sim, played);
    expect(pm.lastWinnableAfter).toBe(played.length);
    expect(pm.movesAfterLoss).toBe(0);
    expect(pm.verdict).toMatch(/still winnable when the level ended/);
  }, 20000);

  it('blames the move that closed the line, not the ones after it', () => {
    // Three moves for a two-move win, then wasteful moves: the line is gone
    // before the allowance is.
    const start = trap(3);
    const a = pick(start, 3, 4);
    const b = pick(after(start, [a]), 4, 3);
    const c = pick(after(start, [a, b]), 3, 4);
    const pm = analyse(start, [a, b, c]);
    expect(pm.lastWinnableAfter).toBeLessThan(3);
    expect(pm.movesAfterLoss).toBeGreaterThan(0);
    expect(pm.shortBy).toBeGreaterThan(0);
  });
});

describe('the binary search', () => {
  /**
   * The boundary the exhaustive way: the last position from which a win was
   * still reachable inside the allowance it had left.
   */
  function scan(start: Sim, played: Move[]): number | null {
    const states = positions(start, played);
    let last: number | null = null;
    for (let i = 0; i < states.length; i++) if (winnableInBudget(states[i], 400)) last = i;
    return last;
  }

  const boards: { name: string; sim: () => Sim }[] = [
    { name: 'the trap board with a spare move', sim: () => trap(3) },
    { name: 'the trap board with two spare moves', sim: () => trap(4) },
    {
      name: 'a board with a draw pile',
      sim: () =>
        build(
          [[card(3, 0), card(8, 1)], [card(9, 0)], [card(10, 1)]],
          [[false, true], [true], [true]],
          5,
          [card(2, 1), card(7, 3)],
        ),
    },
  ];

  it('agrees with an exhaustive linear scan', () => {
    for (const board of boards) {
      for (let seed = 1; seed <= 4; seed++) {
        const played = fumble(board.sim(), new Rng(seed * 7919));
        const start = board.sim();
        const linear = scan(start, played);
        const pm = analyse(start, played, { budgetMs: 3000 });
        expect(pm.lastWinnableAfter, `${board.name}, seed ${seed}`).toBe(linear);
        // Monotone, so the scan can only ever have found one run of trues.
        const states = positions(start, played);
        if (linear !== null) {
          for (let i = 0; i <= linear; i++) expect(winnableInBudget(states[i], 400)).toBe(true);
        }
      }
    }
  }, 30000);

  it('never claims a position was winnable without a line to back it', () => {
    // Every index it returns must survive a fresh, generous probe.
    const start = trap(4);
    const played = fumble(trap(4), new Rng(31337));
    const pm = analyse(start, played, { budgetMs: 3000 });
    expect(pm.lastWinnableAfter).not.toBeNull();
    expect(winnableInBudget(positions(start, played)[pm.lastWinnableAfter!], 400)).toBe(true);
  });
});

describe('a real dealt level, fumbled', () => {
  it('puts the boundary no earlier than the solved prefix that was played', () => {
    for (const seed of [4242, 999, 31337]) {
      const lvl = level(3, seed);
      const start = cloneSim(lvl.sim);
      const sim = cloneSim(lvl.sim);
      const solution = lvl.solution!;

      // Half of the solver's own line, which must leave the board winnable...
      const prefix = Math.floor(solution.length / 2);
      const played: Move[] = [];
      for (let i = 0; i < prefix; i++) {
        applyMove(sim, solution[i], null);
        played.push(solution[i]);
      }
      // ...then flailing until the allowance is gone.
      played.push(...fumble(sim, new Rng(seed)));
      expect(status(sim)).toBe('lost');

      const t0 = Date.now();
      const pm = analyse(start, played);
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(2000);
      expect(pm.movesPlayed).toBe(played.length);
      expect(pm.costSpent).toBe(lvl.budget - sim.movesLeft);
      expect(pm.lastWinnableAfter).not.toBeNull();
      expect(pm.lastWinnableAfter!).toBeGreaterThanOrEqual(prefix);
      expect(pm.lastWinnableAfter!).toBeLessThan(played.length);
      expect(pm.movesAfterLoss).toBe(played.length - pm.lastWinnableAfter!);
      expect(pm.verdict).toContain(`move ${pm.lastWinnableAfter} of ${played.length}`);
    }
  }, 60000);

  it('reports being short of a line that is still there', () => {
    // Play the solver's line to one move from home, then throw the rest away.
    const lvl = level(2, 8675309);
    const start = cloneSim(lvl.sim);
    const sim = cloneSim(lvl.sim);
    const solution = lvl.solution!;
    const played: Move[] = [];
    for (let i = 0; i < solution.length - 1; i++) {
      applyMove(sim, solution[i], null);
      played.push(solution[i]);
    }
    played.push(...fumble(sim, new Rng(5)));
    const pm = analyse(start, played);
    expect(pm.lastWinnableAfter).not.toBeNull();
    expect(pm.shortBy === null || pm.shortBy >= 0).toBe(true);
    expect(pm.verdict).not.toMatch(/luck|unlucky|!/);
  }, 30000);
});

describe('degrading gracefully', () => {
  it('returns honest nulls instead of hanging when there is no time', () => {
    const lvl = level(4, 24601);
    const start = cloneSim(lvl.sim);
    const sim = cloneSim(lvl.sim);
    const played = fumble(sim, new Rng(11));

    const t0 = Date.now();
    const pm = analyse(start, played, { budgetMs: 1 });
    expect(Date.now() - t0).toBeLessThan(400);
    expect(pm.lastWinnableAfter).toBeNull();
    expect(pm.movesAfterLoss).toBeNull();
    expect(pm.movesPlayed).toBe(played.length);
    expect(pm.verdict).toMatch(/could not be checked|ran out of time/);
  }, 30000);

  it('keeps a whole analysis inside its wall-clock budget', () => {
    const lvl = level(6, 777);
    const start = cloneSim(lvl.sim);
    const sim = cloneSim(lvl.sim);
    const played = fumble(sim, new Rng(3));
    const t0 = Date.now();
    analyse(start, played, { budgetMs: 600 });
    // The last solver pass can only overrun by its own internal check interval.
    expect(Date.now() - t0).toBeLessThan(1200);
  }, 30000);
});

describe('the verdict', () => {
  it('is one plain sentence that never blames the deal', () => {
    const cases: PostMortemLike[] = [
      analyse(trap(2), []),
      analyse(trap(2), (() => { const s = trap(2); return [pick(s, 3, 4)]; })()),
      analyse(trap(4), fumble(trap(4), new Rng(2))),
    ];
    for (const pm of cases) {
      expect(pm.verdict.length).toBeGreaterThan(20);
      expect(pm.verdict.endsWith('.')).toBe(true);
      expect(pm.verdict).not.toMatch(/!/);
      expect(pm.verdict.toLowerCase()).not.toMatch(/luck|unfair|bad deal|should have/);
    }
  });
});

interface PostMortemLike {
  verdict: string;
}
