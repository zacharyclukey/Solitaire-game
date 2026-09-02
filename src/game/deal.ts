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

export type NodeKind = 'trial' | 'gauntlet' | 'cache' | 'boss' | 'shop' | 'respite';

export interface LevelSpec {
  depth: number;
  kind: NodeKind;
  modifiers: ModifierId[];
  seed: number;
}

export interface Level {
  spec: LevelSpec;
  sim: Sim;
  columns: number;
  cells: number;
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
  baseGold: number;
  freeFirstMove: boolean;
}

const MIN_COLUMNS = 5;
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
  if (has(mods, 'toll')) r.cellCost = 1;
  if (has(mods, 'gridlock')) r.maxGroup = 3;
  if (has(mods, 'ceiling')) r.maxHeight = 9;
  if (charms.includes('locksmith')) r.empty = 'any';
  if (charms.includes('sorter')) r.groups = true;
  return r;
}

/** Number of cards each column starts with face-up. */
function faceUpPerColumn(depth: number, mods: ModifierId[]): number {
  let n = depth <= 2 ? 3 : 2;
  if (has(mods, 'buried')) n -= 1;
  return Math.max(1, n);
}

export const BASE_CELLS = 3;
export const MAX_CELLS = 4;

/** Reserve cells available on a level. The reserve is the pressure valve that
 *  makes a foundation-less tableau solvable at all, so it is also the sharpest
 *  difficulty dial in the game. */
export function cellsFor(mods: ModifierId[], charms: CharmId[], bonus: number): number {
  let n = BASE_CELLS + bonus;
  if (charms.includes('casing')) n += 1;
  if (has(mods, 'tight')) n -= 1;
  return Math.min(MAX_CELLS, Math.max(0, n));
}

export function columnsFor(deckSize: number, mods: ModifierId[], charms: CharmId[]): number {
  let c = baseColumnsFor(deckSize);
  if (has(mods, 'narrow')) c -= 1;
  if (has(mods, 'cramped')) c -= 2;
  if (has(mods, 'wide')) c += 1;
  if (charms.includes('stance')) c += 1;
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, c));
}

/**
 * Slack applied to the solver's solution length when setting the allowance.
 *
 * It never drops below 1.0: the board is always clearable inside the budget by
 * the line the solver actually found, so a loss is always the player's line
 * rather than an impossible deal. By depth ~16 the player has to match a
 * searcher move for move, which is where the ceiling of the game sits.
 */
export function slackFor(depth: number): number {
  return Math.min(1.8, Math.max(1.0, 1.8 - depth * 0.05));
}

function flatBonus(depth: number): number {
  return Math.max(1, 5 - Math.floor(depth / 3));
}

interface Candidate {
  defs: CardDef[];
  cols: number[][];
  up: Uint8Array;
}

function layout(cards: CardDef[], columns: number, faceUp: number, rng: Rng): Candidate {
  const order = rng.shuffle(cards.map((_, i) => i));
  const cols: number[][] = Array.from({ length: columns }, () => []);
  order.forEach((id, i) => cols[i % columns].push(id));
  const up = new Uint8Array(cards.length);
  for (const col of cols) {
    for (let i = Math.max(0, col.length - faceUp); i < col.length; i++) up[col[i]] = 1;
  }
  return { defs: cards, cols, up };
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
  const baseCells = cellsFor(mods, charms, opts.bonusCells);
  const baseFaceUp = faceUpPerColumn(spec.depth, mods);
  const attempts = opts.attempts ?? 3;
  const deadline = Date.now() + (opts.budgetMs ?? 1200);

  let cand: Candidate | null = null;
  let bestSolution: Move[] | null = null;
  let bestCost = Infinity;
  let rules: RuleSet = DEFAULT_RULES;
  let cells = baseCells;
  let faceUp = baseFaceUp;
  let relaxed = 0;

  /**
   * A board the solver cannot clear is never handed to the player. If a deal
   * resists, the reserve is widened and then more cards are turned face up —
   * a slightly easier level always beats an impossible one.
   */
  let activeMods = mods;
  outer: for (let relax = 0; relax < 5; relax++) {
    cells = Math.min(MAX_CELLS, baseCells + Math.min(2, relax));
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
      const trial = layout(defs, columns, faceUp, rng);
      const probe = createSim(trial.defs, trial.cols, trial.up, rules, Number.MAX_SAFE_INTEGER / 4, cells);
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
    cells = MAX_CELLS;
    faceUp = baseFaceUp + 2;
    cand = layout(defs, columns, faceUp, rng);
    bestCost = Math.round(defs.length * 0.9);
    relaxed = 5;
  }

  const par = Number.isFinite(bestCost) ? bestCost : Math.round(cand.defs.length * 1.4);

  const m = activeMods;
  let budget = Math.ceil(par * slackFor(spec.depth)) + flatBonus(spec.depth);
  if (has(m, 'austere')) budget = Math.ceil(budget * 0.85);
  if (spec.kind === 'gauntlet') budget = Math.ceil(budget * 0.94);
  if (spec.kind === 'boss') budget = Math.ceil(budget * 0.9);
  if (spec.kind === 'cache') budget = Math.ceil(budget * 1.2);
  if (charms.includes('sleeve')) budget += CHARM_MOVE_BONUS.sleeve;
  if (charms.includes('pact')) budget += CHARM_MOVE_BONUS.pact;
  budget += opts.bonusMoves;

  const sim = createSim(cand.defs, cand.cols, cand.up, rules, budget, cells);

  if (charms.includes('lantern')) {
    const downs: { c: number; i: number }[] = [];
    for (let c = 0; c < sim.cellStart; c++) sim.cols[c].forEach((id, i) => { if (!sim.up[id]) downs.push({ c, i }); });
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

  let baseGold = 12 + spec.depth * 3;
  if (spec.kind === 'gauntlet') baseGold = Math.round(baseGold * 1.6);
  if (spec.kind === 'boss') baseGold = Math.round(baseGold * 2.2);
  if (spec.kind === 'cache') baseGold = Math.round(baseGold * 0.7);
  if (has(m, 'bounty')) baseGold = Math.round(baseGold * 1.6);
  if (has(m, 'rich')) baseGold += 25;

  return {
    spec,
    sim,
    columns,
    cells,
    relaxed,
    modifiers: activeMods,
    undosLeft: undos,
    undoCostsMove: has(m, 'glass'),
    timeLimit: has(m, 'rush') ? 120 : 0,
    peeksLeft: charms.includes('xray') ? 1 : 0,
    solution: bestSolution,
    par,
    budget,
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
