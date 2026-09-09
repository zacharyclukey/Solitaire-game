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
 * in five has no line at all, whatever the allowance and whatever the play. That is only
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
    text: 'Destroys the card on top of the most buried column, and grants 8 moves.',
    price: 42,
  },
  dig: {
    id: 'dig',
    name: 'Dig',
    glyph: '⇓',
    text: 'Turns the deepest face-down card of the most buried column, and grants 6 moves.',
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

/**
 * Every escape pays moves, because measurement said the moves are the part that
 * works.
 *
 * Spent when a player actually reaches for one — at a standstill — Pry and Dig
 * converted 0 of 50 lost boards, against 4% and 2% when spent at the start. The
 * reason is timing: a board goes dead at about the same moment the purse does,
 * so Pry would open a line the player could no longer afford to walk. Pairing
 * each with a grant fixes exactly that.
 *
 * The effects themselves measured as worth little beyond the moves: at a +12
 * grant, Pry, Dig and moves-alone all converted 12% of lost boards. Read that
 * carefully for Dig, though — the player model sees every face-down card, so
 * revealing one is worth precisely nothing to it, and Dig's real job cannot be
 * measured by this instrument at all. It keeps a smaller grant on the strength
 * of a purpose the bot cannot value, not on a number.
 */
export const REPRIEVE_MOVES = 8;
export const PRY_MOVES = 8;
export const DIG_MOVES = 6;

/**
 * What a card actually does for a run, measured on two independent axes so the
 * shop can say which trade it is offering.
 *
 * `pays` — banks moves or gold on an ordinary board. From `scripts/worth.ts`
 * (40 paired boards, stage 8, six copies, re-run 2026-09-09 against the
 * generator as it stands after the difficulty pass): Resonance +8.6 expected
 * moves over a bare deck, Beacon +4.8, Kickback and Featherweight +4.6. Gilded
 * is here for gold rather than moves; it measures +0.0 moves and pays 2 gold a
 * turn. The re-run was ordered because repricing Loose Weave changed which
 * modifiers get selected and had already invalidated the rescue audit: the set
 * and the order both held, and no chip changed hands.
 *
 * `saves` — measurably turns boards that were going to be lost. From
 * `scripts/enchaudit.ts 60` (76 lost boards, 2026-09-08): Ember 21%, Anchor
 * 18%, Prism 16%, Bridge 13%, Twin 12%, and Torch, Kickback, Featherweight and
 * Chameleon at 9%. The cards WITHOUT this flag manage 4% (Keystone) or a flat
 * 0% (Gilded, Beacon, Conduit, Resonance), so the split the chip draws is a
 * real gap rather than a threshold picked to suit.
 *
 * This used to read "at least one in five", which was true when the same audit
 * put Anchor at 53% and Ember at 51%. Repricing Loose Weave from boon to bane
 * changed which modifiers get selected alongside it, the boards got harder, and
 * every rescue rate roughly halved. The SET of cards that rescue did not
 * change — only the rate, and therefore the promise the chip was making.
 *
 * The two axes are close to inverse, which is the interesting part: the cards
 * that pay rescue nothing, and the cards that rescue cost about two moves a
 * board to own. Kickback and Featherweight are the only ones doing both jobs,
 * because making a move cheaper is income on a board going well and a rescue
 * when the last move is unaffordable.
 *
 * Keystone (+0.6, 4%) and Conduit (-1.5, 0%) carry neither flag: they did not
 * measure as doing either job, and Conduit now measures actively worse than
 * owning nothing rather than merely level with it.
 *
 * Keystone is the conditional case and is deliberately left unchipped rather
 * than labelled. It is now a real card on a board that restricts empty columns
 * — +8pp there — and does nothing at all on one that does not, which is about
 * 82% of deep boards. Expected across a run that is roughly +1.4pp, too thin to
 * promise anything, but it is no longer the trap it was: until Royal Gates
 * existed it had nothing to bypass, and the free-entry half it was given to
 * compensate measured at -6pp on ungated boards. See `scripts/gates.ts`. That is a balance question, not a labelling one,
 * so nothing is claimed for them here.
 */
export interface EnchantDef {
  id: EnchantId;
  name: string;
  glyph: string;
  text: string;
  rarity: Rarity;
  price: number;
  /** Banks moves or gold on an ordinary board. */
  pays?: boolean;
  /** Rescues at least one lost board in five. */
  saves?: boolean;
}

export const ENCHANTS: Record<EnchantId, EnchantDef> = {
  torch: {
    id: 'torch',
    name: 'Torch',
    glyph: '✦',
    text: 'When turned, also turns the deepest card of the most buried column.',
    rarity: 'common',
    price: 22,
    saves: true,
  },
  spring: {
    id: 'spring',
    name: 'Kickback',
    glyph: '↺',
    text: 'Refunds 1 move whenever it is placed.',
    rarity: 'common',
    price: 20,
    pays: true,
    saves: true,
  },
  free: {
    id: 'free',
    name: 'Featherweight',
    glyph: '⌁',
    text: 'Moving this card (and anything riding on it) is free.',
    rarity: 'rare',
    price: 34,
    pays: true,
    saves: true,
  },
  bridge: {
    id: 'bridge',
    name: 'Bridge',
    glyph: '⌒',
    text: 'May be placed one OR two ranks away instead of exactly one.',
    rarity: 'rare',
    price: 32,
    saves: true,
  },
  wild: {
    id: 'wild',
    name: 'Chameleon',
    glyph: '◈',
    text: 'Ignores colour and suit when being placed.',
    rarity: 'rare',
    price: 33,
    saves: true,
  },
  key: {
    id: 'key',
    name: 'Keystone',
    glyph: '⚿',
    text: 'Always allowed into an empty column, whatever the board says.',
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
    pays: true,
  },
  beacon: {
    id: 'beacon',
    name: 'Beacon',
    glyph: '☀',
    text: 'Grants 2 moves when turned, or 4 if another card turned it.',
    rarity: 'common',
    price: 26,
    pays: true,
  },
  ember: {
    id: 'ember',
    name: 'Ember',
    glyph: '✹',
    text: 'While on top of a column it may be burned away for 1 move.',
    rarity: 'rare',
    price: 30,
    saves: true,
  },
  twin: {
    id: 'twin',
    name: 'Twin',
    glyph: '❐',
    text: 'When turned, turns every face-down card of the same rank.',
    rarity: 'epic',
    price: 48,
    saves: true,
  },
  prism: {
    id: 'prism',
    name: 'Prism',
    glyph: '◇',
    text: 'Any colour or suit may be stacked on it (rank still matters).',
    rarity: 'rare',
    price: 30,
    saves: true,
  },
  conduit: {
    id: 'conduit',
    name: 'Conduit',
    glyph: '⇢',
    // The point of this card is that it reaches for other cards you chose.
    // Everything else in the set adds; a Conduit into a Torch into a Twin
    // multiplies, and a Conduit into a Conduit runs the whole chain. The chain
    // is real and implemented — flipCard recurses — but nothing measurable
    // comes out of it: +0.0 expected moves in a plain deck, +0.2 inside a dense
    // one, 0 of 43 lost boards rescued, and a Torch at half the price matches
    // it at every density tried.
    //
    // Retargeting it at the most BURIED enchanted card was tried and measured
    // worse (+0.2 -> -0.5 at density 8), for the same reason Dig rescues
    // nothing: turning a card that stays under a pile grants no legal move.
    // So the mechanic is left alone and only the price moves.
    //
    // Not cut, because one part of its value is invisible here — the player
    // model sees every face-down card, so early information is worth exactly
    // nothing to it, exactly as with Dig. Priced as a rare rather than sold as
    // an epic until a person can say whether knowing early is worth anything.
    text: 'When turned, also turns the nearest face-down enchanted card.',
    rarity: 'rare',
    price: 28,
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
    pays: true,
  },
  anchor: {
    id: 'anchor',
    name: 'Anchor',
    glyph: '⚓',
    text: 'While it is on top of a column, any card at all may be placed on it.',
    rarity: 'epic',
    price: 52,
    saves: true,
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
    text: 'The first 3 undos of every level cost nothing.',
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
    // The most expensive item in the shop, for something measured at nothing.
    // This charm is the only clean way to vary column count — it runs through
    // columnsFor and touches nothing else — so it was used as the instrument in
    // scripts/columns.ts, and the instrument answered about itself: over 60
    // boards a cell, an extra column changes nothing at all at unlimited budget
    // and is worth about -7 points at the level's own allowance. Inside the
    // noise, so "buys nothing measurable" rather than "harmful".
    //
    // Unlike Conduit there is no hidden upside to argue for: column count is
    // fully visible to the player model. Kept because a wider board is a real
    // fantasy and a person may value the room, but no longer priced as the best
    // thing in the shop.
    text: '+1 column on every level.',
    rarity: 'rare',
    price: 48,
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
  | 'heavydraw'
  | 'draw3'
  | 'royalGates'
  | 'onepass';

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
  /**
   * Priced as a bane despite reading like a gift, because it measures as one.
   *
   * Ignoring colour strictly ADDS legal placements, so a perfect solver finds
   * this easier or equal. A bounded player does not: the branching factor
   * jumps and most of the new moves are bad ones that spend a move and bury a
   * card — the same mechanism that makes Anchor the best rescuer and the worst
   * card to own. Measured on 24 identical boards with the rule flipped in place
   * and the budget removed, the fallible player clears 96% of them plain and
   * 79% under Loose Weave, and a search three times wider recovers none of it
   * (75/79/79 at widths 4/14/30).
   *
   * It sat at threat -4 for a long time, which paid the player LESS allowance
   * for a board that is harder to play. +5 is Suit Lock's 8 scaled by the
   * penalty each one costs (25 points against 17). minDepth moved with it: a
   * bane of this size has no business opening on stage 1.
   */
  anyColor: {
    id: 'anyColor',
    tag: 'rule',
    name: 'Loose Weave',
    glyph: '◍',
    text: 'Colour is ignored — only rank matters.',
    threat: 5,
    minDepth: 3,
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
    text: 'Undos cost 2 moves instead of 1.',
    threat: 3,
    minDepth: 4,
    excludes: ['steady'],
  },

  /*
   * The solitaire variations.
   *
   * `drawCount`, `empty`, `groups` and `passes` are RuleSet fields the sim has
   * always honoured — `applyMove`, `canPlaceEmpty` and `runStart` read every
   * one of them — and not one had ever been wired to a modifier, so every board
   * in the game played standard Klondike on all four axes. Two items were
   * collateral damage: Keystone's whole effect is bypassing empty-column
   * restrictions ("under standard rules there are none to bypass — measured, it
   * saved 0 of 19 lost boards") and Locksmith, a 60-gold rare, set `empty` to
   * the value it already had. Both now have something to bypass.
   *
   * Threats are measured, not guessed. `scripts/rulecost.ts` flips each rule in
   * place on a clone of the same board — dealing the arms separately lets the
   * win-chance selector cancel the effect — at three search widths, stage 14,
   * 24 boards, against a 92% control:
   *
   *   Three at a Time   75/79/79%   -13 to -17pp
   *   Royal Gates @4    79/83/83%    -9 to -13pp
   *   One Pass @0       83/83/83%    -9pp
   *
   * Three more were written and cut on the measurement rather than shipped:
   *
   *   Sealed Vaults      0/0/0%     -92pp   nothing may enter an empty column
   *   Rust               4/8/8%     -84pp   no group moves
   *   One Pass @1       92/92/92%     0pp   one recycle instead of two
   *
   * Empty columns are the only true sink in this game and carrying a run as a
   * group is how the sink gets used, so the first two do not add difficulty,
   * they remove the game; `tests/economy.test.ts` guards against either coming
   * back. The third is the opposite failure — a modifier that reads as a
   * restriction and costs exactly nothing — which is why One Pass ships at
   * `passes: 0` rather than the 1 it was written with.
   */
  draw3: {
    id: 'draw3',
    tag: 'rule',
    name: 'Three at a Time',
    glyph: '⋮',
    text: 'The draw turns three cards at once, and only the top one can be played.',
    threat: 7,
    minDepth: 3,
    excludes: ['heavydraw'],
  },
  royalGates: {
    id: 'royalGates',
    tag: 'rule',
    name: 'Royal Gates',
    glyph: '⛩',
    text: 'Only the five highest ranks may start an empty column.',
    threat: 6,
    minDepth: 8,
    // Alone this is a -12pp rule, which is what it is priced at. Stacked on a
    // board that is already paying for its draws it is not: measured at stage
    // 10 on 16 boards with unlimited budget, rush+heavydraw+dense clears 11/16,
    // and adding Royal Gates takes that to 5/16 while Royal Gates by itself
    // costs 14/16. Restricting the empty-column sink and doubling the price of
    // looking for something to put in one are the same tax twice.
    excludes: ['heavydraw'],
  },
  onepass: {
    id: 'onepass',
    tag: 'rule',
    name: 'One Pass',
    glyph: '⟳',
    text: 'The draw pile may be turned over once and never recycled.',
    threat: 5,
    minDepth: 6,
  },
};

export const MODIFIER_LIST: ModifierDef[] = Object.values(MODIFIERS);

/** Modifiers that help the player; used to seed "gift" nodes on the map. */
export const BOON_IDS: ModifierId[] = MODIFIER_LIST.filter((m) => m.threat < 0).map((m) => m.id);
export const BANE_IDS: ModifierId[] = MODIFIER_LIST.filter((m) => m.threat > 0).map((m) => m.id);
