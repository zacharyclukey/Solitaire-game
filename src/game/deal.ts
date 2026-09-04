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
import { coverAt, winChance } from './odds.ts';
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
  /** Estimated chance a fallible player clears this, from the measured curve. */
  chance: number;
  /**
   * Whether a line was actually found on the plain board. When false, plainPar
   * is an estimate rather than a measurement and the level is priced as a very
   * long shot — so this is worth watching: a run where it is usually false is a
   * run the generator cannot see.
   */
  plainSolved: boolean;
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
 * Measured cost of a plain board, per card in the deck. plainPar came out at
 * 37-39 moves for a 28-card deck across every stage sampled.
 */
export const PLAIN_PAR_PER_CARD = 1.36;

/** Measured: each point of modifier threat costs a plain board about this much. */
const MOVES_PER_THREAT = 0.48;

/**
 * How much of that the stipend hands back. Below 1.0 on purpose — modifiers
 * have to cost the player something net, or they are decoration.
 */
const THREAT_COMPENSATION = 0.7;

/**
 * What a level grants, before anything carried in.
 *
 * Priced off the stage and the size of the deck — deliberately NOT off this
 * particular deal's plainPar. Scaling the allowance to the board it is paying
 * for made every deal at a stage identical in difficulty: a hard shuffle got
 * proportionally more moves and an easy one got fewer, so there was no such
 * thing as an unlucky deal and nothing for the generator to reject. Priced off
 * the deck instead, a hard shuffle really is harder.
 *
 * It stays blind to the player's build for the same reason as before: a move
 * an enchantment saves has to be a move the player keeps.
 */
export function stipendFor(deckSize: number, stage: number, mods: ModifierId[], kind: NodeKind): number {
  // Modifiers make a board cost more, so paying the same for a board carrying
  // four of them is not the same difficulty at all — measured, a deep deal's
  // plainPar runs about half a move higher per point of threat. Compensate for
  // most of that but deliberately not all of it, so rules still add net
  // difficulty rather than only flavour. Compensating on the modifiers the deal
  // ROLLED, rather than on the board it produced, is what keeps an unlucky
  // shuffle unlucky: the whole point of decoupling the stipend was that a hard
  // deal should be hard.
  const threat = mods.reduce((t, id) => t + MODIFIERS[id].threat, 0);
  let s = deckSize * PLAIN_PAR_PER_CARD * ratioFor(stage) + threat * MOVES_PER_THREAT * THREAT_COMPENSATION;
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
/** Measured at 28 cards: a plain board costs about this much per card. */
const PAR_PER_CARD_ESTIMATE = 1.4;

const PLAIN_SOLVE_MS = 260;

/**
 * Bigger decks mean bigger boards and a much larger search. A flat slice was
 * fine at 28 cards and hopeless by 40, which is why plainPar quietly became a
 * fabricated number at depth rather than a measured one.
 */
function plainSolveMsFor(deckSize: number): number {
  return Math.round(PLAIN_SOLVE_MS * Math.max(1, deckSize / 28));
}

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
  const boardSize = deck.length;
  const columns = columnsFor(boardSize, mods, charms);
  const baseStock = stockFor(boardSize, mods, charms, opts.bonusCells, spec.stage);
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
   * A board the solver cannot clear is never handed to the player. If a deal
   * resists, more of it is moved into the draw pile — shortening the tableau —
   * and then more cards are turned face up. A slightly easier level always
   * beats an impossible one.
   */
  let activeMods = mods;
  /**
   * The stipend no longer depends on the board, so it can be settled up front
   * and the deal judged against it.
   */
  const stipendBase = stipendFor(boardSize, spec.stage, mods, spec.kind) + flatBonus;

  /**
   * What the stage is aiming for, and how far a deal may miss it.
   *
   * The target is what the ratio was designed to deliver, read off the measured
   * win curve. The band is what makes an honest shuffle usable: a deal far
   * below it is a run ended by the deck rather than by the player, and one far
   * above is a level that may as well not have been dealt.
   */
  const target = coverAt(ratioFor(spec.stage));
  const TOLERANCE = 0.12;

  let bestGap = Infinity;
  let candPlainPar = 0;
  let candSolved = false;

  /**
   * Honest shuffles. Nothing here eases the board toward being solvable or
   * toward fitting the purse — the deal is what the deck gave, and the solve is
   * a measurement of it rather than a gate on it. Deals are rejected only for
   * landing outside the stage's band, in either direction, and the closest one
   * seen is kept when none lands inside.
   */
  outer: for (let a = 0; a < attempts + 6; a++) {
    const left = deadline - Date.now();
    if (left <= 0 && cand) break;
    const defs = levelCards(deck, mods, rng);
    applyLevelCurses(defs, mods, charms, rng);
    rules = buildRules(mods, charms, defs.map((d) => d.rank));
    const trial = layout(defs, columns, faceUp, stockSize, rng);

    // The real line, for certainty about what the player is holding.
    const probe = createSim(trial.defs, trial.cols, trial.stock, trial.up, rules, Number.MAX_SAFE_INTEGER / 4);
    const sol = findSolution(probe, Math.max(70, Math.min(260, left / 3)));

    // And the plain line, which is what the deal is actually priced against.
    const plainProbe = createSim(
      stripEnchantments(trial.defs), trial.cols, trial.stock, trial.up,
      buildRules(mods, charms.filter((c) => !RULE_CHARMS.includes(c)), trial.defs.map((d) => d.rank)),
      Number.MAX_SAFE_INTEGER / 4,
    );
    const plainSol = findSolution(plainProbe, plainSolveMsFor(boardSize));
    const thisPlainPar = plainSol ? plainSol.cost : Math.round(boardSize * PLAIN_PAR_PER_CARD * 1.6);

    const chance = winChance(stipendBase, thisPlainPar, plainSol !== null);
    const gap = Math.abs(chance - target);
    if (gap < bestGap) {
      bestGap = gap;
      cand = trial;
      bestSolution = sol ? sol.moves : null;
      bestCost = sol ? sol.cost : Number.POSITIVE_INFINITY;
      candRules = rules;
      candMods = mods;
      candStock = stockSize;
      candFaceUp = faceUp;
      candRelaxed = 0;
      candPlainPar = thisPlainPar;
      candSolved = plainSol !== null;
    }
    if (gap <= TOLERANCE) break outer;
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
    // A line found on a different layout indexes cards this board does not
    // have. Replaying it walked off the end of `defs` and crashed; drop it.
    bestSolution = null;
    candPlainPar = 0;
    candSolved = false;
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

  /**
   * The solver stops being able to see past about thirty cards, and deck growth
   * crosses that around stage five, so from there on neither the real line nor
   * the plain one is found and both numbers below are estimates from board
   * size. Measured at 28 cards, a plain board runs about 1.4 moves per card.
   *
   * This is a real limit rather than a tuning choice, and it is why the game
   * cannot lean on a certificate at depth. Treating an unsolved board as
   * hopeless was worse than estimating it: it pinned every deep level to the
   * unaffordable floor and ended runs at stage five with a bankruptcy screen.
   */
  const solvedReal = Number.isFinite(bestCost);
  const par = solvedReal ? bestCost : Math.round(cand.defs.length * PAR_PER_CARD_ESTIMATE);

  const m = activeMods;

  // Both lines were measured while the deal was chosen, so nothing is re-solved
  // here. plainPar is what the level is priced against; par is what the deck in
  // hand can do, and is only ever shorter.
  const plainPar = Math.max(candPlainPar, par);

  const stipend = stipendBase;
  const budget = bank + stipend;

  /**
   * The estimated chance a fallible player clears this, from the measured curve
   * in odds.ts.
   *
   * Estimated against `par` — the board as the player will actually face it,
   * with their deck — not against plainPar. The two have different jobs and
   * conflating them was a live bug: past stage 10 the plain solve fails on
   * essentially every board, so a plain-based chance pinned to the unsolved
   * floor and every deep level was declared unaffordable. Pricing stays blind
   * to the build; the odds do not, because the odds are about this player.
   */
  // Estimated even when nothing was solved. An unseen board is not a hopeless
  // one — it is a board the generator could not measure, and the player still
  // has to be given something to play.
  const chance = winChance(budget, par, true);

  /** True when a standard deck could not have afforded this board. */
  const needsBuild = plainPar > budget;
  /** The +/- n the allowance sits at against the plain board. */
  const slack = stipend - plainPar;

  /**
   * The run only ends here when even the bank cannot make the board worth
   * attempting. Losing a board is the ordinary way to end a run now — the game
   * is losable by default — so this is a backstop against dealing something
   * hopeless, not the economic wall it used to be.
   */
  const affordable = chance > 0.02;
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
    chance,
    plainSolved: candSolved,
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
