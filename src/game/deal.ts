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
  /**
   * The solver's line on this same board with the player's enchantments
   * stripped out. This is what the stipend is priced from, so that a move your
   * build saves is a move you keep rather than one the deal quietly reclaims.
   */
  plainPar: number;
  /** Moves this level grants. Build-blind: derived from plainPar, never par. */
  stipend: number;
  /**
   * The allowance against the plain board, as a signed number of moves.
   * Positive means a standard deck has room; negative is the deficit the
   * player's build has to cover.
   */
  slack: number;
  /** True when no standard deck could have afforded this board. */
  needsBuild: boolean;
  /** Moves carried in from earlier levels. */
  bank: number;
  budget: number; // bank + stipend: what movesLeft actually starts at
  /** Moves granted above par: the only ones that are actually yours. */
  surplus: number;
  /**
   * False when no board this generator can build is clearable inside
   * `bank + stipend`. The run is over on economy; nothing is dealt.
   */
  affordable: boolean;
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
  if (has(mods, 'tithe')) r.emptyCost = 2;
  if (has(mods, 'heavydraw')) r.drawCost = 2;
  if (has(mods, 'gridlock')) r.maxGroup = 3;
  if (has(mods, 'ceiling')) r.maxHeight = 9;
  if (charms.includes('locksmith')) r.empty = 'any';
  if (charms.includes('sorter')) r.maxGroup = 0;
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
 * A bigger pile means a shorter staircase and fewer buried cards, while the
 * board still looks exactly like solitaire.
 *
 * This used to fall to 0.30 past stage 5, and that was a mistake: shrinking the
 * draw pile is precisely what the Thin Deal modifier does, and Thin Deal costs
 * a bounded-lookahead player 25 points of clear rate on its own. The game's
 * main depth dial was the same lever that makes boards unclearable by a person,
 * applied to everybody. It stops at 0.38 now.
 *
 * Difficulty does not need it. Since moves became a bank carried across the
 * run, depth is expressed through the stipend rather than by burying more cards
 * than a player can dig out.
 */
export function stockShareFor(depth: number): number {
  if (depth <= 2) return 0.46;
  return 0.38;
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
 * Share of a board's plain cost that the level actually pays for.
 *
 * This is the spine of the difficulty curve, and 1.0 is not the interesting
 * threshold — the player's own move need is. A bounded-lookahead player spends
 * a median 110-136% of plainPar and, measured across stages 1 to 18, that need
 * does not grow with depth (`scripts/humanrun.ts boards`). So the curve is
 * priced against roughly 120%, not against par: above it a level funds itself
 * and banks something, below it the difference has to come out of the bank or
 * out of the build.
 *
 * The first version was fitted to solver play and was wrong at both ends. It
 * paid 1.30 at stage 1 against a median need of 1.29, so half of all opening
 * boards ran out of moves and nothing was ever banked to spend later; and it
 * fell to 0.80 by stage 18 against a need that had not fallen at all.
 *
 * The tail decays geometrically with no floor on purpose: a build's saving per
 * level is roughly fixed while plainPar grows with the deck, so a curve that
 * flattened out could be outrun forever by a good enough deck. Runs have to
 * end.
 */
export function ratioFor(stage: number): number {
  if (stage <= 3) return 1.7;
  if (stage <= 6) return 1.55;
  if (stage <= 9) return 1.4;
  if (stage <= 13) return 1.25;
  if (stage <= 17) return 1.1;
  // Geometric, so it always falls and never reaches zero. A floor here would
  // be a ceiling on difficulty, and a good enough deck would sit above it
  // forever.
  return 1.1 * Math.pow(0.97, stage - 17);
}

/**
 * What a level grants, before anything carried in.
 *
 * Priced from plainPar — the board without the player's enchantments — so the
 * stipend cannot shrink just because the player got better at the game. The
 * node multipliers still bite, but they bite a build-blind number.
 */
export function stipendFor(plainPar: number, stage: number, mods: ModifierId[], kind: NodeKind): number {
  let s = plainPar * ratioFor(stage);
  if (has(mods, 'austere')) s *= 0.85;
  if (kind === 'gauntlet' || kind === 'boss') s *= 0.9;
  if (kind === 'cache') s *= 1.15;
  if (kind === 'sunken') s *= 0.92;
  return Math.max(4, Math.round(s));
}

/**
 * The same board with the player's enchantments taken off and their curses
 * left on. Curses are not part of the build and should not be paid for.
 */
function stripEnchantments(defs: CardDef[]): CardDef[] {
  return defs.map((d) =>
    d.ench === null
      ? d
      : makeCardDef({ uid: d.uid, rank: d.rank, suit: d.suit, ench: null, curse: d.curse }),
  );
}

/**
 * Time given to the plain-board solve. Fixed rather than "whatever is left" so
 * that the price of a board never depends on how long the rest of the deal
 * happened to take.
 */
const PLAIN_SOLVE_MS = 260;

/** Charms that hand out rule-level power, rather than flat moves. */
const RULE_CHARMS: CharmId[] = ['locksmith', 'sorter'];

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
    for (let i = 0; i < 2; i++) {
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
    for (const src of rng.sample(deck, 2)) {
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
  /** Moves carried over from earlier levels. */
  bank?: number;
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
  // Flat grants ride on top of the stipend rather than scaling with it, so a
  // charm bought on stage 2 is still worth the same three moves on stage 20.
  let flatBonus = opts.bonusMoves;
  if (charms.includes('sleeve')) flatBonus += CHARM_MOVE_BONUS.sleeve;
  if (charms.includes('pact')) flatBonus += CHARM_MOVE_BONUS.pact;

  const bank = opts.bank ?? 0;

  let cand: Candidate | null = null;
  let bestSolution: Move[] | null = null;
  let bestCost = Infinity;
  let rules: RuleSet = DEFAULT_RULES;
  let stockSize = baseStock;
  let faceUp = baseFaceUp;
  let relaxed = 0;
  // The board is chosen across several relaxation passes, but the rules and
  // shape that go with it are rebuilt every pass. Capture them with the
  // candidate or they drift apart the moment we keep relaxing past a hit.
  let candRules: RuleSet = DEFAULT_RULES;
  let candMods: ModifierId[] = mods;
  let candStock = baseStock;
  let candFaceUp = baseFaceUp;
  let candRelaxed = 0;

  /**
   * Can the player pay for this line at all?
   *
   * Priced off `par` rather than plainPar, which is the strict reading: the
   * real stipend is computed from plainPar, and stripping enchantments can
   * only lengthen a line, so plainPar >= par and the real stipend is never
   * smaller than the one tested here. Anything that clears this check still
   * clears it once the true number is known.
   */
  const canPayFor = (cost: number, ms: ModifierId[]): boolean =>
    cost <= bank + stipendFor(cost, spec.stage, ms, spec.kind) + flatBonus;

  /**
   * Easing the board is only an affordability lever some of the time.
   *
   * With plainPar ~= par the shortfall is `par * (1 - ratio) - bank`, so a
   * shorter board does close the gap — but only down to zero bank. Arrive at a
   * sub-1.0 stage with an empty purse and no build to widen plainPar, and no
   * board this generator can produce is payable. Detect that up front instead
   * of burning the whole deal deadline rediscovering it every level.
   */
  const hopeless = bank + flatBonus <= 0 && ratioFor(spec.stage) < 1;

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
        candRules = rules;
        candMods = activeMods;
        candStock = stockSize;
        candFaceUp = faceUp;
        candRelaxed = relax;
      }
      // Solvable is no longer enough. A board the player cannot pay for is as
      // dead as one nobody can clear, so keep easing until the line fits the
      // purse — a shorter board is a smaller bill.
      if ((hopeless || canPayFor(bestCost, candMods)) && a >= 1) break outer;
    }
    if (cand && (hopeless || canPayFor(bestCost, candMods))) break;
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
    candRules = rules;
    candMods = activeMods;
    candStock = stockSize;
    candFaceUp = faceUp;
    candRelaxed = 5;
  }
  rules = candRules;
  activeMods = candMods;
  stockSize = candStock;
  faceUp = candFaceUp;
  relaxed = candRelaxed;

  const par = Number.isFinite(bestCost) ? bestCost : Math.round(cand.defs.length * 1.4);

  const m = activeMods;

  /**
   * Price the level on the board the player would have faced without their
   * build. Stripping enchantments only ever removes options, so this line is
   * never shorter than par; when the solver cannot find one in the time left,
   * assume the build was worth a fifth of the board rather than pretending it
   * was worth nothing.
   */
  const plainDefs = stripEnchantments(cand.defs);
  const plainRules = buildRules(
    m,
    charms.filter((c) => !RULE_CHARMS.includes(c)),
    plainDefs.map((d) => d.rank),
  );
  const probe = createSim(plainDefs, cand.cols, cand.stock, cand.up, plainRules, Number.MAX_SAFE_INTEGER / 4);
  // Always solved, and always with the same fixed slice, even when there is
  // nothing to strip. Reusing `par` on an unenchanted deck would be cheaper and
  // wrong: the two paths do different amounts of searching, so the same board
  // would be priced differently depending on what the player was carrying —
  // which is precisely the bias this whole mechanism exists to remove.
  const plainSol = findSolution(probe, PLAIN_SOLVE_MS);
  const plainPar = Math.max(plainSol ? plainSol.cost : Math.round(par * 1.2), par);

  let stipend = stipendFor(plainPar, spec.stage, m, spec.kind) + flatBonus;

  /**
   * Which deck the level is guaranteed against, and it changes with depth.
   *
   * While the ratio pays for the whole plain board, the guarantee is that a
   * *standard* deck could clear this: the budget is lifted to cover plainPar
   * outright. That makes the player's build pure advantage rather than
   * something the deal quietly assumes, which is the only way a board can
   * produce the thought "I needed the card I passed on".
   *
   * Once the ratio falls under 1.0 that guarantee is withdrawn on purpose. The
   * budget no longer covers the plain line, so the difference has to come out
   * of the build, and a deck that never committed to one runs out of room. The
   * board is still certified against the deck the player actually holds — they
   * can always win it — but a bare deck no longer can.
   */
  const guaranteePlain = ratioFor(spec.stage) >= 1;
  if (guaranteePlain) stipend = Math.max(stipend, plainPar);

  const budget = bank + stipend;

  /**
   * True when a standard deck could not have afforded this board. Late levels
   * are meant to read this way, and the player is told rather than left to
   * discover it by losing.
   */
  const needsBuild = plainPar > budget;
  /** The +/- n the allowance sits at against the plain board. */
  const slack = stipend - plainPar;
  // Nothing is clamped up to par here, and that is the point. If the purse
  // cannot cover the board the run is over on economy — but the relaxation
  // loop above has already spent every easing it has trying to avoid that, so
  // reaching this line unaffordable means no board would have fitted.
  const affordable = par <= budget;
  const surplus = budget - par;

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
    plainPar,
    stipend,
    slack,
    needsBuild,
    bank,
    budget,
    surplus,
    affordable,
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
