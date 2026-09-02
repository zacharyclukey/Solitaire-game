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
  ENCHANTS,
  ENCHANT_LIST,
  MODIFIERS,
  type CharmId,
  type ModifierId,
  type Rarity,
} from './content.ts';
import type { LevelSpec, NodeKind } from './deal.ts';
import { Rng } from './rng.ts';
import type { CurseId, DeckCard, EnchantId, Suit } from './types.ts';

export const MIN_DECK = 16;
export const MAX_DECK = 48;
export const BOSS_EVERY = 5;
export const SHOP_EVERY = 3;

export interface RunStats {
  movesSpent: number;
  cardsTurned: number;
  levelsCleared: number;
  goldEarned: number;
}

export type Phase = 'fork' | 'level' | 'reward' | 'shop' | 'over';

export interface RunState {
  seed: number;
  daily: boolean;
  depth: number; // levels cleared so far
  deck: DeckCard[];
  charms: CharmId[];
  gold: number;
  bonusMoves: number;
  bonusCells: number;
  nextUid: number;
  secondWind: boolean; // charm available and unused
  phase: Phase;
  fork: LevelSpec[];
  current: LevelSpec | null;
  /** Moves played in the current level, for save/resume by replay. */
  levelMoves: { kind: string; from: number; fromIdx: number; to: number; cost: number }[];
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
    deck,
    charms: [],
    gold: 0,
    bonusMoves: 0,
    bonusCells: 0,
    nextUid: deck.length + 1,
    secondWind: false,
    phase: 'fork',
    fork: [],
    current: null,
    levelMoves: [],
    rewards: [],
    shop: [],
    stats: { movesSpent: 0, cardsTurned: 0, levelsCleared: 0, goldEarned: 0 },
    score: 0,
  };
  run.fork = makeFork(run);
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
): ModifierId[] {
  const chosen: ModifierId[] = [];
  let threat = 0;
  let rules = 0;

  if (allowBoon && rng.next() < 0.55) {
    const boons = (['wide', 'anyColor', 'bounty', 'rich'] as ModifierId[]).filter(
      (id) => MODIFIERS[id].minDepth <= depth,
    );
    const b = rng.pick(boons);
    chosen.push(b);
    if (MODIFIERS[b].tag === 'rule') rules++;
    threat += MODIFIERS[b].threat;
  }

  let guard = 0;
  while (chosen.length < maxCount && threat < targetThreat && guard++ < 24) {
    const cands = BANE_IDS.filter(
      (id) =>
        MODIFIERS[id].minDepth <= depth &&
        !chosen.includes(id) &&
        !conflicts(id, chosen) &&
        (MODIFIERS[id].tag !== 'rule' || rules < maxRules),
    );
    if (cands.length === 0) break;
    const entries = cands.map((id) => {
      const after = threat + MODIFIERS[id].threat;
      return { item: id, weight: 1 / (1 + Math.abs(after - targetThreat)) };
    });
    const pick = rng.weighted(entries)!;
    chosen.push(pick);
    if (MODIFIERS[pick].tag === 'rule') rules++;
    threat += MODIFIERS[pick].threat;
  }
  return chosen;
}

function maxModsFor(depth: number): number {
  if (depth <= 2) return 1;
  if (depth <= 6) return 2;
  if (depth <= 12) return 3;
  if (depth <= 19) return 4;
  return 5;
}

/** Three flavours of next step: a gentle one, a standard one, and a gamble. */
export function makeFork(run: RunState): LevelSpec[] {
  const depth = run.depth + 1;
  const rng = new Rng(subSeed(run.seed, depth, 0x5f0));

  if (depth % BOSS_EVERY === 0) {
    const spec: LevelSpec = {
      depth,
      kind: 'boss',
      modifiers: pickModifiers(rng, depth, depth * 1.35 + 6, maxModsFor(depth) + 1, false, depth >= 15 ? 2 : 1),
      seed: subSeed(run.seed, depth, 0xb055),
    };
    return [spec];
  }

  const target = depth * 1.05 + 1;
  const safeKind: NodeKind = depth === 1 || rng.next() < 0.35 ? 'cache' : 'trial';
  const options: LevelSpec[] = [
    {
      depth,
      kind: safeKind,
      modifiers: pickModifiers(rng, depth, Math.max(0, target - 5), Math.max(1, maxModsFor(depth) - 1), true),
      seed: subSeed(run.seed, depth, 1),
    },
    {
      depth,
      kind: 'trial',
      modifiers: pickModifiers(rng, depth, target, maxModsFor(depth), false),
      seed: subSeed(run.seed, depth, 2),
    },
    {
      depth,
      kind: 'gauntlet',
      modifiers: pickModifiers(rng, depth, target + 5, maxModsFor(depth) + 1, false),
      seed: subSeed(run.seed, depth, 3),
    },
  ];
  return depth === 1 ? options.slice(0, 2) : options;
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

function newCard(run: RunState, rng: Rng, withEnch: boolean): DeckCard {
  const ranks = run.deck.map((c) => c.rank);
  const hi = Math.max(...ranks);
  // Higher ranks are the scarce resource: they are the only legal column bases.
  const rank = hi < 13 && rng.next() < 0.65 ? hi + 1 : rng.range(1, hi);
  const card: DeckCard = {
    uid: run.nextUid++,
    rank,
    suit: rng.int(4) as Suit,
    ench: null,
    curse: null,
  };
  if (withEnch) {
    card.ench = rng.weighted(
      ENCHANT_LIST.map((e) => ({ item: e.id, weight: rarityWeight(e.rarity, run.depth) })),
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
  return rng.weighted(pool.map((c) => ({ item: c.id, weight: rarityWeight(c.rarity, run.depth) })));
}

export function makeRewards(run: RunState, kind: NodeKind, count: number): Reward[] {
  const rng = new Rng(subSeed(run.seed, run.depth, 0x4ee));
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

  if (kind === 'boss') push({ t: 'charm', id: randomCharm(run, rng) ?? 'sleeve' });

  let guard = 0;
  while (out.length < count && guard++ < 40) {
    const roll = rng.next();
    if (roll < 0.3) {
      push({
        t: 'ench',
        ench: rng.weighted(
          ENCHANT_LIST.map((e) => ({ item: e.id, weight: rarityWeight(e.rarity, run.depth) })),
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
      push({ t: 'gold', n: Math.round((28 + run.depth * 5) * (rich ? 1.6 : 1)) });
    } else if (roll < 0.88) {
      if (run.deck.some((c) => c.curse)) push({ t: 'uncurse' });
    } else if (roll < 0.95) {
      const c = randomCharm(run, rng);
      if (c && (rich || rng.next() < 0.5)) push({ t: 'charm', id: c });
    } else {
      push({ t: 'bargain', n: Math.round(60 + run.depth * 8) });
    }
  }
  return out.slice(0, count);
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
  | { t: 'moves'; n: number; price: number; sold?: boolean }
  | { t: 'cell'; price: number; sold?: boolean };

export function makeShop(run: RunState): ShopItem[] {
  const rng = new Rng(subSeed(run.seed, run.depth, 0x5409));
  const items: ShopItem[] = [];
  const priceScale = 1 + run.depth * 0.045;
  const p = (n: number): number => Math.round(n * priceScale);

  for (let i = 0; i < 2; i++) {
    const e = rng.weighted(
      ENCHANT_LIST.map((x) => ({ item: x.id, weight: rarityWeight(x.rarity, run.depth) })),
    )!;
    if (!items.some((it) => it.t === 'ench' && it.ench === e)) {
      items.push({ t: 'ench', ench: e, price: p(ENCHANTS[e].price) });
    }
  }
  const charm = randomCharm(run, rng);
  if (charm) items.push({ t: 'charm', id: charm, price: p(CHARMS[charm].price) });
  items.push({ t: 'add', card: newCard(run, rng, true), price: p(40) });
  items.push({ t: 'remove', price: p(run.charms.includes('scalpel') ? 16 : 32) });
  if (run.deck.some((c) => c.curse)) items.push({ t: 'uncurse', price: p(26) });
  items.push({ t: 'moves', n: 2, price: p(45) });
  if (run.bonusCells < 2) items.push({ t: 'cell', price: p(110) });
  return items;
}

export function shopLabel(item: ShopItem): string {
  switch (item.t) {
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
      return '+1 reserve cell';
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
