# Facedown — design notes

This document records what the game is, why each piece is shaped the way it is,
and where the knobs are.

---

## 1. The core loop

**Goal of a level:** get every card face-up in a tableau column. Not merely
turned — *placed*. There are no foundations, so nothing ever leaves the board.

That single subtraction changes solitaire completely. In Klondike, the
foundations are a sink: any card can eventually leave the board, which is what
keeps the tableau from jamming. Take the sink away and the tableau is a closed
system. The first prototype of this game did exactly that, and **7 out of 10
deals were provably unwinnable** — a brute-force search of the entire reachable
state space terminated in fewer than a dozen states. The board simply locks.

Two mechanisms fix it, and both became central to the design.

### The draw pile

A stock and a waste in the Klondike shape. Turning a card off the pile costs a
move, and the waste's top card is playable while everything under it is buried
until you play it off — so the real decision is *when* to draw, not whether.

**A card on the waste is seen, not sorted.** The first version counted a drawn
card as revealed, which meant a third of the goal could be bought by tapping
the pile with no thought at all — a playtester spotted it immediately. The win
condition now requires the waste to be empty as well: every card the pile hands
you has to find a home in a column. `remaining = hidden + waste` is what the
HUD counts down, and draining the whole pile moves it by exactly zero.

That change would strand a level permanently the first time a card came up
with nowhere to go, so the waste can be turned back over — twice by default,
each turn costing a move. Cards keep their face on a second pass; they have
been seen, and the pile is drawn as backs regardless because a pile is a pile.

Re-measured after the change: still 10/10 solvable at seven columns, with par
rising from about 26 to about 32 because every drawn card now has to be
placed rather than merely flipped.

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
| Staircase deal, 7 columns | 0 / 10, solver cleared 9-10 / 10 |
| Staircase deal, 6 columns | 0 / 10, solver cleared 6 / 10 |
| Waste must be emptied too, 7 columns | 0 / 10, solver cleared 10 / 10 |

The last row looks worse than it plays: three candidates are tried before any
easing, so ~94% of six-column deals still land at full difficulty.

The headline is the third row. **Column count dominates, not pile size.** Empty
columns are the only true sink in the game — the one place any card can go —
so a narrow tableau locks solid no matter how generous the pile is. That is why
the column floor is six, why `Cramped` was retired (against a six-column floor
it could only ever deliver one fewer column while promising two), and why
relaxation now *widens the pile*, which shortens the tableau, rather than
handing out more parking space.

### The shape of the deal

The tableau deals in the Klondike silhouette: one card in the first column
rising to a deep pile in the last, with exactly one card face-up per column.
An earlier version dealt even columns with two face-up cards each and a
playtester's reaction was immediate — it read as a grid rather than a game of
solitaire. The staircase is not decoration; the shape is what makes the board
legible at a glance.

It also carries the early-game difficulty curve. The draw pile's share of the
deck falls from 46% to 30% over the first six levels, so the staircase visibly
deepens as you descend — a shorter climb at the start, not a board that looks
half-finished. Buried cards per board went from about 14 under the old even
deal to about 21 under this one.

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

### The allowance is par plus a surplus

Stated as a multiplier, the slack was invisible: the player saw one number and
could not tell how much of it was theirs. It is now an explicit sum.

**Par** is what the board costs — the length of a line the solver actually
found. **Surplus** is everything on top, and it is the only part the player
owns: it pays for mistakes, for exploring a line that turns out wrong, and for
every reading. The HUD shows it live as `15 spare · par 36`, recomputed as
`movesLeft − (par − movesUsed)`, so the cost of a reading is watched leaving
the same pot as the cost of a bad move.

Three consequences, all of them the point:

- **There is always something to spend.** The surplus is floored, so a board can
  never arrive with nothing to work with — which is what made a move-priced hint
  unusable under the old multiplier.
- **Modifiers cut the surplus, never par.** Austerity, gauntlets and Wardens all
  shave the spare. The allowance therefore cannot be pushed below a winnable
  line by any combination of them, which used to require a separate clamp.
- **Failure stays real.** The surplus falls from about 15 at stage 1 to 4-6 by
  stage 10. At that point one reading is a quarter of everything you have.

Measured across simulated runs:

```
stage   cards cols pile hidden   par budget spare
    1      28  7.0 13.0   21.0  34.6   49.1  14.5
    5      29  6.8 10.3   22.4  34.4   41.8   6.9
   10      30  6.6  9.4   23.1  36.6   42.0   4.3
   12      31  6.9  9.6   23.5  35.8   43.0   4.8
```

`npm run balance` regenerates this table.

### The allowance floor is absolute

Austerity, gauntlets and wardens all scale the allowance down. Once slack got
as tight as 1.05, those multipliers could push the budget *below* par —
handing out a board that provably could not be cleared. The allowance is now
clamped above par unconditionally and the modifier sweep asserts it. A loss has
to be the player's line, never the deal's; that is the one property the whole
design rests on.

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
queue ──▶  play  ──▶  reward  ──▶  [market every 3rd stage]  ──▶  queue ...
      └─▶  skip  ──▶  buff      ──▶ ...                          └─▶ run over
```

The run is a **queue you can read ahead**, not a fork you pick blind. The next
three stages are shown with their rules, and the Warden at the end of the
stretch is telegraphed from the moment the stretch begins — you are meant to be
building towards it.

Every stage but the first and the Wardens can be **walked past** — but nothing
is really avoided. **A board you duck sinks, and surfaces again a few stages
down as the same deal with a third less surplus**, labelled Resurfaced, and it
cannot be ducked a second time. It berths itself around Wardens and around
other sunken boards, and the queue screen names the stage it is coming back at,
so the debt is always visible before you take it on.

Skipping also pays nothing at the time: no spoils, no gold, no score. What it
leaves is a debt the market owes you — **and the market only honours it once you
have cleared a board.** Each vouched-for skip puts one extra piece of stock on
the next market's shelf, from the better pool, at half price.

So skipping is a wager on your own survival, twice over. Duck the board you
think will kill you, clear the next one, and the read pays off at the market —
but the board itself is still coming, on a stage you will be worse equipped for
than the one you dodged. Duck everything and you assemble a queue of your own
avoidance.

Making the returning board harder by *cutting its surplus* rather than stacking
another modifier onto it is deliberate: it needs no conflict checking, it cannot
produce an unwinnable combination, and it leans on the currency the whole game
already runs on.

Two earlier versions were wrong in opposite directions. The first handed out a
buff immediately, which made skipping a value proposition rather than a hedge —
with something to gain and only score to lose, the optimal line drifted towards
ducking anything uncertain. The second paid nothing at all, which made the
button hard to ever justify pressing. Deferring the payment behind a clear fixes
both: the upside is real, and you only collect it by doing the thing the skip
was avoiding.

Two counters, and the split is the point:

- **stage** — levels *faced*, cleared or skipped. Difficulty keys off this.
- **depth** — levels *cleared*. This is the score.

So ducking a board buys no respite at all: the next one is harder and nothing
was banked. Skip your way to a Warden and you meet it with the deck you started
the stretch with, and a score that never moved.

An earlier version offered three simultaneous boards. It fell flat, and the
reason is worth recording: **because the allowance is derived from par, adding
modifiers largely self-compensates.** A harder board makes the solver work
harder, which raises par, which raises the budget. The threat pips were close
to cosmetic. Difficulty that actually bites has to come from what par cannot
see — undos, passes through the pile, information — which is what the Wardens
and the hot stages lean on.

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

## 5a. The Oracle

Every board is solved before it is dealt, which means this game knows things no
other card game can know: whether you are still winning, what the line is, and
exactly which move threw it away. Spending that on a hint button was a waste of
the only genuinely unusual thing in the design.

Readings are questions put to the solver, paid for in **moves**:

| Question | Cost | What it runs |
| --- | --- | --- |
| Am I still winning? | 1 | `winnableInBudget` at the current position, and if not, how many moves short |
| What should I play? | 2 | the next move of a found line, marked on the board until you move |
| Where did I go wrong? | 2 | the post-mortem's binary search, plus an offer to step back to it |

Two things make this work rather than being a cheat button:

- **It is paid for out of the surplus** — the same moves you would otherwise
  spend on mistakes. That is the whole trade: certainty now, or room to be wrong
  later. An earlier version gave readings their own currency, which was safer
  and much less interesting; the allowance was restated as par plus an explicit
  surplus (below) precisely so that one currency could do everything.
- **The cheapest question is the most interesting one.** "Am I still winning?"
  costs one move and tells you nothing about *what* to do — only whether the run
  is already over. Knowing you are dead and choosing whether to spend undos is a
  better decision than being handed a move.

The third question closes the loop with the post-mortem: the same analysis that
explains a loss afterwards can be bought *during* the level, and it offers to
rewind to the last position that was still winnable. A run that would have
ended can be recovered, if you have the undos and thought to ask.

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

## 5c. Losing well

The design goal from playtesting was that a loss should feel like a near miss
you can diagnose — "I could have made that with one different move" — rather
than an arbitrary wall. The solver already knows the answer, so it is asked.

On a loss the run is replayed and two questions are settled:

- **Where did the line close?** Binary search for the last position from which
  a win was still reachable inside the allowance that remained. The search is
  exact, not a heuristic: if a position cannot be won inside its remaining
  allowance then neither can any position after it, since any winning line from
  the successor, prefixed by the move that produced it, would have won from the
  predecessor with more to spend. "Unwinnable" is monotone along the played
  line, so the boundary falls out in log time.
- **How short was the finish?** Solve the final position ignoring the
  allowance and compare.

Those two numbers become a sentence that names the move that cost the run and
the enchantment that would have covered the gap — three moves short reads as a
Beacon, a Kickback or a Spare Sleeve; a line thrown away well before the end
reads as Loaded Dice. The whole analysis runs in about 350ms, after the screen
is already up.

One subtlety that had to be fixed to make it honest: hints, and undos under
Glasswork, spend moves without appearing in the replayed move list. Left
uncorrected the analysis would have started from a budget the player never had
and cleared them of a loss that was genuinely theirs.

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
| Loss analysis and its copy | `src/game/postmortem.ts` |
| The Oracle's questions and prices | `src/game/oracle.ts` |
| Difficulty curve | `spareFractionFor` / `surplusFor` in `src/game/deal.ts` |
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
