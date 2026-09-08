import { dealLevel, type LevelSpec } from '../src/game/deal.ts';
import { CAREFUL, playBot } from '../src/game/bot.ts';
import { newRun } from '../src/game/run.ts';
import { cloneSim, type Sim } from '../src/game/sim.ts';
import type { RuleSet } from '../src/game/types.ts';

/*
 * Paired version. The previous sweep dealt each arm separately and the board
 * SELECTOR cancelled the effect — Suit Lock came out easier than a plain board,
 * which is not a fact about Suit Lock, it is dealLevel choosing an easier
 * layout to hit its win-chance band.
 *
 * So: deal ONE board, then flip the rule on a clone. Same cards, same layout,
 * only the rule differs, and the selector never sees it. Budget is unlimited,
 * so nothing here is price. Narrow vs wide search separates a thinking tax from
 * a structural one.
 *
 * Inversion is absent on purpose: it also moves baseRank, which reshapes the
 * staircase the board was dealt to, so retrofitting it measures the mismatch
 * rather than the rule.
 */
const STAGE = 14, N = 24;
// `passes` is copied into `s.passesLeft` when the sim is built, so a rule that
// touches it has to reach the sim too or it measures nothing at all.
const RULES: [string, (r: RuleSet, s: Sim) => void][] = [
  ['(none)', () => {}],
  ['sameSuit', (r) => { r.match = 'suit'; }],
  ['gridlock', (r) => { r.maxGroup = 3; }],
  ['ceiling', (r) => { r.maxHeight = 9; }],
  ['tithe', (r) => { r.emptyCost = 2; }],
  ['heavydraw', (r) => { r.drawCost = 2; }],
  ['anyColor', (r) => { r.match = 'any'; }],
  // Round two. Sealed Vaults (empty: 'none') measured 0% and Rust
  // (groups: false) 4-8% against a 92% control: those are not modifiers, they
  // are board-killers, and both are cut. One Pass measured exactly 0pp, so the
  // question there is whether NO recycle does anything either. Royal Gates
  // measured -42pp, far outside the band any current modifier occupies
  // (Suit Lock, the heaviest at threat 8, is -17pp), so the softer widths are
  // under test to find a shippable version.
  ['draw3', (r) => { r.drawCount = 3; }],
  ['gates3 (|d|<=2)', (r) => { r.empty = 'top'; }],
  ['gates5 (|d|<=4)', (r) => { r.empty = 'top'; r.gateWidth = 4; }],
  ['gates7 (|d|<=6)', (r) => { r.empty = 'top'; r.gateWidth = 6; }],
  ['nopass', (r, s) => { r.passes = 0; s.passesLeft = 0; }],
];
const WIDTHS = [4, 14, 30];

const boards: Sim[] = [];
for (let i = 0; i < N; i++) {
  const run = newRun((909 + i * 31337) >>> 0);
  run.stage = STAGE;
  const spec: LevelSpec = { stage: STAGE, kind: 'trial', modifiers: [], seed: (5000 + i * 7919) >>> 0 };
  boards.push(dealLevel({ deck: run.deck, charms: [], spec, bonusMoves: 0, bonusCells: 0, bank: 9999 }).sim);
}

console.log(`stage ${STAGE}, ${N} identical boards, rule flipped in place, unlimited budget`);
console.log('rule          w4      w14     w30');
for (const [name, apply] of RULES) {
  const out: string[] = [];
  for (const w of WIDTHS) {
    let won = 0;
    for (const b of boards) {
      const s = cloneSim(b);
      s.rules = { ...s.rules };
      apply(s.rules, s);
      if (playBot(cloneSim(s), { ...CAREFUL, width: w }).won) won++;
    }
    out.push(`${((won / N) * 100).toFixed(0)}%`.padStart(6));
  }
  console.log(`${name.padEnd(12)} ${out.join(' ')}`);
}
