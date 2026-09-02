/** Card / rule primitives shared by the simulation, the solver and the UI. */

export type Suit = 0 | 1 | 2 | 3; // 0 spades, 1 hearts, 2 diamonds, 3 clubs
export const SUIT_GLYPH = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_NAME = ['Spades', 'Hearts', 'Diamonds', 'Clubs'] as const;
export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

/** 0 = black, 1 = red. */
export function suitColor(suit: Suit): 0 | 1 {
  return suit === 1 || suit === 2 ? 1 : 0;
}

export type EnchantId =
  | 'wild'
  | 'bridge'
  | 'free'
  | 'spring'
  | 'torch'
  | 'twin'
  | 'key'
  | 'ember'
  | 'anchor'
  | 'gild'
  | 'beacon'
  | 'prism';

export type CurseId = 'heavy' | 'frozen' | 'stuck' | 'dim';

/** A card as it lives in the player's run deck. */
export interface DeckCard {
  uid: number;
  rank: number; // 1..13
  suit: Suit;
  ench: EnchantId | null;
  curse: CurseId | null;
}

/**
 * A card flattened for the simulation. Enchantment/curse lookups happen in the
 * inner loops of the solver, so they are pre-baked into booleans here.
 */
export interface CardDef {
  uid: number;
  rank: number;
  suit: Suit;
  color: 0 | 1;
  ench: EnchantId | null;
  curse: CurseId | null;
  wild: boolean;
  bridge: boolean;
  free: boolean;
  spring: boolean;
  torch: boolean;
  twin: boolean;
  key: boolean;
  ember: boolean;
  anchor: boolean;
  gild: boolean;
  beacon: boolean;
  prism: boolean;
  heavy: boolean;
  frozen: boolean;
  stuck: boolean;
  dim: boolean;
}

export type MatchRule = 'alt' | 'suit' | 'any';
export type EmptyRule = 'any' | 'top' | 'none';

export interface RuleSet {
  /** Rank delta applied to the target when stacking: -1 descending, +1 ascending. */
  dir: -1 | 1;
  match: MatchRule;
  empty: EmptyRule;
  /** False = sequences may not be moved as a group (Rust). */
  groups: boolean;
  /** Extra move cost for entering an empty column (Tithe). */
  emptyCost: number;
  /** Extra move cost for parking a card in the reserve (Toll). */
  cellCost: number;
  /** Largest sequence that may be moved at once; 0 = unlimited (Gridlock). */
  maxGroup: number;
  /** Column height cap; 0 = unlimited (Low Ceiling). */
  maxHeight: number;
  /**
   * Rank that satisfies `empty: 'top'`. Under normal (descending) play this is
   * the highest rank in the deck; under Inversion the natural base of a stack
   * is the lowest rank instead.
   */
  baseRank: number;
  /** Reveals required before Frozen cards thaw. */
  thawAt: number;
}

export const DEFAULT_RULES: RuleSet = {
  dir: -1,
  match: 'alt',
  empty: 'any',
  groups: true,
  emptyCost: 0,
  cellCost: 0,
  maxGroup: 0,
  maxHeight: 0,
  baseRank: 13,
  thawAt: 6,
};

/**
 * A single player action.
 *  - `m` move the run starting at `fromIdx` of column `from` onto column `to`
 *  - `b` burn (Ember) the top card of column `from`
 *  - `f` pay to flip a face-down Shrouded card sitting on top of column `from`
 */
export type MoveKind = 'm' | 'b' | 'f';

export interface Move {
  kind: MoveKind;
  from: number;
  fromIdx: number;
  to: number; // meaningful only for kind 'm'
  cost: number;
}

export function makeCardDef(c: DeckCard): CardDef {
  const e = c.ench;
  const k = c.curse;
  return {
    uid: c.uid,
    rank: c.rank,
    suit: c.suit,
    color: suitColor(c.suit),
    ench: e,
    curse: k,
    wild: e === 'wild',
    bridge: e === 'bridge',
    free: e === 'free',
    spring: e === 'spring',
    torch: e === 'torch',
    twin: e === 'twin',
    key: e === 'key',
    ember: e === 'ember',
    anchor: e === 'anchor',
    gild: e === 'gild',
    beacon: e === 'beacon',
    prism: e === 'prism',
    heavy: k === 'heavy',
    frozen: k === 'frozen',
    stuck: k === 'stuck',
    dim: k === 'dim',
  };
}

export function cardLabel(c: { rank: number; suit: Suit }): string {
  return `${RANK_LABEL[c.rank]}${SUIT_GLYPH[c.suit]}`;
}
