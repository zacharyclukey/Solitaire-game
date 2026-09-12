# The move economy

Status: **built and measured.** The drain table below is real; the run-length
estimates derived from it are not, and are marked as such.

## The change

Moves stop being a per-level allowance and become a **bank carried across the run**.

```
level start:  movesLeft = bank + stipend(level)
level clear:  bank = movesLeft          // leftovers carry
level fail:   run over
```

The run is no longer a series of independent puzzles. It is one resource curve with
puzzles attached, and the question at every board stops being "can I solve this"
and becomes "how cheaply can I solve this".

## Why this and not the per-level budget

Today `budget = par + surplus`, and par is solved on the player's *actual* deck —
enchantments included. A better build shortens par, and the budget shrinks with it.
The build is absorbed instead of rewarded. The bank fixes this structurally rather
than by patching the formula: any move your build saves is money you keep.

It also gives an honest loss condition. You do not die because a board was
unwinnable; you die because you spent too much three levels ago.

## The stipend must be build-blind

```
stipend(level) = round(plainPar(deal) * ratio(stage))
```

`plainPar` is the solver's line on the same deal with **enchantments stripped and
curses kept**. Build-blind is the whole point: if the stipend tracked your real par,
we would be back to absorbing the build.

Proposed ratio curve — to be tuned by measurement, the shape matters more than the numbers:

| stage | ratio | meaning |
|---|---|---|
| 1-3 | 1.30 | bank a cushion, learn the loop |
| 4-6 | 1.15 | comfortable if you play well |
| 7-9 | 1.00 | break-even for a perfect line |
| 10-13 | 0.90 | bare deck now runs a deficit |
| 14-17 | 0.82 | build is load-bearing |
| 18+ | `0.82 x 0.97^(stage-17)` | keeps falling, never flat |

The tail is geometric rather than floored. A floor would be a ceiling on
difficulty, and a good enough deck would sit above it forever.

`(1 - ratio) * plainPar` is exactly the gap the build has to cover. That is the
tunable answer to "eventually only solvable because of their build" — it is a number,
not a vibe, and it can be pointed at.

## What it actually does

Measured with `scripts/economy.ts`: 20 seeds per row, a fixed 28-card deck, a
constant bank of 45, solver play. "Drain" is what the bank gains or loses on
that level — the number that decides how long a run lasts.

| stage | ratio | drain, bare deck | 4 enchantments | 8 enchantments |
|---|---|---|---|---|
| 2 | 1.70 | +25.4 | +26.4 | +27.2 |
| 6 | 1.55 | +20.5 | +21.1 | +22.3 |
| 10 | 1.25 | +9.8 | +10.5 | +11.5 |
| 14 | 1.10 | +3.9 | +4.6 | +5.6 |
| 18 | 1.07 | +2.8 | +3.5 | +4.5 |
| 22 | 0.94 | **-2.5** | -1.9 | -0.7 |

**Read this as the optimistic bound, not the balance.** These are solver runs,
and the solver spends exactly par, so it banks the entire margin the ratio pays
above 1.0 and does not start bleeding until stage 22. A player who needs 129% of
plainPar crosses over far earlier — against the measured need the ratio turns
against them somewhere around stage 14 to 18, which is where the curve is meant
to bite. The row that used to carry the design's headline claim now sits at 22
for a solver and much earlier for anybody real.

The build's edge survives the repricing: at every stage an eight-enchantment
deck banks 2 to 3 more moves a level than a bare one, and its par advantage is
about 2.5 moves. That is "solvable because of
the build" as a number rather than a hope — though it is a weaker result than
before the boards were made humanly clearable, when the same row read +1.4
rather than break-even.

That cost is worth naming. A shallower tableau gives enchantments less to do:
the build's par advantage fell from 3.1 moves to 2.2, because Torch and Twin
reveal buried cards and there are fewer cards buried. **Making boards clearable
by a person made the build worth slightly less.** The two goals pull against
each other, and #18's retune has to hold both. By stage 14 everyone bleeds and the build
only buys a slower bleed, which is the other half of the brief — no deck clears
forever.

The mechanism underneath it: a built deck's par is shorter (27.4 vs 30.5 at
stage 14) while its plainPar is *longer* (31.8 vs 30.9), because a deck that can
clear harder boards gets given them. The build is paid twice — once in a
cheaper line, once in a bigger stipend — and neither payment is something the
old per-level budget could express.

**Two caveats, both of which understate difficulty.** The deck is fixed at 28
cards, so par barely moves across stages (30.5 at 6, 10 and 14 alike) and the
entire curve is currently carried by the ratio; in a real run the deck grows and
plainPar grows with it. And this is solver play. A human banks worse than a
perfect player, so real drains are steeper than these.

Deal cost rose from roughly 500ms to 450-580ms per level with the second solve
included, inside the 1200ms budget.

## Why this should terminate

The per-level deficit grows on two axes: ratio falls, and `plainPar` rises as the deck
grows. A build supplies a roughly fixed per-level saving, because enchantment count
grows slowly and each one only helps when its card is in the right place. So the
deficit should outrun the build and the bank should drain.

**Should.** This is the assumption most likely to be wrong, and it is the first thing
to measure. If build savings scale with deck size too, the curve is not enough and the
ratio needs to decay without a floor.

## What replaced the fairness invariant

**Retired.** It read: every board must be certified clearable inside
`bank + stipend`, and the generator eased deals until that held. That guarantee
is what flattened difficulty — it meant no shuffle could ever be unlucky, so no
card passed over in the shop could ever turn out to have been the one you
needed.

Deals are honest shuffles now. The solver is a measurement rather than a gate,
boards are selected against a band for the stage, and a large minority of them
have no line at all — not merely none a player finds (measured below). How large
depends on the depth: 1 board in 8 at stages 1 and 6, 3 in 8 at stage 12, more
than half at stage 18. What survives is a floor, and it is a floor on what the
money can buy rather than on the odds: a board costing more than about 1.005x
the allowance is not dealt (`AFFORDABLE_AT`). Gating on the odds instead would
end runs with a bankruptcy screen for the crime of being deep, which no purse
can fix — and that was a real bug once.

Two things were meant to carry the fairness that the invariant used to. Only one
of them does, and it is worth being exact about which:

- **A legible near miss.** `src/game/rescue.ts` replays a lost board with one
  enchantment added and names the card that would have won it, on the run-over
  screen. This works: it names a card on 24 of 25 lost boards, including 16 of
  the 17 with no line at all. A loss you can see the answer to is a roguelite;
  one you cannot is bad luck.
- **Escapes**, which do far less than this section used to claim. Pry, Dig and
  Reprieve are sold in the shop, one always in stock, and spent mid-board — but
  measured (`scripts/escapes.ts`, `docs/DESIGN.md` §6b) they convert 6-11% of
  lost boards, and on a board with no line at all essentially nothing works.
  **A dead board cannot in practice be bought out of.** They soften a board that
  was winnable and going wrong; they are not a way out of the shuffle.

So the fairness of a dead board rests almost entirely on being able to see what
would have won it, not on being able to buy your way past it. That is a thinner
promise than the retired invariant made, and it is the true one.

## Mechanics this opens up

The economy only matters if there are ways to bend it.

- **Lantern** — first Oracle question each level is free.
- **Reprieve** — first undo each level is free.
- **Featherweight** — this card costs 0 to move. Build-around: chain them.
- **Leaden** (curse) — this card costs +1.
- **Toll** (curse) — drawing costs 2 this level.
- **Interest** — end a level with bank >= threshold, gain a percentage. Creates a real
  hoard-versus-spend axis instead of "spend freely, it resets anyway".
- **Refund** — clear under a fraction of the stipend, get moves back. Pays efficiency directly.
- **Overdraft** — once per run, finish a level below zero; take a curse for it. A comeback
  path so one bad board is not silently fatal.
- **Moves as shop currency** — buy enchantments with banked moves. Power now against
  economy later, and it collapses the whole game onto one resource. Highest-variance
  idea here; build it behind a flag and measure it on its own.

## How to try to break it

1. **Death spiral.** One bad level, dead three levels later, no agency in between.
   The biggest risk. Note the fairness invariant is a natural rubber band (a poor bank
   forces easier boards) — check it does not make the game *too* forgiving instead.
2. **Hoarding dominance.** If never touching Oracle or undo is simply correct, those
   systems are decorative. Test a bot that uses them against one that never does.
3. **Infinite scaling.** A strong build outruns the ratio curve; runs never end.
4. **Front-loading.** A 1.30 ratio early may bank such a cushion that the interesting
   part never arrives. Look at the bank trajectory, not just the death stage.
5. **Illegible loss.** Correct but unreadable is still a bad loss.

## The skill gap, measured

`src/game/bot.ts` is a bounded-lookahead player — three plies, six moves
considered per ply, no memory of rejected positions, no undo. It values empty
columns explicitly, because they are the only real sink on a board with no
foundations and a human plays for one deliberately where a searcher just
stumbles into it. That term is a model choice, not a tuned one: at 12 boards,
weights between 0 and 2.5 were indistinguishable (106% / 105% / 102% moves over
par), and only an absurd weight of 5 clearly hurt at 223%. It is kept because it
describes how people play, not because it was measured to help.

Given a bank of 999, so that only skill is being measured
(`scripts/humanrun.ts boards`, 8 boards per stage):

| stage | boards won | median moves vs par | worst |
|---|---|---|---|
| 1 | 8/8 | 100% | 113% |
| 3 | 8/8 | 112% | 324% |
| 6 | 8/8 | 166% | 448% |
| 10 | **4/8** | 143% | 250% |
| 14 | 8/8 | 115% | 470% |

Two findings, and the second is the serious one.

**The curve is calibrated to a player who does not exist.** A shallow player
needs a median 1.0-1.7x par; the ratio pays 0.90x plainPar at stage 10. Solver
play made the economy look survivable because the solver *is* par. Full runs
with this player end at stage 2-3, not stage 15.

**By stage 10 half the boards are unwinnable for a shallow player at any
budget.** That is not an economy failure — 4/8 boards were lost with 999 moves
in hand. At the time boards were certified clearable by a weighted A\* search,
and past a certain depth that had quietly stopped meaning clearable by a person.
The guarantee has since been retired outright, so this reads now as an early
measurement of the thing the design later chose to embrace.

The honest caveat in both directions: this bot is a **lower bound** on human
skill, not a model of a good player. A person plans further than three plies and
recognises shapes. The real number sits somewhere between this and the solver's
1.0x, and nothing here says where. What it does establish is that the gap is
large, that it widens with depth, and that tuning the ratio against solver play
alone was measuring the wrong thing.

## Which boards a person cannot clear, and a warning about measuring it

`scripts/humanrun.ts diagnose` deals across stages 6-20 with an unlimited bank
and records the board's shape, its modifiers, and whether the fallible player
cleared it. 112 boards:

| stage | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 |
|---|---|---|---|---|---|---|---|---|
| before | 100% | 86% | 79% | 86% | 71% | 57% | 57% | 71% |
| after | 86% | 100% | 86% | 93% | 79% | 79% | 100% | 71% |

The stage effect was real and it was the problem: by the deep game a shallow
player failed two boards in five with money no object. After the fix below,
112 boards, it is 87% overall against 76%, and the deep-game collapse is gone —
stages 16 and 18 went from 57% each to 79% and 100%.

**Both rows above were measured on the retired generator**, which eased boards
until they fit the allowance, and that is why the deep stages read so well —
100% at stage 18 is a statement about relaxation, not about the game as it now
deals. Against honest shuffles the same fallible player with an unlimited bank
clears 18 of 24 at stage 12 and 13 of 24 at stage 18 (`scripts/deadboards.ts`,
2026-09-06), and most of what it fails are boards with no line at all rather
than boards it played badly. Keep the table for the shape of the fix it
records; do not quote its numbers.

This section used to close by naming columns as the sharpest remaining edge,
citing 76% at six columns against 91% at seven — and then contradicted itself
two sentences later with "column count barely matters (75% against 76%)". Both
figures are withdrawn. Neither survives a controlled test, because column count
is set by Narrow and Wide, which carry threat that the stipend compensates, so
the arms differ in more than width. Task #30 holds the controlled version. The
trailing note about how far a deal had to be relaxed is dead with relaxation
itself.

**The per-modifier breakdown from that sweep is not trustworthy, and it says so
itself.** Modifiers are drawn together and more of them means a deeper stage, so
every marginal effect is confounded with every other. The sweep's own output
contains two controls that prove it: Steady Hand scored -23pp and Austerity
-18pp, and *neither can affect this player at all* — Steady Hand only removes
undos, which the bot never uses, and Austerity only scales the stipend, which is
irrelevant at an unlimited bank. That is a noise floor of roughly 20 points, and
it swallows most of the table. Suit Lock at -34pp and Doppelganger at -32pp
clear it, but only by about twelve.

So the numbers worth acting on come from `scripts/humanrun.ts isolate`: the same
stage, the same seeds, one modifier or none. It is the slower experiment and the
only one that attributes anything. Twelve boards at stage 12, control 92%:

| hurts | | helps | |
|---|---|---|---|
| Narrow | -33pp | Wide | +8pp |
| Prism Rules (anyColor) | -33pp | Dense | +8pp |
| Thin Deal | -25pp | Deep Deal | +8pp |
| Suit Lock | -17pp | | |

Everything else landed at exactly +0pp, including Steady Hand, Austerity, Rush,
Glasswork, Bounty and Riches — which is the design validating itself, because
not one of them can affect this player.

### The modifier that was innocent

Prism Rules *relaxes* stacking, so -33pp made no sense. It is a bot artifact:
the modifier nearly doubles the branching factor (3.6 opening legal moves to
6.3), and a player that shortlists six candidates per ply therefore samples a
smaller fraction of them. Rerun at width 14 it recovers completely, 58% to 92%,
exactly matching control. Narrow does not recover — 58% at width 6, 50% at width
14 — which is how you tell a real structural loss from a limitation of the
instrument. Prism Rules was left alone; it would have been nerfed on the
strength of a number about the bot rather than about the game.

### What was actually wrong

Columns are the only sink in a game with no foundations, and the draw pile is
what keeps the staircase shallow. Both of the confirmed offenders take one of
those away, and all three helpers give one back.

Which indicts the difficulty model directly: `stockShareFor` fell to 0.30 past
stage 5, and shrinking the draw pile is *exactly what Thin Deal does*. The
game's main depth dial was the same lever that makes boards unclearable by a
person, applied to every player at every deep stage. It now stops at 0.38.
Depth does not need it any more — since moves became a bank, difficulty is
expressed through the stipend rather than by burying more cards than a player
can dig out.

Narrow is repriced from threat 3 to 6, so it crowds out other modifiers rather
than arriving alongside them, and it no longer combines with Thin Deal or Suit
Lock — the other two things that shrink the same resource.

## Two corrections from play

**Recycling the pile was a win.** Reported from play: with the tableau fully
face-up, sending the waste back round emptied the waste and left `hidden` at
zero, so `remaining` hit zero and the level declared itself won with every one
of those cards still sitting in the pile. `hidden` counts cards that are
face-down, and a card turned over on an earlier pass and then recycled is
face-up *inside the draw pile* — counted by neither term. `remaining` now walks
the pile. Turning those cards face-down again would be the tidier model and is
not available, because re-drawing them would re-fire Gilded, Beacon and Torch
and let a player farm gold and moves by cycling.

This costs clearability, and the honest reading is that the earlier number was
inflated: over 96 boards the fallible player now clears 80% at an unlimited
budget, against 90% measured before the fix. Some of that 90% was the bug
firing. 80% is the first figure measured against a correct win condition, and it
is still well above the 76% that started task #20.

**The first level is a coin flip.** At the stipend stage 1 actually pays, with
an empty bank, the bounded-lookahead player clears 5 of 10 opening boards. It
never gets stuck — it runs out of moves every time, with two to seven cards
stranded on the waste. This is the ratio miscalibration arriving at level one
rather than anything structural, and it is the sharpest evidence yet that the
curve was fitted to solver play. It belongs to the retune.

## Repricing the curve against a player

The first curve was fitted to solver play, and a solver spends exactly par by
definition. Measured against the bounded-lookahead player instead
(`scripts/humanrun.ts boards`, 20 boards a stage, unlimited bank, spend as a
fraction of plainPar because plainPar is what the ratio multiplies):

| stage | 1 | 3 | 6 | 8 | 10 | 14 | 18 |
|---|---|---|---|---|---|---|---|
| cleared | 20/20 | 18/20 | 17/20 | 19/20 | 15/20 | 14/20 | 15/20 |
| p50 need | 129% | 110% | 113% | 121% | 126% | 120% | 136% |
| p75 | 137% | 129% | 123% | 153% | 145% | 136% | 181% |
| p90 | 218% | 156% | 184% | 238% | 200% | 159% | 302% |

**The need is flat.** It does not grow with depth, which means the difficulty
curve really does live entirely in the ratio, as designed. It also means the old
curve was wrong at both ends: stage 1 paid 1.30 against a median need of 1.29,
so half of opening boards ran out of moves and — worse — nothing was ever banked
on the levels meant to fund the rest of the run; stage 18 paid 0.80 against a
need that had not fallen a point.

The curve now runs 1.70 down to 1.10 with the same geometric tail. The threshold
that matters is the player's need near 1.20, not 1.0. Paying par exactly was
always a loss for anybody who is not a search algorithm, which is why three
tests asserting a crossing at 1.0 had to be rewritten to assert the real one.

### Where this stops being answerable by measurement

With the new curve, no run in 48 went bankrupt — every one ended having run out
of moves mid-board, never stuck with moves in hand. The economy is no longer
what kills runs. But median depth is only 3, and the reason is a fat right
tail: the median board costs 110-130% and banks well, while the occasional board
costs this player 170-300% and it loses anyway.

Two controls say that tail is the player, not the boards. Doubling the search
width leaves the same boards lost at the same cost, and raising the cost weight
— making it hoard moves — does not lower spend at all at stage 1 and makes stage
8 markedly worse (126% to 153%). Inspecting a lost stage-1 board with no
modifiers at all: five cards on the waste, no passes left, and **22 legal moves
still available**. The position was winnable. The player had simply spent
everything getting there.

So funding this player to reach depth 10 would mean paying its p90, somewhere
above 200%, which would make the median board trivial for anyone competent. The
bot is a lower bound on human skill and its tail is where it plays badly, not
where the game is hard. **Calibrating run length against it would over-fund the
game**, so the curve is set from the p50-p75 of need and stops there. Where a
real player sits between this and the solver's 100% is not something any of
these instruments can answer; it needs playtest data.

## Why depth cannot be made harder with the modifiers we have

Board difficulty measured flat — 110-136% of plainPar from stage 1 to 18 — so
depth only ever made a board more expensive, never harder. The cause looked
obvious: `maxRules` was pinned at 1 in `pickModifiers` for every stage, so a
board could carry at most one rule-changing modifier however deep the run went,
and rule modifiers are the only ones that change how a board must be played.
Raising it to 1/2/3 with depth was the fix.

**It did not work.** Re-measured at 20 boards a stage, the need is still flat:

| stage | 1 | 3 | 6 | 8 | 10 | 14 | 18 |
|---|---|---|---|---|---|---|---|
| p50, before | 129% | 110% | 113% | 121% | 126% | 120% | 136% |
| p50, after | 129% | 110% | 113% | 124% | 120% | 127% | 127% |

The reason is a contradiction in the plan. Those modifiers were chosen *because*
the isolate sweep measured them at about 0pp against a 92% control — and
stacking things that cost a player nothing still costs nothing. The safe
modifiers are safe precisely because they do not add difficulty, and the ones
that add difficulty (Narrow -33pp, Thin Deal -25pp, Suit Lock -17pp) do it by
taking away columns or draw pile, which is what made boards unclearable in the
first place. **There is no free difficulty anywhere in the current modifier
set.** The cap change is kept for the variety it adds, not for difficulty, and
it slightly lowered stage-18 clear rate (15/20 to 13/20) for nothing.

### The lever the data pointed at, and why it was not one

**Superseded on 2026-09-06. This section proposed decision density — branching
— as the way to make deep boards demanding rather than merely expensive. It was
tested properly and it is wrong, in both halves.**

What it argued: Prism Rules cost the bot 33pp at search width 6 and nothing at
width 14, so it was a board with more to think about rather than fewer
resources, and new modifiers should therefore be aimed at branching — "more
legal placements, more live cards, more ways a line can fork."

Two things are wrong with that.

The evidence no longer exists. There is no Prism Rules modifier in the game;
`prism` is an enchantment id. Whatever that measurement was taken on has since
been cut, and the claim was never re-run against anything that ships.

And the hypothesis fails when measured. `scripts/rulecost.ts` deals one board
and flips a rule in place on a clone — same cards, same layout, budget removed
so nothing measured is price — because dealing each arm separately lets the
win-chance selector hand the harder rule an easier board and cancel the effect.
Across widths 4, 14 and 30, **no rule is a thinking tax.** Suit Lock costs 25
points at every width; Gridlock, Low Ceiling, Tithe and Stiff Deck cost nothing
once the budget is removed. Nothing recovers with a wider search. Full table in
`docs/DESIGN.md` §6a.

The prescription is worse than merely unsupported: it is backwards. Adding
legal placements is what Loose Weave does, and Loose Weave measures as a
17-point penalty that no amount of search recovers — it had been priced as a
*boon* on the strength of reasoning like this section's. Anchor behaves the same
way and is documented as the best rescuer in the game and the worst card to own.
Extra legal moves are mostly bad moves, and a bounded player drowns in them.

**Loosening a constraint is not a kindness in a game where the player has to
find the line.** That is the rule to carry forward, and it is the opposite of
what this section recommended.

## The economy has stopped being the limiter, and cannot become the answer

Full runs with the fallible player, **re-measured on 2026-09-08 after a harness
artifact was found and fixed** (see the correction note below), 30 runs a build:

```
build            median  mean   range   peak bank   bankrupt   out of moves   stuck
none                  2   2.6     0-9          21          0             30       0
every 4 levels        2   2.5     0-8          21          0             30       0
every 2 levels        2   2.2     0-7          20          1             28       1
```

Re-measured 2026-09-09, 30 runs a build. The table this replaces read median 3,
mean 3.2, peak bank 38, and 26 of 30 out of moves. It was measured by a harness
carrying two rules the game has since changed: it grew decks with a hand-copied
`newCard` that added exact (rank, suit) duplicates the generator no longer
produces and skipped the ladder footing, and it carried the whole leftover into
the next level, which was the unbounded bank ratchet. Both harnesses call the
game's own `growCard` and `bankCap` now, so this class of drift is closed rather
than patched.

**The bank cap does what it was built to do.** Peak bank falls from 38 to 21,
which is roughly one level's allowance, exactly the buffer it was capped to.

**But the headline claim above it no longer holds.** "Runs still do not end on
the economy" was true at one bankruptcy in ninety and a handful stuck. It is not
true now: **30 of 30 runs in the no-build arm end out of moves**, and nothing
ends stuck at all. Every run in the reference sample now ends on the allowance
rather than on the board.

That is in direct tension with the standing brief — *"Runs end because boards
outgrow the player, not because the allowance was quietly throttled"* — and it
is the predictable arithmetic of doing three things at once: `ratioFor` down
0.15 a step, the bank capped, and the under-par `bonusMoves` grant removed. Each
was measured on its own; the combination was not measured against this table
until now.

Two things to hold in mind before reacting. The reference player is deliberately
weak and does not use escapes, so median 2 is a floor rather than a typical run.
And the difficulty pass was asked for: the owner reported 600+ banked moves and a
game that did not bite. **Whether this is too far is a design call and is left
open here rather than reversed unilaterally.** What is not in doubt is that the
sentence above the table is now false, and it is corrected rather than left
standing.

### Loosening the allowance back does not buy depth

The obvious response to "every run ends out of moves" is to give some allowance
back. Measured, that does nothing. `scripts/ratiolab.ts`, 20 runs an arm, no
build, no charms, no escapes, with the current game run **twice, first and last,
as a control**:

```
ratio delta   median  mean   peak bank   out of moves   stuck   bankrupt
current            4   3.4          27             20       0          0
+0.05              4   3.5          31             20       0          0
+0.075             4   3.5          33             20       0          0
+0.15              3   3.0          34             20       0          0
current            4   3.4          27             20       0          0
```

The two control arms come out **identical**, so the instrument resolves what it
is being asked and the rows between them are real. And they say: restoring the
whole 0.15 that was taken away in the difficulty pass leaves median depth where
it was, moves mean depth *down* rather than up, and still ends 20 of 20 runs out
of moves. What it does buy is peak bank back up from 27 to 34 — the exact
problem the pass was asked to fix.

**The reason is structural, and it is the same mechanism behind every "nothing
moves the ceiling" result in this document.** Boards are selected against a band
for the stage — since 2026-09-12 on the realised spend ratio, `spendAt(stipend /
plainPar)` against `spendAt(ratioFor(stage))`, which is the same comparison in a
space that does not conflate the purse with the depth. A richer purse does not
buy an easier level; it buys a *board that needs more spending*, because that is
what the selector is for. The allowance is self-neutralising by construction, which is
why `ratioFor` is a poor difficulty lever in both directions and why the pass
that tightened it moved the per-board curve far less than it moved the feel.

So "runs end on the economy" is not a thing more allowance fixes. If the depth
is wrong, the levers are the board side — the modifier floor, deck growth, the
threat budget — or the escapes, which are the one thing measured to move the
ceiling at all.

**Runs now end on the economy, and that is new.** See the note above the table:
bankruptcy is still almost unheard of, but running out of moves on a board has
gone from 26 of 30 to 30 of 30, and the stuck cases have vanished.

An earlier version of this table read median depth 2 with 32 banked and zero
bankruptcies in every arm. It was measured on decks grown with uniform ranks
1-13, which the game never generates. That is the first of the three harness
corrections this table has now been through; the other two are described above.

Runs are short anyway, and the reason is arithmetic rather than balance. At
stage 1 the stipend pays 1.55x plainPar, which the measured curve puts at about
74% per level, and 0.74^5 is 22% — a mean depth of about 3, which is what is
observed. To reach a median depth of 8 a player needs about 92% per level.
(This paragraph said 1.70x, which `ratioFor` stopped paying on 2026-09-08. The
74% survives the correction by coincidence and is now measured rather than
inferred: re-measured 2026-09-12 at stage 1 alone, 62% clear at 1.4x and 78% at
1.6x, which interpolates to 74% at 1.55x.)

**The curve does not top out at one number, and that is new.** This section said
78%, taken as a per-level ceiling however much money is thrown at the board.
Re-measured 2026-09-12 (`scripts/odds.ts curve 20`, two independent seeds, 40
boards per stage per point) at a budget of 2.6x plainPar — large enough that it
essentially never binds — the ceiling is:

| stage | cleared at 2.6x plainPar | n |
|---|---|---|
| 1 | 88% | 40 |
| 6 | 88% | 40 |
| 12 | 62% | 40 |
| 18 | 45% | 40 |

Pooled, that is **71%**, not 78%, and the two sweeps agree to a point (71% and
70%). So the old figure was an average over a stage mix rather than a property
of a board, and it flattered depth badly: at stage 18 more than half of boards
are not cleared at any budget.

The conclusion the old number supported still stands and gets stronger. No
economy can move a ceiling set by whether a line gets found at all — and the
ceiling at depth is lower than anyone recorded.

Those four numbers are now in the code rather than only in this table.
`src/game/odds.ts` was split on 2026-09-12 into `ceilingFor(stage)` — the table
above, interpolated, with an explicitly unmeasured geometric tail past stage 18
— times `spendAt(multiple)`, the spend curve normalised to each stage's own
plateau. `winChance` requires the stage, so the shallow answer can no longer be
read for a deep board by omission. Board selection deliberately compares only
the spend term, because the ceiling is not something an allowance can move and
selecting against it would mean rejecting boards for being deep.

The split was checked for neutrality rather than assumed: `odds.ts band 25` on
two seeds, this table's own script, and `humanrun.ts 20` were all run before and
after, and the realised board population, the unaffordable count (0 of 20 in
every cell) and the depth distribution were unchanged.

**One instrument disagreement is open, and it bears on the four numbers above.**
`curve` puts stage 6 at 78% cleared at 1.4x plainPar and 85% at 2.0x.
`validate`, which plays boards at a real bank instead of re-budgeting them,
reports about 54% at a comparable ratio and 64% at a higher one. Both samples
are small (40 and 25) and the seeds differ, so this may be nothing — but if
`validate` is right, the stage-6 ceiling is nearer 0.70 than 0.88. The two can
now be pointed at the same boards, because both modes take a seed base as of
this week; nobody has done it.

So the economy is finished as a lever. The remaining one is that fifth — and it
turns out not to be a search failure at all. See the next section.

Nor do escapes move it, which was the obvious next hope: measured in
`docs/DESIGN.md` §6b, they convert 6-11% of lost boards and essentially nothing
on a board with no line. Every lever proposed against this ceiling — allowance,
rules, skill, escapes — has now been measured and none of them moves it.

The solver banks perfectly. A human does not. Every number produced by solver play is
a claim about a perfect player, and the entire question here is about imperfect ones —
so the bounded-lookahead bot (task #11) is now a prerequisite, not a nice-to-have.

Target shape, to check against: a bare deck dies around stage 8-10, a good build reaches
15-20, and nothing reliably reaches 30.

## The unfindable fifth: mostly unwinnable, but less so than recorded

This was carried for a long time as "boards the bot cannot find a line on",
with a standing warning not to treat 22% as a human number because it was the
instrument's number. It was measured properly, and the warning turns out to
have been aimed at the wrong risk.

All of the below: current generator, `CAREFUL` bot, unlimited bank, 24 boards a
stage. Reproduce with `scripts/deadboards.ts`.

**Search width does not explain it.** Ruled out earlier — a wider search
recovered nothing.

**Search depth does not explain it either.**

| stage | depth 3 | depth 4 |
|---|---|---|
| 1 | 24/24 | 24/24 |
| 6 | 19/24 | 20/24 |
| 12 | 18/24 | 18/24 |
| 18 | 13/24 | 13/24 |

Identical at the stages where the failures actually live. An earlier n=20 run at
stage 8 alone had hinted depth 4 was better; it was noise, and was flagged
inconclusive at the time rather than banked.

**Most of them are dead — but the share has moved, and the story needs both
measurements to make sense.**

There were two probes. The first, `winnable()` in `deadboards.ts`, passed a
*millisecond* budget to `findSolution` under a parameter named `nodes`, in a
file whose own header warns about that trap. Its numbers were never
reproducible — how hard it searched depended on how busy the container was — and
they are withdrawn rather than restated. The second drove `solve` directly at
1,000,000 nodes, which is the honest version, and that one stands.

`winnable()` is node-bounded now, so both probes finally agree on method. What
they do not share is the game they measured.

**Before this week's difficulty work** (`solve`, 1M nodes, 24 boards a stage):

| stage | bot lost | solvable at 1M | control: bot won | solvable |
|---|---|---|---|---|
| 12 | 7 | 1 | 17 | 17 |
| 18 | 11 | 2 | 13 | 12 |

**After it** (2026-09-11, same method, control clean at 24/24):

| stage | bot lost | solvable at 1M | control: bot won | solvable |
|---|---|---|---|---|
| 12 | 9 | 5 | 15 | 15 |
| 18 | 15 | 5 | 9 | 9 |

3 of 18 became 10 of 24 — **17% to 42%**. The denominators are the clue: the bot
now loses 24 of 48 boards where it lost 18, and both sweeps deal with `bank:
9999`, so the allowance is not what changed. The modifier floor and the three
wired variations made boards structurally harder for a width-limited player
**without making them lineless**. The extra losses are boards a searcher still
solves.

That is a real effect of this week's work and it was not the intent, so it is
worth stating plainly: the difficulty pass moved the game toward *harder to
play* rather than *deader to deal*. Whether that is better is a design question.

The node cap must be quoted with any of these figures. At 200,000 nodes the
control was 22/24 — it missed boards the **bot** had cleared — and a control
that does that cannot certify anything, since the bot is far weaker than the
solver. It closes at 1,000,000.

**What none of this shows is that those boards are humanly winnable.** A
1,000,000-node weighted A* is not a person, and the depth and width sweeps above
— which are about the player model — still move nothing. What it means is that
the gap between "no line exists" and "no line a player will find" is wider than
this document recorded, so the ceiling is less purely a fact about honest
shuffles than the old heading claimed. Genuinely lineless boards are 14 of 48 at
these depths.

Two honest caveats carried over from the earlier sweep, both still true. The
deep configuration is not uniformly stronger — it once missed a board at stage
18 that the bot itself cleared, so "solvable at 1M" is not strictly a superset
of "clearable". And `dealLevel` sizes its allowance with wall-clock solver
budgets, so the boards dealt shift a little between runs: the same sweep gave 6
then 7 losses at stage 12. Read these to the nearest board.

If depth is ever judged too short, the lever is legibility and escapes rather
than the allowance, which is measured to be self-neutralising.

### Which makes legibility the thing that has to hold

A dead board cannot be saved by a better move, only by an escape or a card the
player did not own. So the guarantee that matters is whether the game can still
name that card. Over every board the bot lost across stages 6, 12 and 18, at
the setting that actually ships (`budgetMs: 900`, 3 spots):

**`rescue.ts` named a winning card on 24 of 25 lost boards** — 16 of the 17
genuinely dead ones — median 142 ms, worst case 932 ms. The legibility
guarantee survives honest shuffles.

(Measured after the 43-board audit reordered `CANDIDATES` and added Kickback and
Featherweight to it. Before that change the same sweep gave 22 of 23 at a median
of 162 ms — the same coverage rate on a board set that had shifted by two, so
the reorder is justified by the audit's ranking rather than by that delta.)

Raising the search to 2500 ms and 4 spots was measured and **rejected**: it
recovered nothing (21/22 either way on that sweep) while tripling the worst-case
wait to 2.5 s. The single miss is recoverable — 6 s at 6 spots finds it — but
not at a price every other loss should pay. The constant stays at 900 ms.

Latency is not the risk regardless: the run-over screen renders first and the
verdict arrives into it, and the search returns on first success, so the extra
time would have been spent only on the boards where it does not help.

## The difficulty curve, finally measured as one

The owner's definition: "the game should be loseable by default and the player's
skill and choices make it winnable. **The ratio of winnable to loseable is the
difficulty curve.**" Since nothing else moves the per-level ceiling — not the
allowance, not the rules, not skill, not escapes — that ratio IS the curve, and
it had never been measured. `scripts/curve.ts`, 24 boards a stage, bare starting
deck and no build, which is the no-build lower bound rather than a real run:

| stage | 1 | 3 | 5 | 7 | 9 | 11 | 13 | 15 | 17 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|
| winnable at all | 100% | 100% | 96% | 100% | 92% | 79% | 79% | 71%* | 63%* | 79%* |
| player clears | 75% | 58% | 54% | 50% | 29% | 21% | 21% | 17%* | 21%* | 4%* |
| gap | 25% | 42% | 46% | 50% | 63% | 58% | 58% | 54%* | 42%* | 75%* |

Stages 1 to 13 re-measured 2026-09-09 after the difficulty pass. **Starred
columns are the original 2026-09-06 figures and have NOT been re-measured
since**, so they are the old, easier game and are kept only because deleting a
row loses the shape. The mean over the re-measured stages fell from 58% to 44%;
the full arc is in DESIGN.md §6g.

**The curve is real and it falls.** A bare deck clears five boards in six at the
start and one in twenty-five by stage 19, which matches the target shape in this
document (a bare deck dying around stage 8-10 once you account for a run needing
to survive every stage, not just one).

**The gap stays wide, and that is the result that matters.** The room between
"a line exists" and "this player found it" runs 17% at stage 1 and 42-75%
through the deep game. Skill keeps mattering all the way down. The failure mode
worth fearing was the opposite — a game where deep boards are lost to the
shuffle rather than to play is not getting harder, it is getting arbitrary — and
that is not what happens.

Winnability holds near 100% to stage 13 and then drops to 63-79%. Two controls
before believing it: driving the solver at five times the node cap changed
almost nothing (63/63, 58 to 63, 88/88), and the emergency fallback path fired
on 0 of 24 boards at every stage, so neither solver blindness nor a quiet
easy-board escape hatch explains it.

### A mispriced constant found on the way

`plainPar` per card is not flat with depth: 1.43 at stage 1, 1.80 by stage 15.
The stipend prices threat at a flat rate, and measured as
`(plainPar - deckSize x 1.36) / threat` that rate is anything but flat:

| stage | 5 | 9 | 13 | 15 | 17 | 19 |
|---|---|---|---|---|---|---|
| implied moves per threat | 0.17 | 0.10 | 0.38 | 0.58 | 0.69 | 0.76 |

The same modifier costs several times more at stage 19 than at stage 9, because
deep boards carry two or three rules at once and they interact — which also
explains why the old isolate sweep measured most modifiers at about 0pp: it
measured them one at a time, shallow. A flat 0.48 therefore underpaid deep
boards on top of the squeeze `ratioFor` applies deliberately, which is the
allowance being throttled by a wrong constant rather than by design.

`movesPerThreat(stage)` now follows the measurement from stage 13 down.

**The shallow half of that measurement was deliberately NOT acted on**, and the
reason is worth keeping. It implies 0.10-0.17 early, but the extra cost over
base is only about 2 moves against 13-17 points of threat — a ratio of two small
numbers, which is noise wearing a decimal point. Pricing on it was tried: it cut
about three moves from a stage-5 board, cost 20 points of clear rate, and put a
dip at stage 5 that stages 7, 9 and 11 climbed back out of. A curve has to fall
smoothly, so only the deep end moves.

## Does a build move the curve? No, and the wrong build makes it worse

The curve above was measured on a bare deck, which is the no-build lower bound.
The standing target shape says a bare deck should die around stage 8-10 and a
good build should reach 15-20. Neither half survives measurement.

`humanrun.ts` already has a build knob, and it reports an identical depth
distribution for every setting — median 2, mean 2.3, whether the player takes an
enchantment never, every four levels, or every two. That looks like "builds do
nothing" and it is not: **the median run ends at depth 3, so a build arriving
every two levels barely fires and one arriving every four never does.** The
instrument cannot answer the question, which is worth stating because the
identical rows look like a result.

So `scripts/build.ts` hands the build over at stage 1, separating build strength
from build accumulation. 30 runs an arm:

| kit | cards | median | mean depth | reached 5 |
|---|---|---|---|---|
| bare | 0 | 3 | 3.3 | 5/30 |
| insurance | 4 | 2 | 1.8 | 0/30 |
| insurance | 8 | 1 | **1.4** | 1/30 |
| income | 4 | 3 | 3.2 | 5/30 |
| income | 8 | 3 | 3.1 | 5/30 |
| mixed | 4 | 2 | 3.0 | 6/30 |
| mixed | 8 | 2 | 2.8 | 5/30 |

**Insurance cards actively shorten runs.** Eight of them cut mean depth from 3.3
to 1.4, and that is the largest effect in the table. It is not a
surprise by now: the same cards measure at -1.7 (Anchor) and -2.6 (Ember)
expected moves banked, and they are placement effects that add legal moves a
bounded player then drowns in.

**Income cards are neutral.** 3.2 and 3.1 against a bare 3.3 — indistinguishable
at this sample. They do not hurt, and they do not help either.

**No build beats owning nothing.** The bare deck reaches as far as the best kit,
and five of its thirty runs pass stage 5.

So the honest answer to "does a build move the curve" is no. The best available
build is neutral and the worst halves your run. That is not a pricing problem —
#31 already repriced the cards that measure at nothing — it is structural:
**depth is set by per-level survival, and no card measurably improves per-level
survival.** Insurance converts some lost boards into wins (24-53% of them) while
costing moves on every board that was going fine, and those two effects cancel
or worse.

### What this does not say

The player here is the bounded bot, which is a lower bound on skill, and the
build model is crude: no charms, no gold, no shop choices, just enchanted cards
handed over. A person picks cards for the board in front of them and plays the
extra options better than a width-6 search does. This measures that the CARDS do
not carry a run on their own, not that a skilled player cannot build.

It does mean the shop cannot currently be shown to earn its place, and that is a
design question rather than a number to tune. Left open deliberately rather than
answered with a lever.

## A correction: two harnesses grew decks the game could not deal

Both whole-run harnesses — `humanrun.ts`, and the `build.ts` written for the
question above — grew the deck with `rng.range(1, 13)`. Uniform ranks are not
what the game generates, and growing decks that way is one of the four harness
artifacts CLAUDE.md warns about; it had never actually been removed from
`humanrun.ts`, which is where every median-depth figure in this document came
from. Neither harness capped at `MAX_DECK` either, so both were measuring decks
a player is not allowed to own.

The real generator extends the rank ladder 65% of the time, because high ranks
are the scarce resource — only they can base a column. Corrected, **a bare run's
mean depth goes from 2.4 to 3.3**: the artifact shortened every run by about a
quarter, in one direction, so the figures this document carried were pessimistic
rather than merely noisy. Every depth number above has been re-run.

What did NOT change is the conclusion of either measurement. Builds still do not
move depth, insurance still roughly halves it, and runs still do not end on the
economy. The artifact moved the level, not the shape — which is the good case,
and not one to count on next time.

### The reward that does move depth is the one the game gives away

Measured while chasing the above, and worth its own line: **capping deck growth
raises mean depth from 3.3 to 4.6**, takes runs reaching stage 5 from 5 in 30 to
13, and runs reaching stage 10 from 1 to 4. Compare the strongest allowance ever
tested — twenty free moves every level, far beyond anything purchasable — which
manages 3.8.

So the card handed over after every cleared level costs more depth than any
reward in the shop can buy back. That is not automatically a bug: a bigger deck
is a bigger board, and DESIGN.md sells growth as "more cards carrying more
power". But the power is not measurable and the cost is, and the shop already
sells card removal, which suggests thinning is the correct play and the game
does not say so anywhere.

Left as evidence for the open shop question rather than acted on.

