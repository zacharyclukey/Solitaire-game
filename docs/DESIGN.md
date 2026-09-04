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
4. Price the level from a second solve of the *same board with the player's
   enchantments stripped off*, and pay that as a stipend into a bank the player
   carries between levels.

This gives three properties that would otherwise be very hard to get:

- **Every board is clearable.** Not "probably" — a concrete line exists and was
  found before the cards were dealt.
- **Difficulty scales with the actual board**, not with a designer's guess.
- **The ceiling is well-defined.** The stipend ratio falls through 1.0 and keeps
  falling, so the deepest levels demand that you match a searcher move for move
  and then better it. That *is* the top of the difficulty curve, and it is
  reachable rather than arbitrary.

### Moves are a bank, not an allowance

A level does not hand out its own budget any more. The player carries a **bank**
across the whole run; each level pays in a **stipend**, and whatever is not
spent carries forward.

```
level start:  movesLeft = bank + stipend
level clear:  bank = movesLeft
level fail:   run over
```

The stipend is `plainPar × ratio(stage)`, where **plainPar** is the solver's
line on that same board with the player's enchantments taken off and their
curses left on. Pricing off the plain board is the load-bearing decision. The
previous model derived the budget from the player's *own* par, so a better build
shortened par and shrank the budget with it — the build was absorbed rather than
rewarded, and a player who improved got a tighter game for it. Priced blind, a
move the build saves is a move the player keeps.

`ratio` starts at 1.30, crosses 1.0 around stage 9 and decays geometrically
after 17. Below 1.0 a level no longer funds itself, and `(1 - ratio) × plainPar`
is an exact statement of how much work the build has to do to cover the
difference.

Two consequences worth stating plainly:

- **The loss condition is ordinary.** A run ends because a board was lost. That
  used to be impossible by construction — every board was certified clearable
  inside `bank + stipend` and eased until it was — and that contract is
  **retired**. Deals are honest shuffles now, selected on estimated win chance
  rather than proven winnable, and roughly a fifth of boards have no line a
  player will find. Bankruptcy survives only as a floor: a board with
  essentially no chance is not dealt at all.
- **The Oracle and undo got more expensive without changing price.** They always
  cost moves; now those moves would otherwise have carried, so a reading on
  stage 3 is felt on stage 12.

The HUD reads `12 carry · par 36` — what you would bank if you finished from
here on the solver's line.

Measured drain per level (20 seeds, fixed 28-card deck, solver play, bank 45),
re-measured after the draw-pile floor moved to 0.38:

```
stage  ratio   bare    4 ench   8 ench
    2   1.70  +27.3    +29.7    +30.0
    6   1.55  +20.5    +22.7    +23.8
   10   1.25   +9.5    +11.5    +12.6
   14   1.10   +4.0     +5.9     +7.0
   18   1.07   +2.5     +4.5     +5.6
   22   0.94   -2.0     -0.1     +1.0
```

This is the optimistic bound rather than the balance. The solver spends exactly
par, so it banks everything the ratio pays above 1.0 and does not bleed until
stage 22. A bounded-lookahead player needs a median 129% of plainPar, and
against that the ratio turns somewhere around stage 14 to 18 — which is where
the curve is meant to bite. The build keeps its edge either way: an
eight-enchantment deck banks 2 to 3 more moves a level than a bare one at every
stage. Full working, caveats and the ways this
could still break: `docs/ECONOMY.md`.

A methodological note, because it nearly cost a wrong conclusion: at twelve
samples a stage the run-to-run noise on the relaxation rate is about ±14
points. Two intermediate tunings that looked like a 19%-versus-31% difference
were inside that noise. The numbers above are from 400 deals; per-stage
comparisons below about 20 samples should not be trusted.

`npm run balance` regenerates this table.

### A board is never dealt that cannot be paid for

Austerity, gauntlets and wardens all scale the stipend down, and past stage 9
the ratio is below 1.0 besides — so unlike the old model there is no clamp
holding the allowance above par. There cannot be one: a purse that always
covered the board would be a game that never ended.

What is guaranteed instead is that the *shortfall is never sprung on the
player*. Before a board is accepted the deal checks it against `bank + stipend`
and keeps easing until the line fits, and if nothing it can build is payable the
run ends at the queue screen as bankruptcy rather than dealing a board that was
lost before the first card moved.

Easing is a real lever here but a bounded one. With plainPar close to par the
shortfall is `par × (1 - ratio) - bank`, so a shorter board does close the gap —
but only while the bank is non-empty. Arrive at a sub-1.0 stage broke and with
no build to widen plainPar, and no board exists that you could afford; the deal
detects that case up front instead of spending its whole deadline rediscovering
it. That is the intended way to lose, and it is an economic loss rather than an
unfair one: it was visible in the bank for several levels beforehand.

### Guaranteed playability

If a modifier combination resists the solver, the deal is **eased in steps**
rather than shipped broken: widen the reserve, then widen it again, then turn one
more card face-up per column, and only as a last resort drop the placement-rule
modifiers. The level records how far it had to be eased, which is what the
telemetry column `relaxed` reports. Measured over 400 deals, it is untouched
through the first five stages and affects about 22% of deals past stage 12 —
down from 42%, with deals the solver could not clear at all falling from 3.8%
to 0.5%. What closed most of that gap was structural rather than per-modifier:
**board-tag modifiers are now capped at two per level** (three on a Warden).
Those are the ones that add cards and curses, and stacking three or four of
them was what made the deep game unshippable at its stated difficulty.

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

- `rule` — rewrites placement (Suit Lock, Inversion, Gridlock, Tithe, Stiff
  Deck, Low Ceiling, Loose Weave)
- `board` — reshapes the deal (Narrow, Open Ground, Shallow Deal, Deep Deal,
  Deep Frost, Leadfoot, Shroud, Overgrowth, Doppelgänger)
- `meta` — touches the surrounding resources (Austerity, Rush, Steady Hand,
  Glasswork, Bounty, Windfall)

**A level takes at most one `rule` modifier and at most two `board` modifiers**
(three on a Warden). These are the most important balance constraints in the
game: rule modifiers compose badly, and board modifiers each add cards or
curses, so three or four together bloat a deal past what the solver can clear.

Three rule modifiers have been retired outright rather than retuned, each after
measurement showed it broke boards faster than it made them interesting:
**Sealed Ground** and **Royal Gates** both throttled empty columns, which are
the only true sink in the game, and **Rust** forbade group moves entirely,
which Gridlock already does more gently. Royal Gates was retuned twice before
being cut; at 63% needing relaxation it was still the worst thing in the table.

Every modifier carries a `threat` weight; a node picks modifiers until it hits a
depth-scaled threat target, so difficulty rises smoothly without a hand-authored
table per level.

---

### Suit Lock is fine on its own; it was the pairing that hurt

Suit Lock forces same-suit stacking instead of alternating colour, and it was
long recorded as the worst offender in the set at a 53% clear rate. That number
is from an old generator and does not survive re-measurement. Twenty boards a
row at stage 8, unlimited bank so only the board is under test:

```
control            20/20   median spend 113% of plainPar
Suit Lock          18/20                 114%
Suit Lock + Narrow 13/20                 110%
```

On its own it costs ten points and does not change what a board costs to play at
all — an entirely reasonable price for a threat-8 rule that changes how every
placement has to be thought about. What was actually expensive was pairing it
with Narrow, which takes away a column: two different attacks on the same scarce
resource, since same-suit stacking and one fewer column both reduce where a card
can go.

That pairing is already impossible. Narrow excludes Suit Lock, added when the
sink-removing modifiers were repriced, so the combination cannot be drawn. No
further change was needed and Suit Lock keeps its full effect.

### Two passes over the draw pile is the right number

A card drawn with nowhere to go sits on the waste, and when the passes run out
it can never come round again. Losses in play end with several cards stranded
there, which made the two-pass limit look like the culprit.

It is not. `scripts/passes.ts` replays identical boards with the limit raised to
three and five — only ever raised, so every variant stays inside the board's
original certification — and the clear rate does not move at all:

```
stage  passes 2   passes 3   passes 5
    1    16/16      16/16      16/16
    8    15/16      15/16      15/16
   14    15/16      15/16      15/16
```

Median spend is unchanged too. When this player loses with six cards on the
waste, three more passes show it the same six unplaceable cards. The waste is
stranded because the tableau can no longer accept those ranks, not because the
pile stopped coming round — the limit was never the binding constraint.

So the limit stays at two. The stranded waste is a symptom of a tableau played
into a corner, and anything that helps is help with the tableau — clearer
feedback, a better reading — not a more generous pile.

### The build has to compound, or it buys nothing

Measured with `scripts/compound.ts` (20 boards at stage 8, bounded-lookahead
player, unlimited bank so only the build is under test). "Kept" is what the
level leaves behind — stipend, minus what was spent, plus anything the build
handed back:

```
kit           ench   median par   median kept
bare             0           41             8
adding           4           39             1
adding           8           37             2
adding          12           36             3
compounding      4           39            12
compounding      8           38            20
compounding     12           37            25
```

The classic enchantments are **flat at 1-3 moves however many you own**, and
below a bare deck. That is not a tuning problem, it is the shape of the cards:
one card, one effect, fires when drawn, done. They add and never multiply, so a
run where the build and the play click together was unreachable by construction.

Worse than flat, they read as slightly negative, and the mechanism is worth
naming. Par is certified by a solver that plays enchantments perfectly, so an
enchanted deck is handed a board that needed those enchantments to be solvable —
and then a human cannot extract what the searcher could. The classic kit buys
the *board* difficulty without buying the player the means to meet it.

Conduit and Resonance are built to multiply instead. Conduit turns the nearest
face-down enchanted card, so chains are something the player assembles rather
than stumbles into; Resonance pays a move for every other enchanted card already
face-up, so density is worth more than the sum of its cards. Both give value a
fallible player actually collects, and the result climbs with build size —
12, 20, 25 — instead of sitting flat.

This is the mechanism behind the rare run where everything clicks, and it is
deliberately capped by the ratio's geometric decay: a compounding build buys
depth, not immortality.

### Which enchantments actually save a board

Flavour is not evidence, and the run-over screen makes a promise about this. So
it is measured: `scripts/enchaudit.ts` deals boards, keeps the ones the
bounded-lookahead player loses at a realistic budget, then puts each enchantment
on each of six plausible cards — buried, column tops, top of the draw pile — and
counts the ones that turn the loss into a win. 42 boards at stages 4, 8 and 12;
19 of them lost; the fallible player rather than the solver, because a solver
extracts value from a card no person would find.

```
Anchor          7/19   37%
Ember           5/19   26%
Prism           5/19   26%
Torch           4/19   21%
Bridge          4/19   21%
Twin            4/19   21%
Kickback        3/19   16%
Featherweight   3/19   16%
Chameleon       1/19    5%
Keystone        0/19    0%
Gilded          0/19    0%
Beacon          0/19    0%
```

Anchor leads because it manufactures the scarce resource: with no foundations,
somewhere to put anything is the whole game.

**Keystone was genuinely dead**, and for an embarrassing reason: its entire
effect was bypassing empty-column restrictions and paying no entry cost, and
under standard rules there are no restrictions to bypass and the entry cost is
zero. It did *nothing at all* unless Royal Gates, Sealed Vaults or Tithe
happened to be in force. It now enters an empty column for free — a real saving
on every board, and it reads the same on the card.

That buff did **not** move its save rate: still 0/19 on a re-run. Which turned
out to be the useful finding, because it is the same zero as Gilded's and
Beacon's, and it exposes what this metric cannot see.

**The audit measures board-saving, and the bank made that a different thing from
run-saving.** A card worth one move cannot flip a board that was lost
structurally, so every economy enchantment scores near zero here however good it
is. Gilded pays gold and should never turn a board. Beacon's two moves now carry
forward instead of evaporating, which makes it better than it was, not worse.
Kickback refunding three moves a board is thirty banked moves over ten levels —
entirely invisible to this test. None of these should be cut on this evidence;
what they need is a run-level measurement, which the carried bank finally makes
meaningful.

So the honest reading of the table is narrower than it looks: it ranks
enchantments by their power to rescue a board that is already going wrong, and
that is exactly the claim the run-over screen makes. It says nothing about which
enchantments are worth buying.

One methodological warning. An earlier version of this audit only enchanted deep face-down cards and scored
every placement effect at zero. That was the method, not the cards — Anchor rose
from 26% to 37% and Prism from 16% to 26% once the sample spread across column
tops and the draw pile. Worth remembering before cutting anything on one sweep.

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
| Difficulty curve | `ratioFor` / `stipendFor` in `src/game/deal.ts` |
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
- Difficulty at the shallow end is set by `ratioFor`, not by search quality (see
  the measurement in §2). Whether stage 1 at 1.30 is the right welcome is a
  judgement call that wants real players, not more telemetry.
- **There is no clearability guarantee any more, on purpose.** It was retired
  when deals became honest shuffles. The number that replaced it is the
  estimated win chance in `src/game/odds.ts`, and about a fifth of boards are
  lost whatever the allowance. Six-column boards remain the sharpest edge, at
  76% against 91% for seven.
- **The win curve in `odds.ts` was re-measured after the pivot and held.** It
  was originally taken on a generator that eased boards until they fit, so it
  was the most load-bearing possibly-stale number in the project; a second sweep
  on honest shuffles moved every point by 5 points or less, inside the noise at
  40 samples. The two sweeps are pooled, so it now rests on 80 boards a point.
- **The economy is tuned against the wrong player.** A shallow player needs a
  median 1.0-1.7x par and the stipend pays 0.90x plainPar by stage 10, so full
  runs with that player end around stage 2-3 rather than 15. The ratio curve
  needs recalibrating against a human-shaped player, not the solver. Numbers and
  caveats in `docs/ECONOMY.md`.
- Landscape and tablet layouts are locked to portrait rather than designed.
