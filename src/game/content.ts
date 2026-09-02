/**
 * All designed content in one place: card enchantments, curses, run charms and
 * level modifiers. Everything is data, so balance passes are single-line edits.
 */
import type { CurseId, EnchantId } from './types.ts';

export type Rarity = 'common' | 'rare' | 'epic';

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
    text: 'When turned, also turns the deepest face-down card in its column.',
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
    text: 'Always allowed into an empty column, and never pays the entry toll.',
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
    text: 'Grants 2 extra moves when turned.',
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
    glyph: '🜂',
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
    text: 'You may always move sequences, even under Rust.',
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
    text: '+1 reserve cell on every level.',
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
  | 'cramped'
  | 'wide'
  | 'buried'
  | 'royal'
  | 'gridlock'
  | 'sameSuit'
  | 'anyColor'
  | 'ascend'
  | 'rust'
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
  | 'tight'
  | 'toll';

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
    glyph: '▯',
    text: 'One fewer column.',
    threat: 3,
    minDepth: 2,
    excludes: ['cramped', 'wide'],
  },
  cramped: {
    id: 'cramped',
    tag: 'rule',
    name: 'Cramped',
    glyph: '▮',
    text: 'Two fewer columns.',
    threat: 7,
    minDepth: 12,
    excludes: ['narrow', 'wide'],
  },
  wide: {
    id: 'wide',
    tag: 'board',
    name: 'Open Ground',
    glyph: '▭',
    text: 'One extra column.',
    threat: -3,
    minDepth: 1,
    excludes: ['narrow', 'cramped'],
  },
  buried: {
    id: 'buried',
    tag: 'board',
    name: 'Buried',
    glyph: '▤',
    text: 'One fewer card starts face-up in each column.',
    threat: 4,
    minDepth: 3,
  },
  royal: {
    id: 'royal',
    tag: 'rule',
    name: 'Royal Gates',
    glyph: '♛',
    text: 'Only the two ranks nearest the top of the deck may start an empty column.',
    threat: 5,
    minDepth: 10,
  },
  gridlock: {
    id: 'gridlock',
    tag: 'rule',
    name: 'Gridlock',
    glyph: '⊟',
    text: 'No more than three cards may be moved at once.',
    threat: 5,
    minDepth: 8,
    excludes: ['rust'],
  },
  sameSuit: {
    id: 'sameSuit',
    tag: 'rule',
    name: 'Suit Lock',
    glyph: '♠',
    text: 'Stacks must follow the same suit instead of alternating colour.',
    threat: 6,
    minDepth: 5,
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
  rust: {
    id: 'rust',
    tag: 'rule',
    name: 'Rust',
    glyph: '⛓',
    text: 'Only one card may be moved at a time.',
    threat: 7,
    minDepth: 9,
    excludes: ['gridlock', 'tight'],
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
    glyph: '⌐',
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
    glyph: '⛃',
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
    text: 'Three extra cards are shuffled into this level.',
    threat: 4,
    minDepth: 4,
  },
  twinned: {
    id: 'twinned',
    tag: 'board',
    name: 'Doppelgänger',
    glyph: '⧉',
    text: 'Three of your cards are duplicated into this level.',
    threat: 4,
    minDepth: 12,
  },
  steady: {
    id: 'steady',
    tag: 'meta',
    name: 'Steady Hand',
    glyph: '✋',
    text: 'No undos.',
    threat: 4,
    minDepth: 5,
    excludes: ['glass'],
  },
  toll: {
    id: 'toll',
    tag: 'rule',
    name: 'Reserve Toll',
    glyph: '⌸',
    text: 'Parking a card in the reserve costs 1 extra move.',
    threat: 4,
    minDepth: 5,
    excludes: ['tight'],
  },
  tight: {
    id: 'tight',
    tag: 'rule',
    name: 'Tight Quarters',
    glyph: '▤',
    text: 'One fewer reserve cell.',
    threat: 6,
    minDepth: 4,
    excludes: ['toll'],
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
