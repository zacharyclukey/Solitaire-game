/**
 * Level construction: turn a run deck + a node's modifiers into a certified
 * playable board.
 *
 * The move budget is not a hand-authored number — the solver plays the board
 * first and the allowance is derived from the length of the solution it found,
 * scaled by a slack factor that tightens as the run goes deeper.
 */
import { CHARMS, MODIFIERS, type CharmId, type ModifierId } from './content.ts';
import { Rng } from './rng.ts';
import { findSolution } from './solver.ts';
import { createSim, type Sim } from './sim.ts';
import { DEFAULT_RULES, makeCardDef, type CardDef, type CurseId, type DeckCard, type Move, type RuleSet, type Suit } from './types.ts';

export type NodeKind = 'trial' | 'gauntlet' | 'cache' | 'boss' | 'sunken' | 'shop' | 'respite' | 'tutorial';

export interface LevelSpec {
  /** How far along the run this level sits. Advances on a skip as well as a
   *  clear, so difficulty keeps climbing whether or not you bank the level. */
  stage: number;
  kind: NodeKind;
  modifiers: ModifierId[];
  seed: number;
}

export interface Level {
  spec: LevelSpec;
  sim: Sim;
  columns: number;
  /** Cards that start in the draw pile. */
  stockSize: number;
  /** How far the deal had to be eased before the solver could clear it. */
  relaxed: number;
  /** Modifiers actually in force (relaxation can drop the placement rules). */
  modifiers: ModifierId[];
  undosLeft: number;
  undoCostsMove: boolean;
  timeLimit: number; // seconds; 0 = untimed
  peeksLeft: number;
  solution: Move[] | null;
  par: number; // the solver's own move count
  budget: number;
  /** Moves granted above par: the only ones that are actually yours. */
  surplus: number;
  baseGold: number;
  freeFirstMove: boolean;
}

// Measured floor: at five columns better than half of all deals are provably
// unwinnable, because empty columns are the only true sink in the game.
const MIN_COLUMNS = 6;
const MAX_COLUMNS = 9;

export function baseColumnsFor(deckSize: number): number {
  if (deckSize <= 24) return 6;
  if (deckSize <= 34) return 7;
  return 8;
}

function has(mods: ModifierId[], id: ModifierId): boolean {
  return mods.includes(id);
}

export function buildRules(mods: ModifierId[], charms: CharmId[], ranks: number[]): RuleSet {
  const r: RuleSet = { ...DEFAULT_RULES, baseRank: Math.max(...ranks) };
  if (has(mods, 'ascend')) {
    r.dir = 1;
    // Building upward flips which rank is a natural column base.
    r.baseRank = Math.min(...ranks);
  }
  if (has(mods, 'sameSuit')) r.match = 'suit';
  if (has(mods, 'anyColor')) r.match = 'any';
  if (has(mods, 'royal')) r.empty = 'top';
  if (has(mods, 'rust')) r.groups = false;
  if (has(mods, 'tithe')) r.emptyCost = 2;
  if (has(mods, 'heavydraw')) r.drawCost = 2;
  if (has(mods, 'gridlock')) r.maxGroup = 3;
  if (has(mods, 'ceiling')) r.maxHeight = 9;
  if (charms.includes('locksmith')) r.empty = 'any';
  if (charms.includes('sorter')) r.groups = true;
  return r;
}

/**
 * Column heights in the Klondike silhouette — a single card on the left rising
 * to a deep pile on the right — scaled to however many cards the tableau gets.
 *
 * Even columns read as a grid rather than a game of solitaire, which is the
 * whole reason this exists.
 */
export function staircase(total: number, columns: number): number[] {
  const idealTotal = (columns * (columns + 1)) / 2;
  const h = Array.from({ length: columns }, (_, i) =>
    Math.max(1, Math.round(((i + 1) * total) / idealTotal)),
  );
  let sum = h.reduce((a, b) => a + b, 0);
  // Shave the deepest column first and pad the deep end, so the ascent holds.
  while (sum > total) {
    let k = 0;
    for (let i = 1; i < columns; i++) if (h[i] >= h[k]) k = i;
    if (h[k] <= 1) break;
    h[k]--;
    sum--;
  }
  while (sum < total) {
    h[columns - 1]++;
    sum++;
  }
  return h;
}

/**
 * Share of the deck that starts in the draw pile rather than the tableau.
 *
 * This is how the early game is eased without spoiling the silhouette: a
 * bigger pile means a shorter staircase and fewer buried cards, while the
 * board still looks exactly like solitaire.
 */
export function stockShareFor(depth: number): number {
  if (depth <= 2) return 0.46;
  if (depth <= 5) return 0.38;
  return 0.3;
}

/**
 * How many cards start in the draw pile.
 *
 * This is the sharpest difficulty dial in the game. A bigger pile means a
 * shorter tableau — fewer buried cards and easier columns to empty — but every
 * card in it still has to be turned, and each turn costs a move.
 */
export function stockFor(
  deckSize: number,
  mods: ModifierId[],
  charms: CharmId[],
  bonus: number,
  depth = 99,
): number {
  let n = Math.round(deckSize * stockShareFor(depth)) + bonus;
  if (charms.includes('casing')) n += 2;
  if (has(mods, 'thindraw')) n -= 4;
  if (has(mods, 'deepdraw')) n += 4;
  return Math.min(deckSize - 8, Math.max(0, n));
}

export function columnsFor(deckSize: number, mods: ModifierId[], charms: CharmId[]): number {
  let c = baseColumnsFor(deckSize);
  if (has(mods, 'narrow')) c -= 1;
  if (has(mods, 'wide')) c += 1;
  if (charms.includes('stance')) c += 1;
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, c));
}

/**
 * The allowance is `par + surplus`, and the surplus is the whole game.
 *
 * Par is what the board costs — the length of a line the solver actually found.
 * The surplus on top is the only thing you own: it pays for mistakes, for
 * exploring a line that turns out wrong, and for asking the Oracle anything.
 * Stating it as an explicit addition rather than a multiplier means it can be
 * shown to the player, guaranteed never to vanish, and spent deliberately.
 *
 * It shrinks as a run goes deeper. Early on there is room to wander and consult
 * freely; by the deep game you can afford a couple of readings or a couple of
 * wasted moves, and not both.
 */
export function spareFractionFor(stage: number): number {
  return Math.max(0.12, 0.45 - stage * 0.028);
}

/** Never fewer than this, so a reading is always affordable in principle. */
export const MIN_SURPLUS = 6;

/**
 * Floor once modifiers have taken their cut. Tight, but never so tight that
 * the Oracle is unaffordable on the boards where it matters most.
 */
export const HARD_MIN_SURPLUS = 4;

export function surplusFor(
  par: number,
  stage: number,
  mods: ModifierId[],
  kind: NodeKind,
): number {
  let spare = Math.max(MIN_SURPLUS, Math.round(par * spareFractionFor(stage)));
  // Modifiers and hard nodes cut the surplus, never the par underneath it —
  // which is why the allowance can no longer be pushed below a winnable line.
  if (has(mods, 'austere')) spare = Math.round(spare * 0.55);
  if (kind === 'gauntlet') spare = Math.round(spare * 0.8);
  if (kind === 'boss') spare = Math.round(spare * 0.8);
  if (kind === 'cache') spare = Math.round(spare * 1.4);
  // A board you walked past comes back with less room, not more rules: the
  // same deal, harder to afford.
  if (kind === 'sunken') spare = Math.round(spare * 0.65);
  return Math.max(HARD_MIN_SURPLUS, spare);
}

interface Candidate {
  defs: CardDef[];
  cols: number[][];
  stock: number[];
  up: Uint8Array;
}

function layout(
  cards: CardDef[],
  columns: number,
  faceUp: number,
  stockSize: number,
  rng: Rng,
): Candidate {
  const order = rng.shuffle(cards.map((_, i) => i));
  const stockCards = order.slice(0, stockSize); // the pile's end is its top
  const rest = order.slice(stockSize);
  const heights = staircase(rest.length, columns);
  const cols: number[][] = [];
  let at = 0;
  for (const h of heights) {
    cols.push(rest.slice(at, at + h));
    at += h;
  }
  const up = new Uint8Array(cards.length);
  for (const col of cols) {
    for (let i = Math.max(0, col.length - faceUp); i < col.length; i++) up[col[i]] = 1;
  }
  return { defs: cards, cols, stock: stockCards, up };
}

/** Level-only curses layered on top of whatever the card already carries. */
function applyLevelCurses(defs: CardDef[], mods: ModifierId[], charms: CharmId[], rng: Rng): void {
  const plan: { curse: CurseId; n: number }[] = [];
  if (has(mods, 'frost')) plan.push({ curse: 'frozen', n: 3 });
  if (has(mods, 'lead')) plan.push({ curse: 'heavy', n: 3 });
  if (has(mods, 'shroud')) plan.push({ curse: 'dim', n: 2 });
  if (charms.includes('pact')) plan.push({ curse: rng.pick<CurseId>(['heavy', 'frozen', 'stuck']), n: 1 });

  for (const p of plan) {
    const free = defs.map((d, i) => ({ d, i })).filter((x) => !x.d.curse);
    for (const pick of rng.sample(free, p.n)) {
      const d = defs[pick.i];
      d.curse = p.curse;
      d.heavy = p.curse === 'heavy';
      d.frozen = p.curse === 'frozen';
      d.stuck = p.curse === 'stuck';
      d.dim = p.curse === 'dim';
    }
  }
}

function levelCards(deck: DeckCard[], mods: ModifierId[], rng: Rng): CardDef[] {
  const defs = deck.map(makeCardDef);
  const ranks = defs.map((d) => d.rank);
  const lo = Math.min(...ranks);
  const hi = Math.max(...ranks);
  let nextUid = -1;

  if (has(mods, 'dense')) {
    for (let i = 0; i < 3; i++) {
      defs.push(
        makeCardDef({
          uid: nextUid--,
          // Biased towards the high end: a stray low card is far more likely to
          // strand itself than a stray column base.
          rank: rng.next() < 0.5 ? rng.range(Math.max(lo, hi - 2), hi) : rng.range(lo, hi),
          suit: rng.int(4) as Suit,
          ench: null,
          curse: null,
        }),
      );
    }
  }
  if (has(mods, 'twinned')) {
    for (const src of rng.sample(deck, 3)) {
      defs.push(makeCardDef({ ...src, uid: nextUid--, ench: null }));
    }
  }
  return defs;
}

export interface DealOptions {
  deck: DeckCard[];
  charms: CharmId[];
  spec: LevelSpec;
  /** Extra flat moves granted by run upgrades. */
  bonusMoves: number;
  /** Extra reserve cells bought during the run. */
  bonusCells: number;
  attempts?: number;
  /** Wall-clock budget for dealing, including every solver attempt. */
  budgetMs?: number;
}

export function dealLevel(opts: DealOptions): Level {
  const { deck, charms, spec } = opts;
  const rng = new Rng(spec.seed);
  const mods = spec.modifiers;
  const columns = columnsFor(deck.length, mods, charms);
  const baseStock = stockFor(deck.length, mods, charms, opts.bonusCells, spec.stage);
  // Exactly one card face-up per column: the classic silhouette, and the
  // configuration that measured most reliably solvable.
  const baseFaceUp = 1;
  const attempts = opts.attempts ?? 3;
  const deadline = Date.now() + (opts.budgetMs ?? 1200);

  let cand: Candidate | null = null;
  let bestSolution: Move[] | null = null;
  let bestCost = Infinity;
  let rules: RuleSet = DEFAULT_RULES;
  let stockSize = baseStock;
  let faceUp = baseFaceUp;
  let relaxed = 0;

  /**
   * A board the solver cannot clear is never handed to the player. If a deal
   * resists, more of it is moved into the draw pile — shortening the tableau —
   * and then more cards are turned face up. A slightly easier level always
   * beats an impossible one.
   */
  let activeMods = mods;
  outer: for (let relax = 0; relax < 5; relax++) {
    stockSize = Math.min(deck.length - 8, baseStock + Math.min(2, relax) * 3);
    faceUp = baseFaceUp + (relax >= 3 ? 1 : 0);
    // Last resort: drop the rules that rewrite placement and keep the flavour
    // modifiers, rather than serving a board nobody can finish.
    activeMods = relax >= 4 ? mods.filter((m) => MODIFIERS[m].tag !== 'rule') : mods;
    relaxed = relax;
    for (let a = 0; a < (relax === 0 ? attempts : 2); a++) {
      const left = deadline - Date.now();
      if (left <= 0 && cand) break outer;
      const solveMs = Math.max(70, Math.min(340, left / 2));
      const defs = levelCards(deck, activeMods, rng);
      applyLevelCurses(defs, activeMods, charms, rng);
      rules = buildRules(activeMods, charms, defs.map((d) => d.rank));
      const trial = layout(defs, columns, faceUp, stockSize, rng);
      const probe = createSim(trial.defs, trial.cols, trial.stock, trial.up, rules, Number.MAX_SAFE_INTEGER / 4);
      const sol = findSolution(probe, solveMs);
      if (!sol) continue;
      if (!cand || sol.cost < bestCost) {
        cand = trial;
        bestSolution = sol.moves;
        bestCost = sol.cost;
      }
      if (a >= 1) break outer;
    }
    if (cand) break;
  }

  if (!cand) {
    // Nothing survived even the eased rules: hand out a shallow, standard board
    // rather than crash the run.
    const defs = levelCards(deck, [], rng);
    activeMods = mods.filter((m) => MODIFIERS[m].tag === 'meta');
    rules = buildRules([], charms, defs.map((d) => d.rank));
    stockSize = Math.min(defs.length - 8, baseStock + 6);
    faceUp = baseFaceUp + 2;
    cand = layout(defs, columns, faceUp, stockSize, rng);
    bestCost = Math.round(defs.length * 0.9);
    relaxed = 5;
  }

  const par = Number.isFinite(bestCost) ? bestCost : Math.round(cand.defs.length * 1.4);

  const m = activeMods;
  const surplus = surplusFor(par, spec.stage, m, spec.kind);
  let budget = par + surplus;
  if (charms.includes('sleeve')) budget += CHARM_MOVE_BONUS.sleeve;
  if (charms.includes('pact')) budget += CHARM_MOVE_BONUS.pact;
  budget += opts.bonusMoves;
  // The floor is absolute. Austerity, gauntlets and wardens all scale the
  // allowance down, and with slack this tight they can otherwise push it under
  // par — which would hand out a board that cannot be cleared. A loss has to be
  // the player's line, never the deal.
  budget = Math.max(budget, par + 1);

  const sim = createSim(cand.defs, cand.cols, cand.stock, cand.up, rules, budget);

  if (charms.includes('lantern')) {
    const downs: { c: number; i: number }[] = [];
    for (let c = 0; c < sim.tableau; c++) sim.cols[c].forEach((id, i) => { if (!sim.up[id]) downs.push({ c, i }); });
    for (const p of rng.sample(downs, 2)) {
      const id = sim.cols[p.c][p.i];
      if (!sim.up[id]) {
        sim.up[id] = 1;
        sim.hidden--;
      }
    }
  }

  let undos = 3;
  if (charms.includes('dice')) undos += 2;
  if (has(m, 'steady')) undos = 0;

  let baseGold = 12 + spec.stage * 3;
  if (spec.kind === 'gauntlet') baseGold = Math.round(baseGold * 1.6);
  if (spec.kind === 'boss') baseGold = Math.round(baseGold * 2.2);
  if (spec.kind === 'cache') baseGold = Math.round(baseGold * 0.7);
  if (has(m, 'bounty')) baseGold = Math.round(baseGold * 1.6);
  if (has(m, 'rich')) baseGold += 25;

  return {
    spec,
    sim,
    columns,
    stockSize,
    relaxed,
    modifiers: activeMods,
    undosLeft: undos,
    undoCostsMove: has(m, 'glass'),
    timeLimit: has(m, 'rush') ? 120 : 0,
    peeksLeft: charms.includes('xray') ? 1 : 0,
    solution: bestSolution,
    par,
    budget,
    surplus,
    baseGold,
    freeFirstMove: charms.includes('crowbar'),
  };
}

export const CHARM_MOVE_BONUS = { sleeve: 3, pact: 7 } as const;

/** Human-readable summary of a node's rule changes, for the map and briefing. */
export function describeModifiers(mods: ModifierId[]): { name: string; text: string; glyph: string; threat: number }[] {
  return mods.map((id) => {
    const m = MODIFIERS[id];
    return { name: m.name, text: m.text, glyph: m.glyph, threat: m.threat };
  });
}

export function threatOf(spec: LevelSpec): number {
  let t = spec.modifiers.reduce((n, id) => n + MODIFIERS[id].threat, 0);
  if (spec.kind === 'gauntlet') t += 4;
  if (spec.kind === 'boss') t += 8;
  if (spec.kind === 'cache') t -= 5;
  return t;
}

export function charmName(id: CharmId): string {
  return CHARMS[id].name;
}

/** Cards live in a fresh sim per level, so the run deck is never mutated. */
export function cloneDeck(deck: DeckCard[]): DeckCard[] {
  return deck.map((c) => ({ ...c }));
}
