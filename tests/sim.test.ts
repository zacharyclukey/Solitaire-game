import { describe, expect, it } from 'vitest';
import {
  applyMove,
  canPlaceEmpty,
  canStack,
  createSim,
  isWon,
  legalMoves,
  runStart,
  settle,
  simKey,
  status,
  remaining,
  stock,
  waste,
  wasteIdx,
} from '../src/game/sim.ts';
import { DEFAULT_RULES, makeCardDef, type DeckCard, type EnchantId, type CurseId, type Suit } from '../src/game/types.ts';

function card(rank: number, suit: Suit, ench: EnchantId | null = null, curse: CurseId | null = null): DeckCard {
  return { uid: rank * 10 + suit, rank, suit, ench, curse };
}

function build(
  cols: DeckCard[][],
  up: boolean[][],
  rules = DEFAULT_RULES,
  budget = 50,
  stockCards: DeckCard[] = [],
) {
  const defs = [...cols.flat(), ...stockCards].map(makeCardDef);
  let n = 0;
  const idx: number[][] = cols.map((c) => c.map(() => n++));
  const stockIds = stockCards.map(() => n++);
  const flags = new Uint8Array(defs.length);
  up.forEach((col, ci) => col.forEach((v, i) => { if (v) flags[idx[ci][i]] = 1; }));
  return createSim(defs, idx, stockIds, flags, rules, budget);
}

describe('stacking rules', () => {
  it('descends and alternates colour by default', () => {
    const s = build([[card(5, 0)], [card(4, 1)], [card(4, 3)]], [[true], [true], [true]]);
    expect(canStack(s.defs, 1, 0, s.rules)).toBe(true); // 4H on 5S
    expect(canStack(s.defs, 2, 0, s.rules)).toBe(false); // 4C on 5S — same colour
  });

  it('honours the suit-lock rule', () => {
    const R = { ...DEFAULT_RULES, match: 'suit' as const };
    const s = build([[card(5, 0)], [card(4, 0)], [card(4, 1)]], [[true], [true], [true]], R);
    expect(canStack(s.defs, 1, 0, s.rules)).toBe(true);
    expect(canStack(s.defs, 2, 0, s.rules)).toBe(false);
  });

  it('honours inversion', () => {
    const R = { ...DEFAULT_RULES, dir: 1 as const };
    const s = build([[card(5, 0)], [card(6, 1)], [card(4, 1)]], [[true], [true], [true]], R);
    expect(canStack(s.defs, 1, 0, s.rules)).toBe(true);
    expect(canStack(s.defs, 2, 0, s.rules)).toBe(false);
  });

  it('Bridge reaches two ranks', () => {
    const s = build([[card(5, 0)], [card(3, 1, 'bridge')]], [[true], [true]]);
    expect(canStack(s.defs, 1, 0, s.rules)).toBe(true);
  });

  it('Chameleon ignores colour, Prism accepts any colour', () => {
    const wild = build([[card(5, 0)], [card(4, 3, 'wild')]], [[true], [true]]);
    expect(canStack(wild.defs, 1, 0, wild.rules)).toBe(true);
    const prism = build([[card(5, 0, 'prism')], [card(4, 3)]], [[true], [true]]);
    expect(canStack(prism.defs, 1, 0, prism.rules)).toBe(true);
    const prismRank = build([[card(5, 0, 'prism')], [card(9, 3)]], [[true], [true]]);
    expect(canStack(prismRank.defs, 1, 0, prismRank.rules)).toBe(false);
  });

  it('Anchor accepts anything at all', () => {
    const s = build([[card(5, 0, 'anchor')], [card(9, 0)]], [[true], [true]]);
    expect(canStack(s.defs, 1, 0, s.rules)).toBe(true);
  });
});

describe('empty column rules', () => {
  const k = makeCardDef(card(13, 0));
  const two = makeCardDef(card(2, 0));
  const keyed = makeCardDef(card(2, 0, 'key'));
  const rooted = makeCardDef(card(2, 0, null, 'stuck'));

  it('royal gates only admit the top rank', () => {
    const R = { ...DEFAULT_RULES, empty: 'top' as const, topRank: 13 };
    expect(canPlaceEmpty(k, R)).toBe(true);
    expect(canPlaceEmpty(two, R)).toBe(false);
    expect(canPlaceEmpty(keyed, R)).toBe(true);
  });

  it('sealed ground admits nothing but a Keystone', () => {
    const R = { ...DEFAULT_RULES, empty: 'none' as const };
    expect(canPlaceEmpty(k, R)).toBe(false);
    expect(canPlaceEmpty(keyed, R)).toBe(true);
  });

  it('Rooted cards never enter empty columns', () => {
    expect(canPlaceEmpty(rooted, DEFAULT_RULES)).toBe(false);
  });
});

describe('runs and group moves', () => {
  it('finds the movable run', () => {
    const s = build(
      [[card(9, 0), card(8, 1), card(7, 0)], [card(10, 1)]],
      [[true, true, true], [true]],
    );
    expect(runStart(s, 0)).toBe(0);
  });

  it('stops the run at a face-down card', () => {
    const s = build(
      [[card(9, 0), card(8, 1), card(7, 0)], [card(10, 1)]],
      [[false, true, true], [true]],
    );
    expect(runStart(s, 0)).toBe(1);
  });

  it('Rust forbids group moves', () => {
    const R = { ...DEFAULT_RULES, groups: false };
    const s = build(
      [[card(9, 0), card(8, 1), card(7, 0)], [card(10, 1)]],
      [[true, true, true], [true]],
      R,
    );
    expect(runStart(s, 0)).toBe(2);
  });
});

describe('reveal cascade', () => {
  it('turns a newly exposed card', () => {
    const s = build([[card(3, 0), card(9, 1)], [card(10, 0)]], [[false, true], [true]]);
    const mv = legalMoves(s).find((m) => m.kind === 'm' && m.from === 0 && m.to === 1)!;
    expect(mv).toBeTruthy();
    applyMove(s, mv);
    expect(s.up[0]).toBe(1);
    expect(s.hidden).toBe(0);
    expect(isWon(s)).toBe(true);
  });

  it('Torch turns the deepest card in its column', () => {
    const s = build(
      [[card(2, 0), card(3, 1), card(6, 0, 'torch'), card(9, 1)], [card(10, 0)]],
      [[false, false, false, true], [true]],
    );
    const mv = legalMoves(s).find((m) => m.kind === 'm' && m.from === 0 && m.to === 1)!;
    applyMove(s, mv);
    // 6 Torch is exposed and turns; it then turns the 2 at the bottom.
    expect(s.up[2]).toBe(1);
    expect(s.up[0]).toBe(1);
    expect(s.up[1]).toBe(0);
  });

  it('Twin turns every hidden card of the same rank', () => {
    const s = build(
      [[card(4, 1), card(9, 1)], [card(4, 0, 'twin'), card(10, 0)], [card(11, 1)]],
      [[false, true], [false, true], [true]],
    );
    const mv = legalMoves(s).find((m) => m.kind === 'm' && m.from === 1 && m.to === 2)!;
    applyMove(s, mv);
    expect(s.up[2]).toBe(1); // twin turned
    expect(s.up[0]).toBe(1); // its partner turned too
  });

  it('Shrouded cards refuse to turn on their own', () => {
    const s = build([[card(3, 0, null, 'dim'), card(9, 1)], [card(10, 0)]], [[false, true], [true]]);
    const mv = legalMoves(s).find((m) => m.kind === 'm')!;
    applyMove(s, mv);
    expect(s.up[0]).toBe(0);
    const flip = legalMoves(s).find((m) => m.kind === 'f');
    expect(flip).toBeTruthy();
    applyMove(s, flip!);
    expect(s.up[0]).toBe(1);
  });
});

describe('move costs', () => {
  it('Featherweight is free and Leaden costs double', () => {
    const s = build(
      [[card(9, 1)], [card(8, 0, 'free')], [card(8, 3, null, 'heavy')], [card(10, 0)]],
      [[true], [true], [true], [true]],
    );
    const moves = legalMoves(s).filter((m) => m.to === 0 && m.kind === 'm');
    expect(moves.find((m) => m.from === 1)!.cost).toBe(0);
    expect(moves.find((m) => m.from === 2)!.cost).toBe(2);
  });

  it('Tithe taxes empty columns and Keystone dodges it', () => {
    const R = { ...DEFAULT_RULES, emptyCost: 2 };
    const s = build(
      [[card(9, 1), card(8, 0)], [], [card(6, 1), card(4, 0, 'key')]],
      [[true, true], [], [true, true]],
      R,
    );
    const toEmpty = legalMoves(s).filter((m) => m.to === 1);
    expect(toEmpty.find((m) => m.from === 0)!.cost).toBe(3);
    expect(toEmpty.find((m) => m.from === 2)!.cost).toBe(1);
  });

  it('Kickback refunds a move', () => {
    const s = build([[card(9, 1)], [card(8, 0, 'spring')]], [[true], [true]]);
    expect(legalMoves(s).find((m) => m.from === 1)!.cost).toBe(0);
  });
});

describe('frozen cards', () => {
  it('cannot move until enough cards have been turned', () => {
    const R = { ...DEFAULT_RULES, thawAt: 1 };
    const s = build([[card(9, 1)], [card(8, 0, null, 'frozen')]], [[true], [true]], R);
    expect(legalMoves(s).some((m) => m.from === 1)).toBe(false);
    s.revealed = 1;
    expect(legalMoves(s).some((m) => m.from === 1)).toBe(true);
  });
});

describe('status and keys', () => {
  it('reports a loss when no affordable move remains', () => {
    const s = build([[card(9, 1)], [card(3, 0), card(2, 2)]], [[true], [false, true]], DEFAULT_RULES, 5);
    expect(legalMoves(s)).toHaveLength(0);
    expect(status(s)).toBe('lost');
  });

  it('canonicalises column order', () => {
    const a = build([[card(9, 1)], [card(2, 0)]], [[true], [true]]);
    const b = build([[card(2, 0)], [card(9, 1)]], [[true], [true]]);
    // Different card indices, but the shape is the mirror image.
    expect(simKey(a).split('|').length).toBe(simKey(b).split('|').length);
  });

  it('settle is idempotent', () => {
    const s = build([[card(3, 0), card(9, 1)]], [[false, true]]);
    const before = simKey(s);
    settle(s, null);
    expect(simKey(s)).toBe(before);
  });
});

describe('Ember', () => {
  it('burns the top card off the board', () => {
    const s = build([[card(3, 0), card(9, 1, 'ember')], [card(10, 0)]], [[false, true], [true]]);
    const burn = legalMoves(s).find((m) => m.kind === 'b')!;
    expect(burn).toBeTruthy();
    applyMove(s, burn);
    expect(s.gone[1]).toBe(1);
    expect(s.up[0]).toBe(1);
    expect(isWon(s)).toBe(true);
  });
});

describe('the draw pile', () => {
  it('turns the top card onto the waste for a move', () => {
    const s = build([[card(9, 1)]], [[true]], DEFAULT_RULES, 10, [card(4, 0), card(3, 2)]);
    expect(s.hidden).toBe(2);
    const draw = legalMoves(s).find((m) => m.kind === 'd')!;
    expect(draw.cost).toBe(1);
    applyMove(s, draw);
    expect(stock(s)).toHaveLength(1);
    expect(waste(s)).toHaveLength(1);
    // The pile's last entry is its top, so the 3 is turned first.
    expect(s.defs[waste(s)[0]].rank).toBe(3);
    expect(s.hidden).toBe(1);
    expect(s.movesLeft).toBe(9);
  });

  it('offers no draw once the pile is empty', () => {
    const s = build([[card(9, 1)]], [[true]], DEFAULT_RULES, 10, [card(3, 2)]);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    expect(legalMoves(s).some((m) => m.kind === 'd')).toBe(false);
  });

  it('plays the top of the waste onto the tableau, and only the top', () => {
    const s = build([[card(9, 1)]], [[true]], DEFAULT_RULES, 10, [card(2, 0), card(8, 0)]);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!); // 8♠ to the waste
    const play = legalMoves(s).find((m) => m.kind === 'm' && m.from === wasteIdx(s))!;
    expect(play).toBeTruthy();
    applyMove(s, play);
    expect(waste(s)).toHaveLength(0);
    expect(s.cols[0].map((id) => s.defs[id].rank)).toEqual([9, 8]);

    // Draw the 2, which has nowhere to go: no play comes off the waste.
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    expect(legalMoves(s).some((m) => m.kind === 'm' && m.from === wasteIdx(s))).toBe(false);
  });

  it('does not count turning the pile over as progress — the card must be placed', () => {
    // The whole point of the goal: a card seen on the waste is not a card
    // sorted into a column, so dealing the pile out cannot win a level.
    const s = build([[card(9, 1)]], [[true]], DEFAULT_RULES, 10, [card(3, 2)]);
    expect(isWon(s)).toBe(false);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    expect(s.hidden).toBe(0); // nothing is face-down any more...
    expect(waste(s)).toHaveLength(1); // ...but it is sitting on the waste
    expect(isWon(s)).toBe(false);
    expect(remaining(s)).toBe(1);
  });

  it('is won once every card sits face-up in a column', () => {
    const s = build([[card(9, 1)]], [[true]], DEFAULT_RULES, 10, [card(8, 0)]);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    expect(isWon(s)).toBe(false);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'm' && m.from === wasteIdx(s))!);
    expect(waste(s)).toHaveLength(0);
    expect(isWon(s)).toBe(true);
  });

  it('turns the waste back over when the pile runs dry, a limited number of times', () => {
    const R = { ...DEFAULT_RULES, passes: 1 };
    const s = build([[card(9, 1)]], [[true]], R, 20, [card(3, 2), card(2, 3)]);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    expect(stock(s)).toHaveLength(0);
    expect(waste(s)).toHaveLength(2);

    const recycle = legalMoves(s).find((m) => m.kind === 'r')!;
    expect(recycle).toBeTruthy();
    applyMove(s, recycle);
    expect(stock(s)).toHaveLength(2);
    expect(waste(s)).toHaveLength(0);
    expect(s.passesLeft).toBe(0);

    // Passes are finite: once spent, the waste stays where it is.
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    applyMove(s, legalMoves(s).find((m) => m.kind === 'd')!);
    expect(legalMoves(s).some((m) => m.kind === 'r')).toBe(false);
  });

  it('never lets anything be placed onto the pile or the waste', () => {
    const s = build([[card(9, 1), card(8, 0)]], [[true, true]], DEFAULT_RULES, 10, [card(3, 2)]);
    for (const m of legalMoves(s, false)) {
      if (m.kind === 'm') expect(m.to).toBeLessThan(s.tableau);
    }
  });

  it('charges the Stiff Deck surcharge for drawing', () => {
    const R = { ...DEFAULT_RULES, drawCost: 2 };
    const s = build([[card(9, 1)]], [[true]], R, 10, [card(3, 2)]);
    expect(legalMoves(s).find((m) => m.kind === 'd')!.cost).toBe(2);
  });
});
