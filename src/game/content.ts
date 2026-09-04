/**
 * All designed content in one place: card enchantments, curses, run charms and
 * level modifiers. Everything is data, so balance passes are single-line edits.
 */
import type { CurseId, EnchantId } from './types.ts';

export type Rarity = 'common' | 'rare' | 'epic';

/**
 * Single-use escapes, bought and carried between levels.
 *
 * Deals are honest shuffles now, so a board can be genuinely lost — about one
 * in five has no line a player will find, whatever the allowance. That is only
 * a roguelite rather than bad luck if the player can buy their way out of one,
 * so each of these answers a death mode that was actually measured:
 *
 *  - Pry, for a board locked solid. Burning a card away cannot fail to change
 *    the position, which is what makes it the true escape.
 *  - Dig, for a board starved of information, where the next face-down card is
 *    the whole problem.
 *  - Reprieve, for a board that was winnable and simply outlasted the purse.
 *
 * None of them takes a target. A rescue that opens a picker is a rescue the
 * player has to be good at using, and the point is to be saved, not tested.
 */
export type ConsumableId = 'pry' | 'dig' | 'reprieve';

export interface ConsumableDef {
  id: ConsumableId;
  name: string;
  glyph: string;
  text: string;
  price: number;
}

export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  pry: {
    id: 'pry',
    name: 'Pry',
    glyph: '⚒',
    text: 'Destroys the card sitting on top of the most buried column.',
    price: 42,
  },
  dig: {
    id: 'dig',
    name: 'Dig',
    glyph: '⇓',
    text: 'Turns the deepest face-down card of the most buried column.',
    price: 34,
  },
  reprieve: {
    id: 'reprieve',
    name: 'Reprieve',
    glyph: '✛',
    text: 'Eight more moves, right now.',
    price: 26,
  },
};

export const CONSUMABLE_LIST: ConsumableDef[] = Object.values(CONSUMABLES);

/** Moves a Reprieve is worth. */
export const REPRIEVE_MOVES = 8;

export interface EnchantDef {
  id: EnchantId;
  name: string;
  glyph: string;
  text: string;
  rarity: Rarity;
  price: number;
}

export const ENCHANTS: Record<EnchantId, EnchantDef> = {
  torch: {
    id: 'torch',
    name: 'Torch',
    glyph: '✦',
    text: 'When turned, also turns the deepest card of the most buried column.',
    rarity: 'common',
    price: 22,
  },
  spring: {
    id: 'spring',
    name: 'Kickback',
    glyph: '↺',
    text: 'Refunds 1 move whenever it is placed.',
    rarity: 'common',
    price: 20,
  },
  free: {
    id: 'free',
    name: 'Featherweight',
    glyph: '⌁',
    text: 'Moving this card (and anything riding on it) is free.',
    rarity: 'rare',
    price: 34,
  },
  bridge: {
    id: 'bridge',
    name: 'Bridge',
    glyph: '⌒',
    text: 'May be placed one OR two ranks away instead of exactly one.',
    rarity: 'rare',
    price: 32,
  },
  wild: {
    id: 'wild',
    name: 'Chameleon',
    glyph: '◈',
    text: 'Ignores colour and suit when being placed.',
    rarity: 'rare',
    price: 33,
  },
  key: {
    id: 'key',
    name: 'Keystone',
    glyph: '⚿',
    text: 'Always allowed into an empty column, and moving it into one is free.',
    rarity: 'common',
    price: 24,
  },
  gild: {
    id: 'gild',
    name: 'Gilded',
    glyph: '❖',
    text: 'Pays 2 gold when turned.',
    rarity: 'common',
    price: 16,
  },
  beacon: {
    id: 'beacon',
    name: 'Beacon',
    glyph: '☀',
    text: 'Grants 2 moves when turned, or 4 if another card turned it.',
    rarity: 'common',
    price: 26,
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    glyph: '✹',
    text: 'While on top of a column it may be burned away for 1 move.',
    rarity: 'rare',
    price: 30,
  },
  twin: {
    id: 'twin',
    name: 'Twin',
    glyph: '❐',
    text: 'When turned, turns every face-down card of the same rank.',
    rarity: 'epic',
    price: 48,
  },
  prism: {
    id: 'prism',
    name: 'Prism',
    glyph: '◇',
    text: 'Any colour or suit may be stacked on it (rank still matters).',
    rarity: 'rare',
    price: 30,
  },
  conduit: {
    id: 'conduit',
    name: 'Conduit',
    glyph: '⇢',
    // The point of this card is that it reaches for other cards you chose.
    // Everything else in the set adds; a Conduit into a Torch into a Twin
    // multiplies, and a Conduit into a Conduit runs the whole chain.
    text: 'When turned, also turns the nearest face-down enchanted card.',
    rarity: 'epic',
    price: 44,
  },
  resonance: {
    id: 'resonance',
    name: 'Resonance',
    glyph: '≋',
    // Pays for density rather than for any single card, so a deck that commits
    // to enchantments is worth more than the sum of them.
    text: 'When turned, grants 1 move for every other enchanted card face-up.',
    rarity: 'epic',
    price: 40,
  },
  anchor: {
    id: 'anchor',
    name: 'Anchor',
    glyph: '⚓',
    text: 'While it is on top of a column, any card at all may be placed on it.',
    rarity: 'epic',
    price: 52,
  },
};

export const ENCHANT_LIST: EnchantDef[] = Object.values(ENCHANTS);

export interface CurseDef {
  id: CurseId;
  name: string;
  glyph: string;
  text: string;
}

export const CURSES: Record<CurseId, CurseDef> = {
  heavy: { id: 'heavy', name: 'Leaden', glyph: '⇓', text: 'Costs 1 extra move to shift.' },
  frozen: {
    id: 'frozen',
    name: 'Frozen',
    glyph: '❄',
    text: 'Cannot be moved until enough cards have been turned this level.',
  },
  stuck: { id: 'stuck', name: 'Rooted', glyph: '⊘', text: 'May never enter an empty column.' },
  dim: {
    id: 'dim',
    name: 'Shrouded',
    glyph: '☁',
    text: 'Does not turn by itself — pay 1 move to turn it.',
  },
};

export const CURSE_LIST: CurseDef[] = Object.values(CURSES);

/* ------------------------------------------------------------------ charms */

export type CharmId =
  | 'sleeve'
  | 'dice'
  | 'crowbar'
  | 'lantern'
  | 'ring'
  | 'secondwind'
  | 'thrift'
  | 'stance'
  | 'locksmith'
  | 'sorter'
  | 'pact'
  | 'xray'
  | 'pockets'
  | 'scalpel'
  | 'casing';

export interface CharmDef {
  id: CharmId;
  name: string;
  glyph: string;
  text: string;
  rarity: Rarity;
  price: number;
}

export const CHARMS: Record<CharmId, CharmDef> = {
  sleeve: {
    id: 'sleeve',
    name: 'Spare Sleeve',
    glyph: '⇧',
    text: '+3 moves on every level.',
    rarity: 'common',
    price: 40,
  },
  dice: {
    id: 'dice',
    name: 'Loaded Dice',
    glyph: '⚄',
    text: '+2 undos on every level.',
    rarity: 'common',
    price: 32,
  },
  crowbar: {
    id: 'crowbar',
    name: 'Crowbar',
    glyph: '⚒',
    text: 'The first move of every level is free.',
    rarity: 'common',
    price: 30,
  },
  lantern: {
    id: 'lantern',
    name: 'Lantern',
    glyph: '⚲',
    text: 'Turns 2 random face-down cards when a level begins.',
    rarity: 'rare',
    price: 55,
  },
  ring: {
    id: 'ring',
    name: "Merchant's Ring",
    glyph: '◎',
    text: '+50% gold from every source.',
    rarity: 'common',
    price: 38,
  },
  secondwind: {
    id: 'secondwind',
    name: 'Second Wind',
    glyph: '⟳',
    text: 'Once per run, a failed level is re-dealt instead of ending the run.',
    rarity: 'epic',
    price: 85,
  },
  thrift: {
    id: 'thrift',
    name: 'Thrift',
    glyph: '⛁',
    text: '+2 gold for every move left unspent when a level is cleared.',
    rarity: 'rare',
    price: 48,
  },
  stance: {
    id: 'stance',
    name: 'Wide Stance',
    glyph: '⊞',
    text: '+1 column on every level.',
    rarity: 'epic',
    price: 90,
  },
  locksmith: {
    id: 'locksmith',
    name: 'Locksmith',
    glyph: '⚷',
    text: 'Empty-column restrictions never apply to you.',
    rarity: 'rare',
    price: 60,
  },
  sorter: {
    id: 'sorter',
    name: 'Sorting Tray',
    glyph: '≡',
    text: 'Sequences of any length may be moved, even under Gridlock.',
    rarity: 'rare',
    price: 52,
  },
  pact: {
    id: 'pact',
    name: 'Ashen Pact',
    glyph: '☽',
    text: '+7 moves on every level, but one random card is cursed each level.',
    rarity: 'rare',
    price: 45,
  },
  xray: {
    id: 'xray',
    name: 'Diviner’s Lens',
    glyph: '◉',
    text: 'Once per level, peek at every face-down card.',
    rarity: 'common',
    price: 34,
  },
  pockets: {
    id: 'pockets',
    name: 'Deep Pockets',
    glyph: '⊕',
    text: 'Reward screens offer one extra choice.',
    rarity: 'rare',
    price: 58,
  },
  casing: {
    id: 'casing',
    name: 'Card Case',
    glyph: '▣',
    text: 'Two more cards start in the draw pile instead of the tableau.',
    rarity: 'epic',
    price: 95,
  },
  scalpel: {
    id: 'scalpel',
    name: 'Scalpel',
    glyph: '✂',
    text: 'Card removal in shops is half price.',
    rarity: 'common',
    price: 28,
  },
};

export const CHARM_LIST: CharmDef[] = Object.values(CHARMS);

/* --------------------------------------------------------------- modifiers */

export type ModifierId =
  | 'narrow'
  | 'wide'
  | 'gridlock'
  | 'sameSuit'
  | 'anyColor'
  | 'ascend'
  | 'tithe'
  | 'frost'
  | 'lead'
  | 'shroud'
  | 'ceiling'
  | 'rush'
  | 'austere'
  | 'bounty'
  | 'dense'
  | 'twinned'
  | 'steady'
  | 'glass'
  | 'rich'
  | 'thindraw'
  | 'deepdraw'
  | 'heavydraw';

export interface ModifierDef {
  id: ModifierId;
  name: string;
  glyph: string;
  text: string;
  /** Rough difficulty contribution. Negative values are player-favourable. */
  threat: number;
  /**
   * `rule` modifiers rewrite how cards may be placed and stack badly with each
   * other, so a level takes at most one or two of them; `board` modifiers
   * reshape the deal; `meta` modifiers touch the resources around it.
   */
  tag: 'rule' | 'board' | 'meta';
  /** Earliest depth this may appear at. */
  minDepth: number;
  /** Modifiers that must not appear alongside this one. */
  excludes?: ModifierId[];
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  narrow: {
    id: 'narrow',
    tag: 'board',
    name: 'Narrow',
    glyph: '⇤',
    text: 'One fewer column.',
    // Measured the harshest single modifier in the game for a human: on its own
    // it costs a bounded-lookahead player 33 points of clear rate at an
    // unlimited budget, and unlike the others that looked bad it does not
    // recover when the player searches wider. Columns are the only sink, so
    // taking one away is a structural loss, not a puzzle. Priced accordingly,
    // and kept away from the other two things that shrink the same resource.
    threat: 6,
    minDepth: 2,
    excludes: ['wide', 'thindraw', 'sameSuit'],
  },
  wide: {
    id: 'wide',
    tag: 'board',
    name: 'Open Ground',
    glyph: '↔',
    text: 'One extra column.',
    threat: -3,
    minDepth: 1,
    excludes: ['narrow'],
  },
  gridlock: {
    id: 'gridlock',
    tag: 'rule',
    name: 'Gridlock',
    glyph: '⊟',
    text: 'No more than three cards may be moved at once.',
    threat: 5,
    minDepth: 8,
  },
  sameSuit: {
    id: 'sameSuit',
    tag: 'rule',
    name: 'Suit Lock',
    glyph: '♠',
    text: 'Stacks must follow the same suit instead of alternating colour.',
    threat: 8,
    minDepth: 12,
    excludes: ['anyColor'],
  },
  anyColor: {
    id: 'anyColor',
    tag: 'rule',
    name: 'Loose Weave',
    glyph: '◍',
    text: 'Colour is ignored — only rank matters.',
    threat: -4,
    minDepth: 1,
    excludes: ['sameSuit'],
  },
  ascend: {
    id: 'ascend',
    tag: 'rule',
    name: 'Inversion',
    glyph: '⇅',
    text: 'Stacks build upward: place a card one rank HIGHER.',
    threat: 4,
    minDepth: 7,
  },
  tithe: {
    id: 'tithe',
    tag: 'rule',
    name: 'Tithe',
    glyph: '⚖',
    text: 'Entering an empty column costs 2 extra moves.',
    threat: 3,
    minDepth: 3,
  },
  frost: {
    id: 'frost',
    tag: 'board',
    name: 'Deep Frost',
    glyph: '❄',
    text: '3 cards start Frozen.',
    threat: 3,
    minDepth: 4,
  },
  lead: {
    id: 'lead',
    tag: 'board',
    name: 'Leadfoot',
    glyph: '⇓',
    text: '3 cards become Leaden for this level.',
    threat: 3,
    minDepth: 3,
  },
  shroud: {
    id: 'shroud',
    tag: 'board',
    name: 'Shroud',
    glyph: '☁',
    text: '2 cards become Shrouded for this level.',
    threat: 4,
    minDepth: 6,
  },
  ceiling: {
    id: 'ceiling',
    tag: 'rule',
    name: 'Low Ceiling',
    glyph: '‾',
    text: 'No column may hold more than 9 cards.',
    threat: 4,
    minDepth: 8,
  },
  rush: {
    id: 'rush',
    tag: 'meta',
    name: 'Rush',
    glyph: '⏱',
    text: 'Clear the level within two minutes.',
    threat: 4,
    minDepth: 5,
  },
  austere: {
    id: 'austere',
    tag: 'meta',
    name: 'Austerity',
    glyph: '↓',
    text: '15% fewer moves.',
    threat: 5,
    minDepth: 3,
  },
  bounty: {
    id: 'bounty',
    tag: 'meta',
    name: 'Bounty',
    glyph: '✧',
    text: '+60% gold from this level.',
    threat: -2,
    minDepth: 1,
  },
  rich: {
    id: 'rich',
    tag: 'meta',
    name: 'Windfall',
    glyph: '⛁',
    text: '+25 gold on clear.',
    threat: -2,
    minDepth: 1,
  },
  dense: {
    id: 'dense',
    tag: 'board',
    name: 'Overgrowth',
    glyph: '❦',
    text: 'Two extra cards are shuffled into this level.',
    threat: 4,
    minDepth: 4,
  },
  twinned: {
    id: 'twinned',
    tag: 'board',
    name: 'Doppelgänger',
    glyph: '⧉',
    text: 'Two of your cards are duplicated into this level.',
    threat: 4,
    minDepth: 14,
  },
  steady: {
    id: 'steady',
    tag: 'meta',
    name: 'Steady Hand',
    glyph: '⊖',
    text: 'No undos.',
    threat: 4,
    minDepth: 5,
    excludes: ['glass'],
  },
  thindraw: {
    id: 'thindraw',
    tag: 'board',
    name: 'Shallow Deal',
    glyph: '⇱',
    text: 'Four fewer cards in the draw pile — and four more buried in the tableau.',
    threat: 5,
    minDepth: 4,
    excludes: ['deepdraw'],
  },
  deepdraw: {
    id: 'deepdraw',
    tag: 'board',
    name: 'Deep Deal',
    glyph: '⇲',
    text: 'Four more cards in the draw pile, and four fewer in the tableau.',
    threat: -3,
    minDepth: 1,
    excludes: ['thindraw'],
  },
  heavydraw: {
    id: 'heavydraw',
    tag: 'rule',
    name: 'Stiff Deck',
    glyph: '⊗',
    text: 'Every draw costs 2 moves instead of 1.',
    threat: 6,
    minDepth: 5,
  },
  glass: {
    id: 'glass',
    tag: 'meta',
    name: 'Glasswork',
    glyph: '◱',
    text: 'Each undo costs 1 move.',
    threat: 3,
    minDepth: 4,
    excludes: ['steady'],
  },
};

export const MODIFIER_LIST: ModifierDef[] = Object.values(MODIFIERS);

/** Modifiers that help the player; used to seed "gift" nodes on the map. */
export const BOON_IDS: ModifierId[] = MODIFIER_LIST.filter((m) => m.threat < 0).map((m) => m.id);
export const BANE_IDS: ModifierId[] = MODIFIER_LIST.filter((m) => m.threat > 0).map((m) => m.id);
