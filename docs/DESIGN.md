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

### The draw pile

A stock and a waste, in the Klondike shape but with one pass and no recycle.
Turning a card off the pile costs a move; pile cards count as face-down, so the
pile has to be emptied to win. The waste's top card is playable and everything
under it is buried until you play it off — so the real decision is *when* to
draw, not whether.

An earlier version used a FreeCell-style reserve of free cells instead. Both
were chosen the same way — by exhaustively searching the reachable state space
of raw boards, no relaxation and no retries, and asking whether a win exists at
all:

| Board | Provably unwinnable |
| --- | --- |
| No reserve, no pile, 7 columns | 7 / 10 |
| Reserve of 1 cell | 0 / 10 |
| Draw pile of 11, 5 columns | 6 / 10 |
| Draw pile of 11, 6 columns | 0 / 10 |
| Draw pile of 8, 7 columns, 1 face-up | 0 / 10, solver cleared 10 / 10 |

The headline is the third row. **Column count dominates, not pile size.** Empty
columns are the only true sink in the game — the one place any card can go —
so a narrow tableau locks solid no matter how generous the pile is. That is why
the column floor is six, why `Cramped` was retired (against a six-column floor
it could only ever deliver one fewer column while promising two), and why
relaxation now *widens the pile*, which shortens the tableau, rather than
handing out more parking space.

The pile is 30% of the deck. That leaves the tableau wide and shallow: more
columns to work with, fewer cards buried in each, and a steady trickle of new
destinations from the waste.

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

`slack` runs from 1.45 at depth 1 down to a floor of 1.05 by depth 10 — a
deliberate tightening after a playtest reported never coming close to running
out. Since par is near-optimal, 1.05 means near-perfect play. Measured across
simulated runs:

```
depth   cards cols pile hidden   par budget slack
    1      28  7.0  8.0   14.0  23.4   36.3  1.55
    5      29  7.0  7.9   22.1  32.1   38.3  1.19
   10      29  6.8  8.8   22.1  31.3   30.0  1.05
   14      30  6.6 11.0   20.0  30.5   32.8  1.07
```

`npm run balance` regenerates this table.

### Guaranteed playability

If a modifier combination resists the solver, the deal is **eased in steps**
rather than shipped broken: widen the reserve, then widen it again, then turn one
more card face-up per column, and only as a last resort drop the placement-rule
modifiers. The level records how far it had to be eased, which is what the
telemetry column `relaxed` reports. In current tuning it is untouched
through the early game and affects roughly a third of deals past depth twelve,
where several modifiers stack.

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

Par — the length of the line the solver found — is shown on the HUD as you
play (`8 of par 24`), because a comfortable clear and a narrow one otherwise
look identical. Beating it pays gold, which is a hard ask when par is close to
optimal.

**4 curses** — *Leaden* (costs an extra move), *Frozen* (immovable until enough
cards have turned), *Rooted* (never enters an empty column) and *Shrouded* (does
not turn by itself; you pay a move for it).

**15 charms**, run-wide passives: more moves, more undos, more reserve, gold
multipliers, and a few that switch a rule off (`Locksmith` ignores empty-column
restrictions; `Sorting Tray` ignores Rust).

**22 level modifiers**, each tagged:

- `rule` — rewrites placement (Suit Lock, Inversion, Rust, Gridlock, Royal
  Gates, Tithe, Stiff Deck, Low Ceiling, Loose Weave)
- `board` — reshapes the deal (Narrow, Open Ground, Shallow Deal, Deep Deal,
  Deep Frost, Leadfoot, Shroud, Overgrowth, Doppelgänger)
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

## 5b. Teaching it, and the reason to come back

**The guided board.** The first level a new player sees is hand-authored, not
generated, because the teaching order matters more than the variety. Fourteen
cards, five columns, three reserve cells, and five lessons in the order the
game actually needs them: stack a card, park one in the reserve, empty a
column, move an ordered run, and only then the move allowance.

Two properties make it work, and both are asserted by tests so a future edit to
the layout cannot quietly break the script:

- At the start there is **exactly one** stacking move available, and taking it
  turns a card — so the first lesson demonstrates the goal, not just the rule.
- Two moves later the 9 is **genuinely stranded**, because nothing in the deck
  is a ten. The reserve lesson lands because the board forces it, not because
  the text asks for it.

The coaching highlight is derived by matching the lesson rather than by asking
the solver, so the arrow can never contradict the sentence beside it, and it
re-derives after every move — improvise and the lessons still advance on what
you actually did.

**Achievements.** Depth alone is a thin reason to start run number two. Twenty
achievements pull in other directions: clear a level with two moves to spare,
or without parking a single card, or carrying three cursed cards; cut the deck
to eighteen or grow it to forty; turn four cards with one move. Each is a pure
predicate over a context the controller assembles at three moments, so the set
is testable without a browser. Records also keep the last twenty-five runs with
their seeds, because "that was a good one" should be replayable.

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
| The guided board and its lessons | `src/game/tutorial.ts` |
| Achievements | `src/game/achievements.ts` |
| Difficulty curve | `slackFor` / `flatBonus` in `src/game/deal.ts` |
| Tableau / pile split | `STOCK_SHARE`, `stockFor`, `MIN_COLUMNS` in `src/game/deal.ts` |
| Modifier threat and availability | `MODIFIERS` in `src/game/content.ts` |
| Rule-modifier cap | `pickModifiers` in `src/game/run.ts` |
| Reward and shop mix | `makeRewards`, `makeShop` in `src/game/run.ts` |
| Search effort | `findSolution` in `src/game/solver.ts` |

---

## 7. Known gaps

- No leaderboards or cloud save — both need a backend, and the game is
  deliberately offline for now. The daily deal is seeded from the date, so a
  leaderboard is a small addition later.
- No localisation pass; all copy is English and hard-coded.
- Difficulty at the shallow end is set by `slack`, not by search quality (see
  the measurement in §2). Whether level 1 at ~1.9× is the right welcome is a
  judgement call that wants real players, not more telemetry.
- Landscape and tablet layouts are locked to portrait rather than designed.
