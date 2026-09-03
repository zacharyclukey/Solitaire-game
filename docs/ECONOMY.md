# The move economy

Status: **design plan, not yet built.** Numbers here are proposals to be measured,
not findings. Anything confirmed moves to DESIGN.md with its measurement.

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
| 18+ | 0.75 | floor |

`(1 - ratio) * plainPar` is exactly the gap the build has to cover. That is the
tunable answer to "eventually only solvable because of their build" — it is a number,
not a vibe, and it can be pointed at.

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

## Measuring it honestly

The solver banks perfectly. A human does not. Every number produced by solver play is
a claim about a perfect player, and the entire question here is about imperfect ones —
so the bounded-lookahead bot (task #11) is now a prerequisite, not a nice-to-have.

Target shape, to check against: a bare deck dies around stage 8-10, a good build reaches
15-20, and nothing reliably reaches 30.
