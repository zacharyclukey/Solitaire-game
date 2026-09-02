import { describe, expect, it } from 'vitest';
import { dealLevel, type LevelSpec } from '../src/game/deal.ts';
import { ask, questionById, QUESTIONS } from '../src/game/oracle.ts';
import { starterDeck } from '../src/game/run.ts';
import { applyMove, cloneSim, legalMoves, type Sim } from '../src/game/sim.ts';
import type { Move } from '../src/game/types.ts';

function level(stage: number, seed: number) {
  const spec: LevelSpec = { stage, kind: 'trial', modifiers: [], seed };
  return dealLevel({ deck: starterDeck(), charms: [], spec, bonusMoves: 0, bonusCells: 0 });
}

/** Plays moves that are legal but deliberately unhelpful. */
function squander(sim: Sim, n: number): Move[] {
  const played: Move[] = [];
  for (let i = 0; i < n; i++) {
    const opts = legalMoves(sim, true);
    if (!opts.length) break;
    const mv = opts[opts.length - 1];
    applyMove(sim, mv, null);
    played.push(mv);
  }
  return played;
}

describe('the Oracle', () => {
  it('prices every question it offers', () => {
    expect(QUESTIONS.length).toBeGreaterThan(0);
    for (const q of QUESTIONS) {
      expect(q.cost).toBeGreaterThan(0);
      expect(questionById(q.id)).toBe(q);
      expect(q.label.endsWith('?')).toBe(true);
    }
  });

  it('says yes on a fresh board, which is certified winnable', () => {
    const lv = level(3, 4242);
    const a = ask('alive', { sim: lv.sim, start: cloneSim(lv.sim), played: [] });
    expect(a.tone).toBe('good');
    expect(a.text).toMatch(/^Yes/);
  });

  it('separates "no line" from "no line you can still afford"', () => {
    const lv = level(3, 4242);
    // The board is fine; the allowance is not.
    const starved = cloneSim(lv.sim);
    starved.movesLeft = 1;
    const a = ask('alive', { sim: starved, start: null, played: [] });
    expect(a.tone).toBe('bad');
    expect(a.text).toMatch(/needs \d+ more moves? than you have/);
  });

  it('hands back a move that can actually be played', () => {
    const lv = level(3, 909);
    const a = ask('line', { sim: lv.sim, start: cloneSim(lv.sim), played: [] });
    expect(a.move).toBeTruthy();
    const legal = legalMoves(lv.sim, true);
    expect(
      legal.some(
        (m) => m.kind === a.move!.kind && m.from === a.move!.from && m.fromIdx === a.move!.fromIdx && m.to === a.move!.to,
      ),
    ).toBe(true);
  });

  it('clears the player when nothing has gone wrong yet', () => {
    const lv = level(3, 4242);
    const start = cloneSim(lv.sim);
    const played = lv.solution!.slice(0, 3);
    for (const mv of played) applyMove(lv.sim, mv, null);
    const a = ask('wrong', { sim: lv.sim, start, played });
    expect(a.rewind).toBe(0);
    expect(a.tone).toBe('good');
  });

  it('says nothing has gone wrong before a move is played', () => {
    const lv = level(3, 4242);
    const a = ask('wrong', { sim: lv.sim, start: cloneSim(lv.sim), played: [] });
    expect(a.tone).toBe('flat');
    expect(a.rewind).toBeUndefined();
  });

  it('offers a rewind measured in moves once the line is gone', () => {
    const lv = level(4, 77);
    const start = cloneSim(lv.sim);
    const played = squander(lv.sim, 14);
    const a = ask('wrong', { sim: lv.sim, start, played, budgetMs: 700 });
    if (a.rewind && a.rewind > 0) {
      expect(a.rewind).toBeLessThanOrEqual(played.length);
      expect(a.text).toMatch(/move \d+ of \d+/);
      expect(a.tone).toBe('bad');
    } else {
      // Squandering did not manage to lose it; the answer must still be honest.
      expect(['good', 'flat']).toContain(a.tone);
    }
  }, 20000);
});
