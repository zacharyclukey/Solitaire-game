# Facedown — design notes

This document records what the game is, why each piece is shaped the way it is,
and where the knobs are.

---

## 1. The core loop

**Goal of a level:** turn every face-down card. Nothing else. There are no
foundations, no stock and no waste — the tableau is the entire game.

That single subtraction changes solitaire completely. In Klondike, the
foundations are a sink: any card can eventually leave the board, which is what
keeps the tableau from jamming. Take the sink away and the tableau is a closed
system. The first prototype of this game did exactly that, and **7 out of 10
deals were provably unwinnable** — a brute-force search of the entire reachable
state space terminated in fewer than a dozen states. The board simply locks.

Two mechanisms fix it, and both became central to the design.

### The reserve

A small number of free cells, FreeCell-style, that hold one card each. Any
face-up card can be parked there; anything in the reserve can come back out onto
a legal stack or an empty column.

Measured on the same deals that were 70% unwinnable with no reserve:

| Reserve cells | Provably unwinnable |
| --- | --- |
| 0 | 7 / 10 |
| 1 | 0 / 10 |

One cell is transformative; three is the base. It is now the single most
powerful difficulty dial in the game — `Tight Quarters` takes one away, the
`Card Case` charm adds one, and a permanent cell is the most expensive thing in
the market.

The reserve also solved a layout problem. Seven columns of four cards on a phone
leaves the top third of the screen empty; the reserve now lives there.

### The move allowance

Every level grants a fixed number of moves. Run out and the run ends. This is the
only fail state, and it turns the puzzle from "can this be solved" into "can you
solve it *efficiently*", which is a far better fit for short mobile sessions.

---

## 2. Difficulty comes from the solver, not from a spreadsheet

A hand-tuned move budget would be wrong on most deals, because deals vary
enormously. Instead:

1. Deal a candidate board.
2. Run a weighted A\* search over the **same rules engine the player uses**.
3. If it finds no line, throw the board away and deal another.
4. The allowance is `ceil(solutionCost × slack(depth)) + flat(depth)`.

This gives three properties that would otherwise be very hard to get:

- **Every board is clearable.** Not "probably" — a concrete line exists and was
  found before the cards were dealt.
- **Difficulty scales with the actual board**, not with a designer's guess.
- **The ceiling is well-defined.** `slack` never drops below 1.0, so the deepest
  levels demand that you match a searcher move for move. That *is* the top of the
  difficulty curve, and it is reachable rather than arbitrary.

`slack` runs from 1.8 at depth 1 down to 1.0 by depth ~16. Measured across
simulated runs:

```
depth   cards cols cell hidden   par budget slack
    1      28  7.0  3.0    7.0  25.4   50.0  1.97
    5      29  6.6  3.2   18.0  29.4   44.8  1.52
   10      29  6.7  3.4   17.8  30.1   37.3  1.24
   15      29  6.3  3.6   17.7  35.2   36.3  1.03
   20      30  6.5  4.0   15.1  30.6   29.2  1.02
```

`npm run balance` regenerates this table.

### Guaranteed playability

If a modifier combination resists the solver, the deal is **eased in steps**
rather than shipped broken: widen the reserve, then widen it again, then turn one
more card face-up per column, and only as a last resort drop the placement-rule
modifiers. The level records how far it had to be eased, which is what the
telemetry column `relaxed` reports. In current tuning, no relaxation is needed at
all through depth 11, and it affects 10–30% of deals in the deep game.

### The search

Weighted A\* with `h = hidden + 0.5 × blockers + 0.3 × occupied cells`, a
transposition table keyed on a column-order-independent encoding, and pruning of
symmetric moves (all empty columns are the same column; all empty cells are the
same cell).

`findSolution` runs a deliberately greedy first pass so that an unwinnable board
is rejected in tens of milliseconds instead of grinding, then two cost-bounded
passes that shorten the line it found. Dealing typically takes 200–400 ms and is
hard-capped; it runs in a Web Worker behind the deal animation, so the UI never
blocks.

The same solver, restricted to the remaining allowance, is the Hint button.

---

## 3. The run

```
fork  ──▶  level  ──▶  reward  ──▶  [market every 3rd]  ──▶  fork ...
                 └─▶  run over
```

- The fork always offers a **gentle** node, a **standard** one and a **gauntlet**
  (harsher rules, richer spoils). Every fifth level is a single **Warden** node
  that guarantees a charm.
- Failing a level ends the run. The `Second Wind` charm buys exactly one re-deal.
- **Score is depth.** Everything else — gold, cards turned, charms — is a
  tie-break.

### Deck management is the roguelite

Your deck *is* the board. This makes the usual deckbuilder tension literal:

- **Cut cards** → shorter board, tighter allowance, higher enchantment density,
  fewer places to put things.
- **Add cards** → longer board, more allowance, more of your power on the table,
  more to dig through.

Because the allowance is derived from the board, neither is strictly better,
which is what makes the choice interesting. High ranks are the scarce resource:
only they can start a column, so a new 8 is worth more than a new 3.

---

## 4. Content

**12 enchantments** on individual cards. The interesting ones change the shape of
the puzzle rather than the numbers: *Torch* turns the deepest hidden card in its
column when it flips; *Twin* turns every hidden card of its rank; *Anchor* lets
anything at all stack on it; *Ember* can be burned off the board entirely.

**4 curses** — *Leaden* (costs an extra move), *Frozen* (immovable until enough
cards have turned), *Rooted* (never enters an empty column) and *Shrouded* (does
not turn by itself; you pay a move for it).

**15 charms**, run-wide passives: more moves, more undos, more reserve, gold
multipliers, and a few that switch a rule off (`Locksmith` ignores empty-column
restrictions; `Sorting Tray` ignores Rust).

**22 level modifiers**, each tagged:

- `rule` — rewrites placement (Suit Lock, Inversion, Rust, Gridlock, Royal Gates,
  Tithe, Reserve Toll, Tight Quarters, Cramped, Low Ceiling, Loose Weave)
- `board` — reshapes the deal (Narrow, Open Ground, Buried, Deep Frost, Leadfoot,
  Shroud, Overgrowth, Doppelgänger)
- `meta` — touches the surrounding resources (Austerity, Rush, Steady Hand,
  Glasswork, Bounty, Windfall)

**A level takes at most one `rule` modifier** (two on deep Wardens). This is the
single most important balance constraint in the game: rule modifiers compose
badly, and stacking two of them was the main source of unwinnable boards.

Every modifier carries a `threat` weight; a node picks modifiers until it hits a
depth-scaled threat target, so difficulty rises smoothly without a hand-authored
table per level.

---

## 5. Feel

- **Both input models.** Tap-to-select with highlighted destinations for
  deliberate play; direct drag for speed. Tapping a selected card again sends it
  somewhere sensible. Press-and-hold explains a card.
- **The tableau breathes.** Column fan spacing is recomputed on every layout to
  fill the available height — tight when a pile is deep, generous when it is
  not — and every card is positioned with `translate3d`, so relayouts animate on
  the compositor.
- **Sound is synthesised** with oscillators and filtered noise at runtime. No
  audio files, nothing to license, works offline, costs nothing in bundle size.
- **Haptics** go through the Capacitor plugin on device and the Vibration API on
  the web.
- **Accessibility**: four-colour suits, high contrast, reduced motion, left-handed
  action bar, and a hint system that is genuinely a solver rather than a
  heuristic.

---

## 6. Technical shape

| Concern | Decision |
| --- | --- |
| Framework | None. ~30 kB gzipped JS total, no runtime dependencies. |
| Rules | One engine (`src/game/sim.ts`) shared by the game and the solver. |
| Determinism | Everything derives from a 32-bit seed; runs are reproducible and shareable as a 7-character code. |
| Saving | One JSON blob. An interrupted level is restored by replaying its move list, undo stack included. |
| Threading | Dealing and hints run in a Web Worker, with a synchronous fallback. |
| Offline | A generated service worker precaches the exact build output. |
| Native | Capacitor, both platforms committed and configured. |

### Where to tune

| What | Where |
| --- | --- |
| Difficulty curve | `slackFor` / `flatBonus` in `src/game/deal.ts` |
| Reserve size | `BASE_CELLS`, `cellsFor` in `src/game/deal.ts` |
| Modifier threat and availability | `MODIFIERS` in `src/game/content.ts` |
| Rule-modifier cap | `pickModifiers` in `src/game/run.ts` |
| Reward and shop mix | `makeRewards`, `makeShop` in `src/game/run.ts` |
| Search effort | `findSolution` in `src/game/solver.ts` |

---

## 7. Known gaps

- No leaderboards, achievements or cloud save — every one of those needs a
  backend, and the game is deliberately offline for now. The daily deal is
  seeded from the date, so a leaderboard is a small addition later.
- No localisation pass; all copy is English and hard-coded.
- Difficulty at the shallow end is set by `slack`, not by search quality (see
  the measurement in §2). Whether level 1 at ~1.9× is the right welcome is a
  judgement call that wants real players, not more telemetry.
- Landscape and tablet layouts are locked to portrait rather than designed.
