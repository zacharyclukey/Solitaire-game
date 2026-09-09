/**
 * Run structure: the fork-in-the-road map, rewards, the shop and the deck the
 * player carries between levels.
 *
 * Everything is derived from a single run seed plus the current depth, so a run
 * can be saved as a small JSON blob and rebuilt exactly.
 */
import {
  BANE_IDS,
  CHARMS,
  CONSUMABLE_LIST,
  CONSUMABLES,
  ENCHANTS,
  ENCHANT_LIST,
  MODIFIERS,
  MODIFIER_LIST,
  type CharmId,
  type ConsumableId,
  type ModifierId,
  type Rarity,
} from './content.ts';
import type { LevelSpec, NodeKind } from './deal.ts';
import { Rng } from './rng.ts';
import type { CurseId, DeckCard, EnchantId, Suit } from './types.ts';

export const MIN_DECK = 16;
/**
 * The most cards a deck may hold.
 *
 * Measured, and it is a cliff rather than a slope. Holding the stage fixed and
 * growing the deck the way the game actually grows it, a bounded-lookahead
 * player with unlimited moves clears 12 of 12 boards at 28 cards, 8 of 12 at
 * 31, 2 of 12 at 34 and none at 46. With no foundations the only sink is an
 * empty column, and a deck spread thinly over more ranks stops offering the
 * alternating card one rank down that a descending run needs.
 *
 * Capping the board instead of the deck was tried and measured no different,
 * because dealing a subset only thins the rank ladder further. The deck itself
 * has to stay near the size the game works at, so growth is a real but bounded
 * choice rather than a slow way to lose.
 */
export const MAX_DECK = 32;
export const BOSS_EVERY = 5;
export const SHOP_EVERY = 3;

export interface RunStats {
  movesSpent: number;
  cardsTurned: number;
  levelsCleared: number;
  goldEarned: number;
  /**
   * Moves saved against par, totalled over the run.
   *
   * Beating par used to grant +1 to `bonusMoves`, which rides on top of every
   * future stipend — a permanent allowance raise, awarded on most levels to
   * anyone playing well, compounding for the rest of the run. Skill was buying
   * immunity from the difficulty curve instead of a score. It pays here now,
   * where it is worth something on the scoreboard and nothing at the table.
   */
  finesse: number;
}

export type Phase = 'queue' | 'level' | 'reward' | 'shop' | 'over';

export interface RunState {
  seed: number;
  daily: boolean;
  /** Levels cleared. This is the score. */
  depth: number;
  /**
   * Levels faced, cleared or skipped. Difficulty keys off this, so ducking a
   * board buys you a buff without buying you any respite.
   */
  stage: number;
  deck: DeckCard[];
  charms: CharmId[];
  gold: number;
  /**
   * Moves carried between levels. This, not any single board, is what a run
   * actually is: every move a level does not take is one the next level does
   * not have to fund.
   */
  bank: number;
  /**
   * Single-use escapes in hand. Deals are honest shuffles, so a board can be
   * genuinely lost; these are what make that a roguelite rather than bad luck.
   */
  consumables: Partial<Record<ConsumableId, number>>;
  bonusMoves: number;
  bonusCells: number;
  /** Skips taken since the last cleared level. They pay nothing until one is. */
  skipsPending: number;
  /** Boards walked past, waiting to resurface. Nothing is really avoided. */
  sunken: SunkenBoard[];
  /** Skips that a clear has since vouched for, waiting on the next market. */
  marketCredit: number;
  nextUid: number;
  secondWind: boolean; // charm available and unused
  phase: Phase;
  current: LevelSpec | null;
  /** Moves played in the current level, for save/resume by replay. */
  levelMoves: { kind: string; from: number; fromIdx: number; to: number; cost: number }[];
  /**
   * Fingerprint of the board those moves were played on.
   *
   * A resume re-deals from the spec and replays `levelMoves` into the result,
   * but the dealt board is not a pure function of the spec: `dealLevel` picks
   * its layout by win chance against the allowance, so the SAME spec and seed
   * deal a different board when the allowance changes. Every balance pass moves
   * the allowance, which means every balance pass silently invalidates the
   * mid-level saves already on players' devices — and `applyMove` does not
   * check legality, so the old moves were smeared onto the new layout, moving
   * cards that were not there and splicing at indices past the end.
   *
   * Null on a save written before this field existed, which is the correct
   * answer for those saves too: they cannot be trusted either.
   */
  levelKey: string | null;
  rewards: Reward[];
  shop: ShopItem[];
  stats: RunStats;
  score: number;
}

/* ------------------------------------------------------------------ seeds */

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function subSeed(seed: number, depth: number, salt: number): number {
  return mix(mix(seed, depth * 2654435761), salt);
}

/* ------------------------------------------------------------- starter kit */

export function starterDeck(): DeckCard[] {
  const deck: DeckCard[] = [];
  let uid = 1;
  for (let rank = 1; rank <= 7; rank++) {
    for (let suit = 0 as Suit; suit < 4; suit++) {
      deck.push({ uid: uid++, rank, suit: suit as Suit, ench: null, curse: null });
    }
  }
  return deck;
}

export function newRun(seed: number, daily = false): RunState {
  const deck = starterDeck();
  const run: RunState = {
    seed,
    daily,
    depth: 0,
    stage: 0,
    deck,
    charms: [],
    gold: 0,
    bank: 0,
    consumables: {},
    bonusMoves: 0,
    bonusCells: 0,
    skipsPending: 0,
    sunken: [],
    marketCredit: 0,
    nextUid: deck.length + 1,
    secondWind: false,
    phase: 'queue',
    current: null,
    levelMoves: [],
    levelKey: null,
    rewards: [],
    shop: [],
    stats: { movesSpent: 0, cardsTurned: 0, levelsCleared: 0, goldEarned: 0, finesse: 0 },
    score: 0,
  };
  return run;
}

/* --------------------------------------------------------------- modifiers */

function conflicts(id: ModifierId, chosen: ModifierId[]): boolean {
  const m = MODIFIERS[id];
  if (m.excludes?.some((x) => chosen.includes(x))) return true;
  return chosen.some((c) => MODIFIERS[c].excludes?.includes(id));
}

function pickModifiers(
  rng: Rng,
  depth: number,
  targetThreat: number,
  maxCount: number,
  allowBoon: boolean,
  maxRules = 1,
  maxBoard = 2,
  minCount = 0,
): ModifierId[] {
  const chosen: ModifierId[] = [];
  let threat = 0;
  let rules = 0;
  let board = 0;

  if (allowBoon && rng.next() < 0.55) {
    const boons = (['wide', 'anyColor', 'bounty', 'rich'] as ModifierId[]).filter(
      (id) => MODIFIERS[id].minDepth <= depth,
    );
    const b = rng.pick(boons);
    chosen.push(b);
    if (MODIFIERS[b].tag === 'rule') rules++;
    if (MODIFIERS[b].tag === 'board') board++;
    threat += MODIFIERS[b].threat;
  }

  let guard = 0;
  while (chosen.length < maxCount && threat < targetThreat && guard++ < 24) {
    const cands = BANE_IDS.filter(
      (id) =>
        MODIFIERS[id].minDepth <= depth &&
        !chosen.includes(id) &&
        !conflicts(id, chosen) &&
        (MODIFIERS[id].tag !== 'rule' || rules < maxRules) &&
        // Board modifiers are the ones that add cards and curses. Stacking
        // three or four of them is what forced the deep game to be eased.
        (MODIFIERS[id].tag !== 'board' || board < maxBoard),
    );
    if (cands.length === 0) break;
    const entries = cands.map((id) => {
      const after = threat + MODIFIERS[id].threat;
      return { item: id, weight: 1 / (1 + Math.abs(after - targetThreat)) };
    });
    const pick = rng.weighted(entries)!;
    chosen.push(pick);
    if (MODIFIERS[pick].tag === 'rule') rules++;
    if (MODIFIERS[pick].tag === 'board') board++;
    threat += MODIFIERS[pick].threat;
  }

  /*
   * Texture, once the threat budget is met.
   *
   * The loop above stops the moment `threat >= targetThreat`, so a board's
   * whole character came down to two or three heavy modifiers and most levels
   * looked like most other levels. This tops the board up to `minCount` with
   * the cheapest thing still legal, so a board reads as more distinctive
   * without being priced much harder — the threat it does add is most of the
   * way compensated in `stipendFor`.
   *
   * Cheapest by threat, NOT by absolute threat. Ranking on `Math.abs` put the
   * -2 and -3 boons at the front of the queue, so every board in the game
   * picked up Bounty or Riches and the texture pass quietly became a gold
   * faucet — directly against the balance change it shipped alongside. Boons
   * are the fallback here, not the default.
   */
  guard = 0;
  while (chosen.length < minCount && guard++ < 24) {
    const legal = MODIFIER_LIST.filter(
      (m) =>
        m.minDepth <= depth &&
        !chosen.includes(m.id) &&
        !conflicts(m.id, chosen) &&
        (m.tag !== 'rule' || rules < maxRules) &&
        (m.tag !== 'board' || board < maxBoard),
    );
    if (legal.length === 0) break;
    const banes = legal.filter((m) => m.threat > 0);
    const cands = banes.length ? banes : legal;
    const cheapest = Math.min(...cands.map((m) => m.threat));
    const pick = rng.pick(cands.filter((m) => m.threat === cheapest));
    chosen.push(pick.id);
    if (pick.tag === 'rule') rules++;
    if (pick.tag === 'board') board++;
    threat += pick.threat;
  }
  return chosen;
}

/**
 * How many rule-changing modifiers a board may carry.
 *
 * This was fixed at one for every stage, and it is the reason depth only ever
 * made a board more expensive rather than harder: rule modifiers are the ones
 * that change how the board has to be played, and a deep board could never have
 * more than a single one. Measured, they are also close to free — the isolate
 * sweep put Inversion, Tithe, Low Ceiling, Frost, Shroud, Heavy Draw and
 * Glasswork all at about 0pp against a 92% control, while the modifiers that
 * genuinely hurt are the ones that take away columns or shrink the draw pile.
 *
 * So depth buys more of the interesting kind. The sink-removers are held back
 * by their own exclusions and threat costs instead.
 */
function maxRulesFor(depth: number): number {
  if (depth <= 6) return 1;
  if (depth <= 13) return 2;
  return 3;
}

function maxModsFor(depth: number): number {
  if (depth <= 2) return 1;
  if (depth <= 6) return 2;
  if (depth <= 12) return 3;
  if (depth <= 19) return 4;
  return 5;
}

/**
 * The stage that sits at a given point in the run.
 *
 * Deterministic from the run seed, so the whole queue can be read ahead — and
 * the Warden at the end of a stretch can be shown from the moment the stretch
 * begins, which is the point: you are meant to be building towards it.
 */
export function stageSpec(run: RunState, stage: number): LevelSpec {
  // A board you ducked is still down there, and it surfaces on schedule — the
  // same deal, at a deeper stage, with less room to afford it.
  const risen = run.sunken.find((b) => b.at === stage);
  if (risen) return { ...risen.spec, stage, kind: 'sunken' };

  const rng = new Rng(subSeed(run.seed, stage, 0x5f0));

  if (stage % BOSS_EVERY === 0) {
    return {
      stage,
      kind: 'boss',
      // A Warden never takes a second placement rule. Raising its threat
      // target to compensate was tried and measured worse: with fewer slots
      // the picker simply reaches for the heaviest modifiers it has.
      modifiers: pickModifiers(rng, stage, stage * 1.35 + 6, maxModsFor(stage) + 1, false, maxRulesFor(stage), 3),
      seed: subSeed(run.seed, stage, 0xb055),
    };
  }

  // Every third stage runs hot: worse rules, but a skip worth taking.
  const hot = stage % 3 === 0;
  const target = stage * 1.05 + 1 + (hot ? 5 : 0);
  const cap = maxModsFor(stage) + (hot ? 1 : 0);
  // A gauntlet should LOOK like one before it is played. It already carried a
  // heavier threat target, but threat buys two or three big modifiers and the
  // board still read like an ordinary one, so the floor is what makes it
  // distinct. Ordinary boards get a floor too, one lower, because a bare board
  // at stage 4 is a board with nothing to say.
  //
  // Held back at the very start. Measured, a flat floor did its work in exactly
  // the wrong place: stages 5 to 13 came out identical with and without it,
  // while stage 3 fell from 63% to 42% and stage 1 from 83% to 75%. Deep boards
  // already carry enough threat to reach the floor on their own, so all a flat
  // number bought was a wall in the first three levels — and the opening is
  // where a loss feels least like a near miss.
  const early = stage <= 3;
  const floor = Math.min(cap, hot ? (early ? 2 : 3) : early ? 1 : 2);
  return {
    stage,
    kind: hot ? 'gauntlet' : 'trial',
    modifiers: pickModifiers(rng, stage, target, cap, !hot && rng.next() < 0.4, maxRulesFor(stage), 2, floor),
    seed: subSeed(run.seed, stage, 2),
  };
}

/** A board that was walked past, and the stage it comes back at. */
export interface SunkenBoard {
  spec: LevelSpec;
  at: number;
}

/** How far down a skipped board sinks before it surfaces again. */
export const SINK_DEPTH = 3;

export interface QueuedStage {
  spec: LevelSpec;
  /** Whether this one can be walked past. Wardens cannot. */
  canSkip: boolean;
}

/**
 * Whether a stage can be walked past. Wardens have to be faced, so does the
 * opening board — and so does a board that has already come back for you.
 */
export function skippable(run: RunState, stage: number): boolean {
  if (stage % BOSS_EVERY === 0 || stage <= 1) return false;
  return !run.sunken.some((b) => b.at === stage);
}

/** The next few stages, read-ahead so the run can actually be planned. */
export function makeQueue(run: RunState, ahead = 3): QueuedStage[] {
  const out: QueuedStage[] = [];
  for (let i = 1; i <= ahead; i++) {
    const stage = run.stage + i;
    out.push({ spec: stageSpec(run, stage), canSkip: skippable(run, stage) });
  }
  return out;
}

/** The next Warden, so a whole stretch can be played towards it. */
export function nextWarden(run: RunState): LevelSpec {
  const stage = (Math.floor(run.stage / BOSS_EVERY) + 1) * BOSS_EVERY;
  return stageSpec(run, stage);
}

/* ----------------------------------------------------------------- rewards */

export type Reward =
  | { t: 'gold'; n: number }
  | { t: 'ench'; ench: EnchantId }
  | { t: 'add'; card: DeckCard }
  | { t: 'remove' }
  | { t: 'uncurse' }
  | { t: 'charm'; id: CharmId }
  | { t: 'moves'; n: number }
  | { t: 'cell' }
  | { t: 'bargain'; n: number };

function rarityWeight(r: Rarity, depth: number): number {
  if (r === 'common') return 60;
  if (r === 'rare') return 22 + depth * 1.5;
  return 5 + depth * 1.2;
}

/** Every (rank, suit) the deck already holds, keyed as `rank * 4 + suit`. */
function heldPairs(deck: DeckCard[]): Set<number> {
  return new Set(deck.map((c) => c.rank * 4 + c.suit));
}

/** The suits still missing at a rank. Empty means the rank is full. */
function freeSuits(held: Set<number>, rank: number): Suit[] {
  const out: Suit[] = [];
  for (let s = 0; s < 4; s++) if (!held.has(rank * 4 + s)) out.push(s as Suit);
  return out;
}

/**
 * Ranks that can take another card without duplicating one you already hold.
 *
 * `allowNext` decides whether the rung above the ladder's top counts, which is
 * how the footing rule below stays in force even on the fallback path.
 */
function openRanks(held: Set<number>, hi: number, allowNext = true): number[] {
  const out: number[] = [];
  const top = allowNext ? Math.min(13, hi + 1) : hi;
  for (let r = 1; r <= top; r++) if (freeSuits(held, r).length) out.push(r);
  return out;
}

/**
 * Where the next card the deck gains should sit.
 *
 * Shared by ordinary adds and by tributes so the two cannot drift into
 * competing growth policies — a tribute that always opened a fresh rung undid
 * the footing rule on the three levels it fired.
 */
function growthRank(deck: DeckCard[], rng: Rng): number {
  const held = heldPairs(deck);
  const hi = Math.max(...deck.map((c) => c.rank));
  const footed = 4 - freeSuits(held, hi).length >= LADDER_FOOTING;
  const canExtend = hi < 13 && footed && freeSuits(held, hi + 1).length > 0;
  if (canExtend && rng.next() < 0.65) return hi + 1;
  const open = openRanks(held, hi, canExtend);
  if (open.length > 0) return rng.pick(open);
  // Every rank up to the ladder's top is full in all four suits. Unreachable
  // under MAX_DECK, which is far short of a full 52, but a duplicate beats
  // returning nothing to a reward screen that has to offer something.
  return rng.range(1, hi);
}

/**
 * A card the deck does not already contain.
 *
 * The old version picked a rank (`hi + 1` at 65%, otherwise anywhere from 1 to
 * `hi`) and then a suit at random, which meant the fill-in branch could only
 * ever land on a rank the deck already held — and since the suit was a free
 * roll, it handed out exact duplicates: a second 7 of spades in the same deck.
 * Measured over 300 runs, 34% of every add offered was a card already in hand,
 * and a tribute screen averaged 1.4 of its four options being duplicates. The
 * starting deck is ranks 1-7 in all four suits, so at the beginning of a run
 * every fill-in was a duplicate.
 *
 * Growth is still ladder-first — higher ranks are the scarce resource, being
 * the only legal column bases — but the fill-in branch now thickens a rank that
 * has room rather than restating one that does not. Adding 8 of spades opens
 * three more places at rank 8; removing a card reopens the place it left.
 *
 * It builds up before it builds out. Extending on every roll produced decks
 * shaped `A-7 x4, 8 x1, 9 x1, 10 x1, J x1` — a thin spike of singleton high
 * ranks, which is precisely what MAX_DECK exists to prevent: "a deck spread
 * thinly over more ranks stops offering the alternating card one rank down that
 * a descending run needs". Duplicates used to hide this by thickening the
 * bottom of the ladder. So the top rung has to be half-populated before the
 * next one opens, and four cards of growth buy two usable ranks instead of four
 * unusable ones.
 */
const LADDER_FOOTING = 2;

/**
 * One card of deck growth, as the game would add it.
 *
 * Exported for the measurement harnesses. `scripts/build.ts` and
 * `scripts/humanrun.ts` each carried their own copy of this under the comment
 * "Mirrors run.ts's newCard, which is not exported" — and both copies went
 * stale the moment the growth rule changed, which is how a deck full of exact
 * duplicates ended up behind two figures in ECONOMY.md. A copy of a rule is a
 * copy of the rule as it was on the day it was written.
 */
export function growCard(deck: DeckCard[], rng: Rng, uid: number): DeckCard {
  const rank = growthRank(deck, rng);
  const suits = freeSuits(heldPairs(deck), rank);
  return {
    uid,
    rank,
    suit: suits.length > 0 ? rng.pick(suits) : (rng.int(4) as Suit),
    ench: null,
    curse: null,
  };
}

function newCard(run: RunState, rng: Rng, withEnch: boolean): DeckCard {
  const card = growCard(run.deck, rng, run.nextUid++);
  if (withEnch) {
    card.ench = rng.weighted(
      ENCHANT_LIST.map((e) => ({ item: e.id, weight: rarityWeight(e.rarity, run.stage) })),
    )!;
  }
  return card;
}

function ownedCharms(run: RunState): Set<CharmId> {
  return new Set(run.charms);
}

function randomCharm(run: RunState, rng: Rng): CharmId | null {
  const owned = ownedCharms(run);
  const pool = Object.values(CHARMS).filter((c) => !owned.has(c.id));
  if (!pool.length) return null;
  return rng.weighted(pool.map((c) => ({ item: c.id, weight: rarityWeight(c.rarity, run.stage) })));
}

export function makeRewards(run: RunState, kind: NodeKind, count: number): Reward[] {
  const rng = new Rng(subSeed(run.seed, run.stage, 0x4ee));
  const out: Reward[] = [];
  const used = new Set<string>();
  const rich = kind === 'gauntlet' || kind === 'boss';

  const push = (r: Reward | null): void => {
    if (!r) return;
    const key = r.t === 'ench' ? `ench:${r.ench}` : r.t === 'charm' ? `charm:${r.id}` : r.t;
    if (used.has(key)) return;
    used.add(key);
    out.push(r);
  };

  // Mandatory growth. Thinning measured as strictly the best play — capping
  // deck growth raised mean run depth from 3.3 to 4.6, the largest effect
  // measured anywhere in this project — so "remove a card" was the answer to
  // every reward screen and there was no decision left in it. Every third
  // level the deck HAS to grow, and the only question is where the card lands.
  //
  // It is not a pure tax. The card always arrives enchanted, and the four
  // options are the same rank and the same enchantment in the four suits, so
  // the choice is a real one about which colour and suit the deck can absorb —
  // and about which suit you want that particular effect riding on.
  //
  // Written straight into `out` because `push` dedupes on reward type and
  // would collapse the four suits into one option.
  if (tributeDue(run)) {
    // One rank, every suit of it the deck has room for. Usually four; fewer
    // when the growth policy sends the card to a rung already part-built,
    // which is still a choice and still beats offering a card you own.
    const rank = growthRank(run.deck, rng);
    const suits = freeSuits(heldPairs(run.deck), rank);
    const base = newCard(run, rng, true);
    for (const suit of suits) {
      out.push({ t: 'add', card: { ...base, uid: run.nextUid++, rank, suit } });
    }
    return out;
  }

  if (kind === 'boss') push({ t: 'charm', id: randomCharm(run, rng) ?? 'sleeve' });

  let guard = 0;
  while (out.length < count && guard++ < 40) {
    const roll = rng.next();
    if (roll < 0.3) {
      push({
        t: 'ench',
        ench: rng.weighted(
          ENCHANT_LIST.map((e) => ({ item: e.id, weight: rarityWeight(e.rarity, run.stage) })),
        )!,
      });
    } else if (roll < 0.46) {
      if (run.deck.length < MAX_DECK) push({ t: 'add', card: newCard(run, rng, rng.next() < (rich ? 0.85 : 0.5)) });
    } else if (roll < 0.6) {
      if (run.deck.length > MIN_DECK) push({ t: 'remove' });
    } else if (roll < 0.66) {
      push({ t: 'moves', n: rich ? 3 : 2 });
    } else if (roll < 0.72) {
      if (run.bonusCells < 2) push({ t: 'cell' });
    } else if (roll < 0.8) {
      push({ t: 'gold', n: Math.round((28 + run.stage * 5) * (rich ? 1.6 : 1)) });
    } else if (roll < 0.88) {
      if (run.deck.some((c) => c.curse)) push({ t: 'uncurse' });
    } else if (roll < 0.95) {
      const c = randomCharm(run, rng);
      if (c && (rich || rng.next() < 0.5)) push({ t: 'charm', id: c });
    } else {
      push({ t: 'bargain', n: Math.round(60 + run.stage * 8) });
    }
  }
  return out.slice(0, count);
}

/** Most skips a single market will honour, so a shop cannot become a catalogue. */
export const MAX_MARKET_CREDIT = 3;

/** Levels between forced deck growth. See the note in `makeRewards`. */
export const TRIBUTE_EVERY = 3;

/**
 * Whether this level's rewards are the forced-growth kind.
 *
 * Exported so the reward screen's copy asks the same question `makeRewards`
 * did, rather than sniffing the shape of the list it produced.
 *
 * A deck already at `MAX_DECK` is exempt. That cap is a measured cliff, not a
 * soft ceiling — a bounded-lookahead player clears 8 of 12 boards at 31 cards
 * and 2 of 12 at 34 — so growth stops there and the ordinary reward roll comes
 * back. The tribute exists to stop thinning being free, not to push a deck
 * past the size the game works at.
 */
export function tributeDue(run: RunState): boolean {
  if (run.depth === 0 || run.depth % TRIBUTE_EVERY !== 0) return false;
  if (run.deck.length >= MAX_DECK) return false;
  // Nowhere to put a card that is not already in the deck. Unreachable under
  // MAX_DECK, but a tribute screen with no options would be a dead end.
  const held = heldPairs(run.deck);
  return openRanks(held, Math.max(...run.deck.map((c) => c.rank))).length > 0;
}

/**
 * Walking past a stage.
 *
 * It pays nothing now. The stage counter moves, so the next board is harder;
 * the score does not, so the level is gone. What it leaves behind is a debt the
 * market owes you — and the market only honours it once you have cleared a
 * board. Skipping is a wager on your own survival, not a payout.
 */
/**
 * Where the board in front of you would resurface if you skipped it.
 *
 * Exported because the queue screen promises the player a specific stage
 * number, and a promise computed separately from the move that fulfils it is a
 * promise that drifts. Both callers use this.
 *
 * A berth is never a Warden's stage and never on top of another sunken board.
 */
export function sinkTarget(run: RunState): number {
  let at = run.stage + 1 + SINK_DEPTH;
  while (at % BOSS_EVERY === 0 || run.sunken.some((b) => b.at === at)) at += 1;
  return at;
}

/** True when a skip taken now would actually earn a market item. */
export function skipWouldPay(run: RunState): boolean {
  return run.marketCredit + run.skipsPending < MAX_MARKET_CREDIT;
}

export function takeSkip(run: RunState): void {
  const stage = run.stage + 1;
  const spec = stageSpec(run, stage);
  run.sunken.push({ spec, at: sinkTarget(run) });
  run.stage = stage;
  run.skipsPending += 1;
}

/** Drops a board off the sunken list once it has been faced. */
export function clearSunken(run: RunState, stage: number): void {
  run.sunken = run.sunken.filter((b) => b.at !== stage);
}

/** Clearing a stage: both counters move, and any skips you took are vouched for. */
export function bankStage(run: RunState): void {
  run.stage += 1;
  run.depth += 1;
  run.marketCredit = Math.min(MAX_MARKET_CREDIT, run.marketCredit + run.skipsPending);
  run.skipsPending = 0;
}

export function rewardCount(run: RunState, kind: NodeKind): number {
  let n = 3;
  if (kind === 'boss') n = 4;
  if (run.charms.includes('pockets')) n += 1;
  return n;
}

/* -------------------------------------------------------------- mutations */

export function gainGold(run: RunState, n: number): number {
  const mult = run.charms.includes('ring') ? 1.5 : 1;
  const amount = Math.round(n * mult);
  run.gold += amount;
  run.stats.goldEarned += amount;
  return amount;
}

export function enchantCard(run: RunState, uid: number, ench: EnchantId): void {
  const c = run.deck.find((x) => x.uid === uid);
  if (c) c.ench = ench;
}

export function removeCard(run: RunState, uid: number): void {
  if (run.deck.length <= MIN_DECK) return;
  run.deck = run.deck.filter((c) => c.uid !== uid);
}

export function uncurseCard(run: RunState, uid: number): void {
  const c = run.deck.find((x) => x.uid === uid);
  if (c) c.curse = null;
}

export function addCard(run: RunState, card: DeckCard): void {
  if (run.deck.length >= MAX_DECK) return;
  run.deck.push(card);
}

export function curseRandomCard(run: RunState, rng: Rng): DeckCard | null {
  const pool = run.deck.filter((c) => !c.curse);
  if (!pool.length) return null;
  const c = rng.pick(pool);
  c.curse = rng.pick<CurseId>(['heavy', 'frozen', 'stuck', 'dim']);
  return c;
}

export function addCharm(run: RunState, id: CharmId): void {
  if (!run.charms.includes(id)) {
    run.charms.push(id);
    if (id === 'secondwind') run.secondWind = true;
  }
}

/** Rewards that need the player to choose a card first. */
export function rewardNeedsTarget(r: Reward): 'ench' | 'remove' | 'uncurse' | null {
  if (r.t === 'ench') return 'ench';
  if (r.t === 'remove') return 'remove';
  if (r.t === 'uncurse') return 'uncurse';
  return null;
}

/* -------------------------------------------------------------------- shop */

export type ShopItem =
  | { t: 'ench'; ench: EnchantId; price: number; sold?: boolean }
  | { t: 'charm'; id: CharmId; price: number; sold?: boolean }
  | { t: 'add'; card: DeckCard; price: number; sold?: boolean }
  | { t: 'remove'; price: number; sold?: boolean }
  | { t: 'uncurse'; price: number; sold?: boolean }
  | { t: 'item'; id: ConsumableId; price: number; sold?: boolean }
  | { t: 'moves'; n: number; price: number; sold?: boolean }
  | { t: 'cell'; price: number; sold?: boolean };

/** Set aside by the market for a board you walked past and later made good on. */
export type StockedItem = ShopItem & { setAside?: boolean };

export function makeShop(run: RunState): StockedItem[] {
  const rng = new Rng(subSeed(run.seed, run.stage, 0x5409));
  const items: ShopItem[] = [];
  const priceScale = 1 + run.stage * 0.045;
  const p = (n: number): number => Math.round(n * priceScale);

  for (let i = 0; i < 2; i++) {
    const e = rng.weighted(
      ENCHANT_LIST.map((x) => ({ item: x.id, weight: rarityWeight(x.rarity, run.stage) })),
    )!;
    if (!items.some((it) => it.t === 'ench' && it.ench === e)) {
      items.push({ t: 'ench', ench: e, price: p(ENCHANTS[e].price) });
    }
  }
  const charm = randomCharm(run, rng);
  if (charm) items.push({ t: 'charm', id: charm, price: p(CHARMS[charm].price) });
  if (run.deck.length < MAX_DECK) items.push({ t: 'add', card: newCard(run, rng, true), price: p(40) });
  items.push({ t: 'remove', price: p(run.charms.includes('scalpel') ? 16 : 32) });
  if (run.deck.some((c) => c.curse)) items.push({ t: 'uncurse', price: p(26) });
  items.push({ t: 'moves', n: 2, price: p(45) });
  // Always an escape on the shelf. A player who cannot buy their way out of a
  // dead board has no answer to the one deal in five that has no line, and the
  // whole design rests on that being survivable.
  {
    const c = rng.pick(CONSUMABLE_LIST);
    items.push({ t: 'item', id: c.id, price: p(c.price) });
  }
  if (run.bonusCells < 2) items.push({ t: 'cell', price: p(110) });

  // What the market owes you for the boards you walked past and then made good
  // on: one extra piece of stock each, from the better shelf, at half price.
  const owed: StockedItem[] = [];
  for (let i = 0; i < run.marketCredit; i++) {
    const charm = randomCharm(run, rng);
    const takeCharm = charm && rng.next() < 0.4;
    const item: StockedItem = takeCharm
      ? { t: 'charm', id: charm!, price: Math.round(p(CHARMS[charm!].price) / 2) }
      : (() => {
          const e = rng.weighted(
            ENCHANT_LIST.map((x) => ({ item: x.id, weight: rarityWeight(x.rarity, run.stage + 6) })),
          )!;
          return { t: 'ench', ench: e, price: Math.round(p(ENCHANTS[e].price) / 2) };
        })();
    item.setAside = true;
    owed.push(item);
  }
  return [...owed, ...items];
}

export function shopLabel(item: ShopItem): string {
  switch (item.t) {
    case 'item':
      return CONSUMABLES[item.id].name;
    case 'ench':
      return ENCHANTS[item.ench].name;
    case 'charm':
      return CHARMS[item.id].name;
    case 'add':
      return 'New card';
    case 'remove':
      return 'Remove a card';
    case 'uncurse':
      return 'Lift a curse';
    case 'moves':
      return `+${item.n} moves, permanently`;
    case 'cell':
      // `bonusCells` is a legacy field name — it is persisted in saves, so it
      // stays. What it actually buys is a card moved out of the tableau and
      // into the draw pile, which is what the player must be told.
      return '+1 card in the draw pile';
  }
}

/* ---------------------------------------------------------------- scoring */

export function computeScore(run: RunState): number {
  const deckPower = run.deck.reduce((n, c) => n + (c.ench ? 8 : 0) - (c.curse ? 4 : 0), 0);
  return (
    run.depth * 1000 +
    run.stats.cardsTurned * 3 +
    run.gold +
    run.charms.length * 25 +
    run.stats.finesse * 12 +
    run.bonusCells * 40 +
    deckPower
  );
}

export function deckSummary(deck: DeckCard[]): { enchanted: number; cursed: number; size: number } {
  return {
    size: deck.length,
    enchanted: deck.filter((c) => c.ench).length,
    cursed: deck.filter((c) => c.curse).length,
  };
}
