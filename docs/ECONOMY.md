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
| 2 | 1.30 | +10.4 | +13.1 | +13.0 |
| 6 | 1.15 | +5.0 | +7.3 | +8.5 |
| 10 | 0.90 | **-3.1** | -1.1 | **0.0** |
| 14 | 0.82 | -5.7 | -4.0 | -2.7 |
| 18 | 0.80 | -6.5 | -4.8 | -3.6 |
| 22 | 0.70 | -9.5 | -8.0 | -6.6 |

Stage 10 is the row the design exists for: a bare deck has started bleeding
while an eight-enchantment deck is holding even. That is "solvable because of
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

## The fairness invariant

Today: every board is certified clearable inside its own budget.
With a bank: every board must be certified clearable inside `bank + stipend`.

At deal time, if `realPar > bank + stipend` the board is lost before the first move.
That must never be dealt. So:

1. Regenerate at reduced difficulty until it fits.
2. If the generator cannot produce a fitting board even at its floor, the run ends
   **at the queue screen**, before the player commits — as bankruptcy, not as a
   board they failed.

And the drain has to be visible in advance: the queue screen should show each upcoming
board's stipend so a player can see the wall coming and plan for it. Dying to
arithmetic you could not see is the failure mode that would make this feel unfair
even when it is correct.

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
in hand. Boards are certified clearable *by a weighted A\* search*, and past a
certain depth that has quietly stopped meaning clearable by a person. The
guarantee the whole design rests on is weaker than it reads.

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

What remains is columns. Six-column boards clear at 76% against 91% for seven,
so Narrow is still the sharpest edge in the game even repriced and unstacked.
Whether that is acceptable difficulty or the next thing to fix wants a decision
rather than another sweep. Column count barely
matters (75% at six columns, 76% at seven), and neither does how far the deal
had to be relaxed.

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
what kills runs. But median depth is still 2, and the reason is a fat right
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

## Measuring it honestly

The solver banks perfectly. A human does not. Every number produced by solver play is
a claim about a perfect player, and the entire question here is about imperfect ones —
so the bounded-lookahead bot (task #11) is now a prerequisite, not a nice-to-have.

Target shape, to check against: a bare deck dies around stage 8-10, a good build reaches
15-20, and nothing reliably reaches 30.
