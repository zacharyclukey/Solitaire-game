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

## 2. The solver measures the board; it does not gate it

**This section described the certification contract until the 2026-09-06 review,
and its opening had gone false in four separate ways while the rest of the
section already said so. What follows is what the code does.**

A hand-tuned move budget would be wrong on most deals, because deals vary
enormously. What actually happens:

1. Deal a candidate board.
2. Run a weighted A\* search over the **same rules engine the player uses** — as
   a *measurement*. A board that the search cannot solve is still dealt.
3. Estimate the board's win chance from that measurement (`src/game/odds.ts`)
   and select against a band for the stage. The only floor is that a board with
   essentially no chance is not dealt.
4. Pay a stipend into a bank the player carries between levels — priced from the
   DECK and the stage, not from this board's own line.

What that buys, and what it costs:

- **No board is guaranteed clearable**, and about a fifth of them have no line
  at all. That is the design, not a gap in it: the ratio of winnable to losable
  is the difficulty curve.
- **Difficulty scales with the deck and the depth** rather than with a
  designer's guess — but deliberately NOT with the board in hand, so an unlucky
  shuffle stays unlucky.
- **The ceiling is well-defined.** The stipend ratio falls through 1.0 and keeps
  falling, so the deepest levels demand that you match a searcher move for move
  and then better it.

Three claims that used to sit here and are now simply wrong, recorded so they
are not reintroduced: "if it finds no line, throw the board away and deal
another"; "every board is clearable — not probably"; and the stipend being a
second solve of the same board.

### Moves are a bank, not an allowance

A level does not hand out its own budget any more. The player carries a **bank**
across the whole run; each level pays in a **stipend**, and whatever is not
spent carries forward.

```
level start:  movesLeft = bank + stipend
level clear:  bank = min(movesLeft, stipend)   // one level's allowance, no more
level fail:   run over
```

The cap on that middle line is load-bearing and was added late. Without it the
bank is an unbounded ratchet: a player who clears a level under its allowance
banks `stipend - used` **permanently**, every level, and it compounds. A
playtest reached the low twenties holding **600+ banked moves**, at which point
no board the generator can build costs enough to matter and the difficulty
curve is decorative. Capping the carry at one level's own stipend keeps what
the bank is for — walking into a hard board carrying a spare level for the one
that goes wrong — and takes away the war chest. Surplus past the cap is shown
on the clear screen as lost rather than silently dropped.

The same playtest exposed a second ratchet next to it. Beating standard par
granted `+1 bonusMove`, which rides on top of *every future stipend*: a
permanent allowance raise, earned on most levels by anyone playing well. Skill
was buying its way out of the difficulty curve. Under-par now pays
`stats.finesse`, which scores and does nothing at the table.

The stipend is `deckSize × 1.36 × ratio(stage)`, plus a partial compensation for
the threat the level's modifiers carry (`stipendFor` in `src/game/deal.ts`).
Note what is absent: **the board's own cost**. An earlier model derived the
budget from the player's own par, so a better build shortened par and shrank the
budget with it — the build was absorbed rather than rewarded, and a player who
improved got a tighter game for it. A later one priced off `plainPar`, the same
board with the enchantments stripped off, which fixed that but still let a kind
shuffle pay less and a cruel one pay more. Pricing off the deck instead is what
keeps an unlucky deal unlucky, and 1.36 moves per card is the measured cost of a
plain board.

`ratio` starts at 1.70, steps down through 1.55, 1.40 and 1.25, reaches 1.10 by
stage 14 and decays geometrically after 17 with no floor. Below 1.0 a level no longer funds itself, and `(1 - ratio) × plainPar`
is an exact statement of how much work the build has to do to cover the
difference.

Two consequences worth stating plainly:

- **The loss condition is ordinary.** A run ends because a board was lost. That
  used to be impossible by construction — every board was certified clearable
  inside `bank + stipend` and eased until it was — and that contract is
  **retired**. Deals are honest shuffles now, selected on estimated win chance
  rather than proven winnable, and a large share of boards have no line at all
  — measured, not assumed (`docs/ECONOMY.md`, "the unfindable fifth"). How
  large was overstated until 2026-09-11: 42% of the boards a fallible player
  loses do have a line, so the lineless share is smaller than this bullet used
  to imply, though still the reason the ceiling exists.
  Bankruptcy survives only as a floor: a board with
  essentially no chance is not dealt at all.
- **Undo is unlimited and priced in moves, not rationed by a counter.** It used
  to be three a level, which made exploring a line a thing you could run out of
  rather than a thing you paid for. Each undo now costs a move (two under
  Glasswork, barred outright by Steady Hand), charms buy free ones, and the
  economy is what stops a player rewinding forever. The price is charged
  off-the-books so that restoring the snapshot cannot hand back the very move
  being spent — otherwise undo funds itself and is free however often it is used.
- **The Oracle and undo got more expensive without changing price.** They always
  cost moves; now those moves would otherwise have carried, so a reading on
  stage 3 is felt on stage 12.

The HUD reads one number: moves left. Par, carry and the deficit against a
standard deck were all removed from it — while a board is being played the only
number that changes what the player does is how many moves remain, and the rest
invited them to play the arithmetic instead of the cards. Par returns after the
level, as a score for beating it.

Measured drain per level (20 seeds, fixed 28-card deck, solver play, bank 45),
re-measured after the draw-pile floor moved to 0.38:

```
stage  ratio   bare    4 ench   8 ench
    2   1.70  +25.4    +26.4    +27.2
    6   1.55  +20.5    +21.1    +22.3
   10   1.25   +9.8    +10.5    +11.5
   14   1.10   +3.9     +4.6     +5.6
   18   1.07   +2.8     +3.5     +4.5
   22   0.94   -2.5     -1.9     -0.7
```

Re-measured after the stipend stopped being priced off the deal. Two things to
read carefully.

This is the optimistic bound rather than the balance: the solver spends exactly
par, so it banks everything the ratio pays above 1.0 and does not bleed until
stage 22.

And the enchantment columns are the **classic kit**, which is what
`scripts/economy.ts` draws from at these counts. The build's edge here is 1.8
moves a level, down from about 3 before, and the drop is the design working
rather than a regression: the stipend used to be priced off the deal, so an
enchanted deck was handed harder boards and a bigger allowance with them. Priced
off stage and deck size, that channel is gone and the build's whole edge is the
shorter line it plays — which is what build-blind was always supposed to mean.
For what a compounding build is worth, see `scripts/compound.ts`; the classic
kit is flat by measurement and these columns are showing that flatness.

Deal time also fell to 320-390ms from 530-620ms, since honest shuffles do not
grind through relaxation passes. Full working, caveats and the ways this
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

**15 charms**, run-wide passives: more moves, free undos, a shallower tableau,
gold multipliers, and a few that switch a rule off (`Locksmith` ignores empty-column
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

### Enchantments do two different jobs, and the rankings are near-inverse

Two questions, deliberately measured apart. `scripts/enchaudit.ts` asks which
cards turn a losing board around — the claim the run-over screen makes.
`scripts/worth.ts` asks what a player should buy: expected moves banked across
40 identical boards, six copies of one card, counting a lost board as zero.

Both columns re-measured 2026-09-09, against the generator as it stands after
this session's difficulty work. The bare deck banks 4.5 and clears 20 of 40.

```
card             banked   vs bare      rescues a lost board
Resonance          13.1    +8.6         0%
Beacon              9.3    +4.8         0%
Kickback            9.1    +4.6         9%
Featherweight       9.1    +4.6         9%
Keystone            5.1    +0.6         4%
Gilded              4.5    +0.0         0%
Twin                4.0    -0.5        12%
Torch               3.7    -0.8         9%
Chameleon           3.4    -1.1         9%
Prism               3.4    -1.1        16%
Conduit             3.0    -1.5         0%
Anchor              2.4    -2.1        18%
Bridge              2.3    -2.2        13%
Ember               2.0    -2.5        21%
```

The previous version of this table was stale on both axes and is worth recording
as a process failure rather than just replacing. Its banked column came from a
20-board run, below the >=20 house rule's comfort and superseded by a 40-board
one whose numbers were written into `content.ts` but never back into this table.
Its rescue column predated the 180-board re-audit that halved every rate, so the
same document said Keystone rescues 12% here and 4% sixty lines further down.
**A correction pass that updates one place a number lives is not a correction.**

The two orders are almost reversed, and that is the design working rather than a
contradiction. **Anchor is the best rescuer in the game and the worst card to
own.** It lets any card sit on it, which triples the number of legal moves — 4.0
to 12.5 on an opening board — and most of those moves are bad ones that spend a
move and bury a card. When a board is otherwise dead that is exactly what saves
it; the rest of the time it is a tax.

So there are two classes. **Income**: Resonance and Beacon — they grant or save
moves, add no legal moves, and rescue nothing once a board has gone wrong.
Re-measured at 40 paired boards: Resonance +8.6 expected moves over a bare deck,
Beacon +4.8. Gilded belongs here too, paying in gold rather than moves.
**Insurance**: Anchor, Ember, Twin, Chameleon, Bridge, Prism, Torch — placement
effects that cost moves in the ordinary case and save the board that would
otherwise end the run. Insurance has a premium, one to two moves a board.

**Kickback and Featherweight sit in both**, at +4.6 moves a board and 9% of
lost boards saved. They make a move cheaper, which is income when the board is
going well and a rescue when the last move is unaffordable. They are the best
cards in the set and nothing else does both jobs.

**Two cards measure as doing neither**, on the larger samples: Keystone (+0.6
moves, rescues 4%) and Conduit (-1.5 moves, rescues 0%) — Conduit now measuring
actively worse than owning nothing rather than merely level with it.

Keystone has since been fixed (§6h-quater). Conduit was re-examined on
2026-09-10 and deliberately left alone, but the note on its definition was
rewritten because the reason it had been kept was **false in the load-bearing
part**: it claimed "the player model sees every face-down card", and the bot
does not — `legalMoves` never offers one. The true version is narrower and still
supports keeping it: the heuristic is `remaining + 0.5 x blockers`, both blind to
card identity, so knowing *which* card is down cannot change a 3-ply bot's play
while a person plans around it.

A second explanation was tested and refuted rather than recorded as fact — that
revealing a buried card makes the heuristic look worse, since `blockers` counts
the overburden of the topmost face-down card and revealing one exposes a deeper
card with more on top. Measured directly, revealing takes a sample column from
3.0 to 2.5: `hidden` falls by one and outweighs the blockers rise. **Revealing is
not penalised**, and the -1.5 is real. Its mechanism is Anchor's — more reveals
means more legal moves, and a width-limited player picks worse from a wider menu,
which costs a fallible human too.

That sharpens the question instead of settling it. **Conduit pays an insurance
premium and rescues nothing** — Anchor's -2.1 buys back 18% of lost boards,
Conduit's -1.5 buys 0% — and "insurance that never pays out" is the strongest
case for cutting it, resting on the rescue audit rather than on the
blind-instrument argument. Against it: early information is precisely what these
instruments cannot value. Three passes have now agreed on the number and none of
them can see the thing in dispute, so a fourth is not what this needs. Conduit had been
described as one of the strongest cards to own, which the paired measurement
does not support. That is a balance question rather than a labelling one and is
left open here; nothing is claimed for either card in the UI.

### The player can now see which is which

Both facts are flags on the enchantment definitions and show as two small chips
— **Pays** and **Saves** — on shop rows, reward cards, cards sold with an
enchantment already on them, and in the codex. A card that measured as doing
neither shows neither chip, rather than being given a label it did not earn.

This was a communication problem, not a balance one. A player reading "any card
at all may be placed on it" had no way to tell that Anchor is insurance bought
at about two moves a board, and the run-over screen naming Anchor or Ember —
correctly, for having rescued that board — pushed them toward the cards that
make them poorer on every board that was going fine. That line now names the
trade rather than just the card. The trade-off itself is untouched: it is the
most interesting choice the shop offers.

Checked against a control, because a card that triples the branching factor is
exactly the shape of an artifact that has caught this project before. Anchor
does not recover at search width 14 — it drops further, 2.6 to 1.9 — while
Resonance is unmoved at 14.8 and 14.9. The cost is the card, not the instrument.

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

Re-measured after deals became honest shuffles, paired on the same board so
only the enchantments vary, and at a realistic purse: the adding kit keeps 14, 8
and 8 moves at 4, 8 and 12 cards, flat and noisy, while the compounding kit
climbs 11, 20, 28. The direction survived every correction to the instrument.

Getting there took three corrections worth recording, because each produced a
confident wrong answer first. Dealing separately per kit let honest-shuffle
variance — plainPar runs 33 to 61 — swamp a build worth a few moves, and the
results came out non-monotonic. Measuring at an unlimited bank let the player
wander instead of economising, so it hit the bot's iteration cap with six
hundred moves still in hand, and the build appeared to LOSE boards a bare deck
won; every one of those losses was the cap, never the budget. And the median is
taken over winners, so a kit that clears fewer boards keeps only the easy ones.

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
counts the ones that turn the loss into a win. 120 boards at stages 4, 8 and 12
(`scripts/enchaudit.ts 40`); 43 of them lost; the fallible player rather than
the solver, because a solver extracts value from a card no person would find.

```
Anchor         27/39   69%
Ember          21/39   54%
Bridge         16/39   41%
Prism          14/39   36%
Twin           12/39   31%
Chameleon      11/39   28%
Torch          10/39   26%
Kickback        5/39   13%
Featherweight   5/39   13%
Keystone        1/39    3%
Beacon          1/39    3%
Gilded          0/39    0%
Conduit         0/39    0%
Resonance       0/39    0%
```

**Re-measured 2026-09-11, and every rate roughly TRIPLED.** The table this
replaces read Ember 21%, Anchor 18%, Prism 16% — itself a halving of a 43-board
table before it, caused by repricing Loose Weave. This time **no enchantment was
touched at all.** What moved is the boards: the modifier floor and the three
wired rule variations changed which modifiers get dealt, and the loss rate fell
with it, from 42% of dealt boards to 33%.

Fewer losses and far more of them rescuable is one finding, not two.
`scripts/deadboards.ts` says the same thing from a completely different angle:
the share of lost boards a searcher can still solve went from 17% to 42%. **This
week's difficulty work made boards harder to PLAY without making them deader to
DEAL**, so what a player loses is much more often a recoverable position than a
dead shuffle — and one enchantment turns a recoverable position far more often
than it turns a dead one.

That is twice now that modifier selection has invalidated this audit, and the
second time it happened without anyone touching an enchantment. **Re-run it
whenever the modifier pool or the threat budget moves**, not only when a card
changes.

`rescue.ts` was searching in an order that no longer matched. Only two positions
were load-bearing at this sample: Anchor to the front, a real 15-point gap over
Ember, and Chameleon up from **last** — it was searched ninth at 28%, behind two
cards measuring 13%, which is the one way that list can actively mislead, since
the search returns the first hit inside its deadline. The middle ordering sits
inside the noise at 39 lost boards. Corrected.

The SET of cards that rescue did not change, which is why the Pays/Saves chips
still mark exactly the right nine: they land at 13-69%, with Keystone and Beacon
at 3% and three cards at a flat 0%. The gap the chip draws is wider than it has
ever been. Its old promise of "at least one in five" is true again at these
rates, but the copy no longer makes a numeric promise and should not go back to
making one — the number has now moved by a factor of three in each direction
without a single card changing.

### The process gap this exposed

Nothing re-ran this audit when the constant it depends on changed. The Loose
Weave reprice and this table were separate commits two days apart, and the
review notes even listed the audit under "do not redo". A balance change and the
measurements that justify other decisions are coupled, and nothing in the
workflow knows that. Worth remembering the next time a threat value moves:
**anything measured on a population of dealt boards is downstream of every
modifier's threat.**

This replaces a 14-board run that sat below the >=20 house rule, and the bigger
sample moved real things rather than just tightening error bars. Twin is clearly
ahead of Chameleon rather than tied with it, so the run-over screen was naming
Chameleon in its top three when Twin belongs there. Torch fell clearly behind
Bridge and Prism rather than sitting beside them, so `rescue.ts` was searching a
weaker card earlier than two better ones. And Kickback and Featherweight beat
three cards `rescue.ts` does search while not being searched at all — they were
filed as pure economy, but a loss for want of moves is still a loss the screen
has to explain. Both the advice line and the `CANDIDATES` order were corrected
to this table.

Forty-three lost boards still carries roughly eight points of noise, so trust
the ordering rather than the gaps between adjacent rows.


Anchor leads because it manufactures the scarce resource: with no foundations,
somewhere to put anything is the whole game.

**Beacon now pays for chains.** Two moves cannot rescue a board that is going
wrong, which is why it saved none of nineteen lost boards on its own. It grants
four instead of two when a Torch, Twin or Conduit turned it, so its reason to
exist is as the payoff at the end of a chain rather than as a card that stands
alone — the same principle that makes Conduit worth building toward.

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

The game ships a solver, which means it can know things no other card game can
tell you: whether you are still winning, what the line is, and exactly which
move threw it away. Spending that on a hint button was a waste of the only
genuinely unusual thing in the design.

(This section used to open "every board is solved before it is dealt". That was
true under the certification contract and is not true now — deals are honest
shuffles, the solver runs as a measurement, and a board with no line at all is
dealt like any other.)

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
  and much less interesting; one currency does everything instead, and since the
  move bank landed that currency carries between levels, so a reading bought
  now is a move missing from a board two levels deeper.
- **The cheapest question is the most interesting one.** "Am I still winning?"
  costs one move and tells you nothing about *what* to do — only whether the run
  is already over. Knowing you are dead and choosing whether to spend undos, or
  an escape, is a better decision than being handed a move.

That reading answers in three ways, and the third is deliberately hedged. It can
say the board is still winnable, or that it is winnable but needs more moves
than you hold, or that no line was found. It used to say "there is no line left
from this position at any cost" — an absolute claim standing on a 420 ms search.
Measured against `solve` at 400,000 nodes over 218 winnable mid-game positions
at stages 4 to 12, that search misses a line that really is there about 1% of
the time. One in a hundred is small, but the player pays a move for the reading
and will abandon a board on it, so the wording now claims only what the search
did: no line was found.

The third question closes the loop with the post-mortem: the same analysis that
explains a loss afterwards can be bought *during* the level, and it offers to
rewind to the last position that was still winnable. A run that would have
ended can be recovered, if you have the undos and thought to ask.

## 5b. Teaching it, and the reason to come back

**The guided board.** The first level a new player sees is hand-authored, not
generated, because the teaching order matters more than the variety. Fifteen
cards, five columns, a four-card draw pile and a 34-move allowance, with five
lessons in the order the game actually needs them: stack a card, turn one off
the draw pile, empty a column, send an ordered run into the gap, and only then
the move allowance.

(This described "three reserve cells" and a reserve lesson until the
2026-09-05 review. The reserve was replaced by the draw pile; the lesson that
teaches it had already been rewritten in `tutorial.ts` and only the prose was
left behind.)

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

One subtlety that had to be fixed to make it honest: hints and undos spend moves
without appearing in the replayed move list. Left uncorrected the analysis would
have started from a budget the player never had and cleared them of a loss that
was genuinely theirs.

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

## 6a. Level rules are price, not puzzle

The long-running hope (task #23) was that deep boards could be made a harder
PUZZLE rather than just a more expensive one, and the lever proposed was
decision density: a rule that costs a narrow search a lot and a wide search
little is demanding thought, while one that costs both equally is just removing
resources. Measured, and the hope does not survive.

Method matters here, because the obvious version of this measurement is wrong.
Dealing each arm separately gave nonsense — Suit Lock came out EASIER than a
plain board — because `dealLevel` selects boards against a win-chance band and
simply hands a high-threat modifier an easier layout. The selector cancels the
thing being measured. So: deal one board, then flip the rule in place on a
clone. Same cards, same layout, and the selector never sees it. The budget is
unlimited throughout, so nothing below is price; what is left is puzzle.

24 identical boards at stage 14, the fallible player at three search widths:

| rule | width 4 | width 14 | width 30 |
|---|---|---|---|
| (none) | 92% | 96% | 96% |
| Suit Lock | 71% | 71% | 71% |
| Loose Weave | 75% | 79% | 79% |
| Gridlock | 88% | 92% | — |
| Low Ceiling | 92% | 96% | — |
| Tithe | 96% | 92% | — |
| Stiff Deck | 96% | 96% | — |

**No rule is a thinking tax.** Not one of them gets easier with a search three
times wider; the two that bite cost the same at width 4 and width 30. Gridlock,
Low Ceiling, Tithe and Stiff Deck cost essentially nothing once the budget is
removed — they are pure price, which is exactly what #23 set out to move away
from. The branching hypothesis is dead, and the honest reading is that this
game's difficulty lives in the shuffle and the allowance rather than in its
rules. Inversion is absent because it also moves `baseRank` and so reshapes the
staircase the board was dealt to; retrofitting it measures the mismatch.

### Loose Weave was priced backwards

The measurement turned up a real bug rather than only a negative result. **Loose
Weave — "colour is ignored, only rank matters" — sat at threat -4, a boon.** It
measures as a 17-point penalty: 96% of these boards clear plain, 79% under it,
at every width tried.

Ignoring colour strictly ADDS legal placements, so a perfect solver finds the
board easier or equal. A bounded player does not. Branching jumps, and most of
the new moves are bad ones that spend a move and bury a card — the same
mechanism already documented for Anchor, the best rescuer in the game and the
worst card to own. Difficulty for a searcher and difficulty for a person run in
opposite directions here, and `threat` was pricing the searcher.

So the player was paying a boon's price — a SMALLER allowance, since threat
feeds the stipend — for a board that is harder to play. Repriced to +5, which
is Suit Lock's 8 scaled by what each costs (25 points against 17), and
`minDepth` moved from 1 to 3 because a bane this size has no business opening
on stage 1. The threat sign also drives the chip colour, the codex tag and
`BOON_IDS`, so the presentation corrected itself.

This is the second time a placement relaxation has measured as a penalty for a
bounded player. It is worth treating as a rule of the design rather than a
coincidence: **loosening a constraint is not a kindness in a game where the
player has to find the line.**

## 6b. What the escapes actually save

Escapes were the last lever anyone had on the per-level ceiling. Rules turned
out to be price rather than puzzle (§6a), the economy stopped being the limiter
(`docs/ECONOMY.md`), skill does not move it (#27), so if a dead board could be
bought out of, that was the remaining answer. Measured with
`scripts/escapes.ts`, it is not.

60 boards at stages 12 and 18 played at the allowance the level really grants:
50 lost, of which **15 had no line at all** and 35 were winnable and lost
anyway. Those two populations answer to different escapes, so they are kept
apart. So are two moments — at the start, and at a standstill, which is when a
player actually reaches for one. Pry and Dig both act on whichever column is
most buried, and that column changes as the board is played.

The first measurement, before any change:

| escape | dead: at start | dead: stuck | winnable-but-lost: stuck |
|---|---|---|---|
| Pry | 4% | **0%** | 3% |
| Dig | 2% | **0%** | 3% |
| Reprieve | 10% | 8% | 14% |

**Spending an escape at the moment of death was worse than spending it early**,
which is the opposite of how they are sold. The reason is timing: a board goes
dead at about the same moment the purse does, so Pry would open a line the
player could no longer afford to walk.

And the effects were doing almost none of the work. Spent at a standstill with
a move grant attached, Pry, Dig and a grant of moves ALONE converge exactly:

| grant | +0 | +4 | +8 | +12 |
|---|---|---|---|---|
| Pry | 0% | 6% | 8% | 12% |
| Dig | 0% | 6% | 8% | 12% |
| moves only | 0% | 4% | 8% | 12% |

At +12 all three sit at 12%. Whatever Pry and Dig are worth, at these sample
sizes it is not distinguishable from the moves.

**One reading of that is instrument, not design, and it is important.** The
player model sees every face-down card, so revealing one is worth exactly
nothing to it — Dig's entire purpose is invisible here, and its 0% is partly an
artifact. Pry's is not: destroying a card is fully visible to the bot, and it
still measures at nothing beyond its moves.

### What changed, and what did not

Pry and Dig now grant 8 and 6 moves alongside their effect. That fixes the
measured failure — an escape that arrives when the purse is empty — and it also
fixes a pricing bug: at 42 and 34 gold against Reprieve's 26 they were strictly
dominated, costing more to do less. After the change, spent at a standstill,
Pry and Dig convert 6% of winnable-but-lost boards against 3% before, with
Reprieve at 11%.

What did NOT change is the conclusion. Escapes convert something like 6-11% of
lost boards, and on a board with no line at all essentially nothing works.
**Escapes are not a lever on the ceiling.** They are what keeps a lost board
from being an insult, alongside the card `rescue.ts` names, and they should be
priced and written as that rather than as a way out of the shuffle.

## 6c. Column count is not a difficulty lever

The claim that six-column boards were the sharpest edge in the game (76%
against 91% for seven) was withdrawn in the 2026-09-05 review, along with the
contradictory line two sentences later saying column count barely mattered.
Neither was controlled: column count is normally set by the Narrow and Wide
modifiers, which carry threat that the stipend compensates, so those arms
differed in allowance and modifier mix as well as in width.

The clean lever is the **Wide Stance** charm. It runs through `columnsFor` and
touches nothing else in the game — no threat, no modifier, no rule — so with the
stage, deck, seed and (empty) modifier list held fixed, toggling it varies
column count and nothing besides. `scripts/columns.ts`, 60 boards a cell:

| stage | columns | unlimited budget | at the level's own budget |
|---|---|---|---|
| 12 | 7 | 100% | 80% |
| 12 | 8 | 100% | 72% |
| 16 | 7 | 100% | 37% |
| 16 | 8 | 100% | 30% |

`plainPar` per card came out at 1.34-1.36 in every cell, so the board selector
did not quietly compensate and the arms really are comparable.

**An extra column is not an easier puzzle.** At unlimited budget every arm
clears everything; width changes nothing about whether a line exists or can be
found. At the level's own allowance the extra column is worth about -7 points at
both stages — consistent in direction across two stages and two sample sizes,
but inside the noise at these counts, so the honest statement is that it buys
nothing measurable rather than that it hurts.

Read the unlimited column with its scope in mind: these are modifier-free boards
dealt from the run's starting deck, chosen so that column count is the only
thing moving. They are much easier than a real deep board, which is why they
clear 100% of the time. This does not contradict the fifth of real boards that
have no line at all — different population, deliberately.

Two things follow. Narrow is not the sharpest edge in the game by way of its
geometry; whatever it does, it does through threat and allowance. And **Wide
Stance is an epic charm at 90 gold that buys nothing the player can measure**,
which puts it in the same bucket as Conduit and Keystone (see #31).

## 6d. Three items that measure as doing nothing

Conduit, Keystone and Wide Stance all sat at or near zero on every axis this
project can measure. Task #31 asked what they are for.

**Conduit** had one defence worth testing: its effect reaches for OTHER
enchanted cards, so its value might be real but conditional on a dense build
that the plain-deck measurement never constructs. If so, its edge must grow with
density. It does not. One test card at a fixed slot, 40 paired boards, stage 8,
expected moves banked against leaving that slot plain:

| enchantment density | Conduit | Torch |
|---|---|---|
| 0 | +0.0 | -0.2 |
| 4 | +0.5 | +0.6 |
| 8 | +0.2 | +0.5 |

Torch — a common at half the price — matches or beats it at every density, and
all of these deltas are inside the noise at 40 boards. The conditional defence
fails.

The chain itself is real and implemented (`flipCard` recurses, so a Conduit into
a Torch into a Twin does fire). The problem is what it reaches for, and the old
comment admitted it without noticing: it takes the enchanted card *nearest the
top of its column* — "the one the player would have reached soonest anyway".
Revealing the card that needed the least help is worth nothing.

**The obvious fix was tried and failed.** Retargeting it at the most buried
enchanted card, which is what Torch, Dig and `mostBuried` all use, measured
WORSE: +0.2 to -0.5 at density 8. That is consistent rather than surprising —
it is the same reason Dig rescues 0% of dead boards. Turning a card that stays
under a pile grants no legal move, so moving the target from a useless card to
another useless card changes nothing. The change was reverted rather than
shipped.

### What was decided, and what was deliberately not

Neither card was cut and neither mechanic was redesigned. Both were repriced to
what can actually be measured:

- **Conduit**: epic at 44 gold → rare at 28.
- **Wide Stance**: epic at 90 gold → rare at 48. It was the most expensive item
  in the shop for an effect measured at nothing (§6c).

The asymmetry between them matters. Conduit has an upside this instrument
cannot see: the player model knows every face-down card, so revealing one early
is worth exactly zero to it, while a person plans with that information — the
same blindness that makes Dig's 0% partly an artifact. Wide Stance has no such
excuse; column count is fully visible to the bot. So Conduit is priced down
pending a person's judgement, and Wide Stance is priced down on the evidence.

**Keystone was left entirely alone.** At +0.3 moves and a 12% rescue rate it is
weak rather than empty, and it is already a common at 24 gold, which is roughly
what weak should cost.

## 6e. The copy sweep, and what it found

Three pieces of retired-contract copy were found by accident in a single day —
the How to play sheet promising every deal could be cleared, the Oracle claiming
no line existed "at any cost" on the strength of a 420 ms search, and a store
listing advertising the same guarantee to Apple and Google. Finding three by
accident meant the rest had not been read since the pivot, so task #32 read all
of it deliberately.

Every single-line string a player can see was extracted from `src/ui/`,
`oracle.ts`, `achievements.ts`, `tutorial.ts`, `app.ts`, `content.ts` and
`run.ts` — 153 of them — and each was checked against what the game now does.

**One violation, in the Oracle's own help text**: "Every board was solved before
it was dealt to you." That is the certification contract, in the same help sheet
whose other half had already been fixed two reviews earlier — a good argument
for sweeping rather than patching what you trip over. Rewritten to say the game
ships the searcher it measures with, and that a "no" from it means a line was
not found rather than that none exists.

Two things were checked and are correct, recorded so they are not re-litigated:

- "There is still a line here — you have the moves for it" (`app.ts`) fires only
  when the search actually returned a line whose cost fits the allowance, and
  returns nothing rather than asserting deadness when it fails. It does not
  overclaim.
- "Better Than the Machine — clear a level in fewer moves than the solver
  needed" is exactly what par is, and still true.

### No dead content

While the strings were open, a structural check: every charm id is referenced by
game logic outside `content.ts`, and every one of the fourteen enchantment and
four curse flags is read by `sim.ts`. Nothing is defined-but-inert. This is
worth repeating occasionally — the "+1 reserve cell" shop item spent months
describing a mechanic that had been replaced, and a defined-but-unread effect
would fail the same way while being harder to notice.

## 6f. What the post-mortem can and cannot know

"Where did I go wrong?" makes the strongest claim of the three readings — that a
particular move lost the board — and it does it with a binary search whose
probes are bounded. Winnability is monotone along a line of play, so the binary
search is valid in principle. The problem is what a probe can report.

**A probe that succeeds is trustworthy: it found a line.** A probe that fails
cannot tell a dead position from one whose line it merely missed inside its
time slice, and every such miss pushes the boundary EARLIER than the truth.

Measured: 29 lost boards with a real play history, `analyse` at the shipping
budget against `analyse` at sixteen times that. On the 13 where both reported a
boundary they **disagreed on 4**, and every disagreement went the same way —
the longer search found the line had stayed open longer, twice by more than ten
moves. So roughly a third of the time the fast answer blamed a move that was
still fine.

The fix follows the asymmetry rather than the budget. `verdictFor` was already
careful, saying "no line could be found past move k+1" rather than asserting the
move killed the board. The Oracle's reading was not: it said "It closed on the
next one." That half is now dropped, keeping the half a successful probe backs —
the line was still open after move k — and noting only that no line was found
past it.

Nothing else needed to change. The rewind the reading offers goes to move k,
which a successful probe verified as winnable, so it was never wrong; and a
boundary that errs early sends the player further back than necessary, which is
the safe direction to err in.

The same section of `postmortem.ts` also carried the retired contract in its
reasoning — "the deal was certified winnable before it was handed over, so index
0 is taken as winnable". The search does verify index 0 before reporting
anything that rests on it, so this was a stale comment rather than a live bug,
but on honest shuffles the opening position may genuinely have no line and the
comment now says so.

### A dead field, renamed

`Level.relaxed` — "how far the deal had to be eased before the solver could
clear it" — outlived the easing. It only ever held 0, or a magic 5 set on the
emergency path where board selection finds nothing and a plain shallow board is
dealt instead. It is now `fallback: boolean`, which is what it actually meant.
The QA log prints something worth reading as a result: `"fallback":false` on
every level, where it used to print `"relaxed":0`.

## 6f-bis. Four rules the sim had and the game never used

`RuleSet` carries `drawCount`, `empty`, `groups` and `passes`. `applyMove`,
`canPlaceEmpty` and `runStart` have always honoured all four. Not one of them
had ever been wired to a modifier, so every board ever dealt played standard
Klondike on those axes, and `canPlaceEmpty` contained a branch for a rule
("Royal Gates") that nothing could switch on.

Two items were collateral damage. **Locksmith** — a 60-gold rare reading
"Empty-column restrictions never apply to you" — set `empty` to `'any'`, which
is what it already was: a rare that did nothing whatsoever. **Keystone**'s note
already recorded the symptom without finding the cause: "under standard rules
there are none to bypass — measured, it saved 0 of 19 lost boards."

Everything was priced with `scripts/rulecost.ts`, which flips the rule in place
on a clone of the same board — dealing the arms separately lets the win-chance
selector cancel the effect — at three search widths, stage 14, 24 boards,
against a 92% control.

**Shipped:**

| modifier | w4 | w14 | w30 | cost |
|---|---|---|---|---|
| Three at a Time (`drawCount: 3`) | 75% | 79% | 79% | -13 to -17pp |
| Royal Gates (`empty: 'top'`, width 4) | 79% | 83% | 83% | -9 to -13pp |
| One Pass (`passes: 0`) | 83% | 83% | 83% | -9pp |

**Cut on the measurement:**

| candidate | w4 | w14 | w30 | cost |
|---|---|---|---|---|
| Sealed Vaults (`empty: 'none'`) | 0% | 0% | 0% | -92pp |
| Rust (`groups: false`) | 4% | 8% | 8% | -84pp |
| One Pass as written (`passes: 1`) | 92% | 92% | 92% | 0pp |

Empty columns are the only true sink in this game, and carrying a run as a group
is how the sink gets used. Removing either does not make boards harder, it makes
them impossible — so both were cut, and `tests/economy.test.ts` now guards every
rule modifier against coming back as a board-killer. That guard was checked
against the thing it guards: control 7/8, Rust 1/8, Sealed Vaults 0/8.

One Pass is the opposite failure and the more instructive one. Written as
`passes: 1` it reads like a real restriction, sounds punishing in the chip, and
costs **exactly nothing** — the player model never needed the second recycle.
It ships at `passes: 0` on the strength of the re-measurement, not the name.

Royal Gates needed a dial rather than a yes/no. `canPlaceEmpty` admitted ranks
within 2 of the base; measured across the range that is -42pp, two and a half
times the heaviest modifier in the game. Within 6 is 0pp. Within 4 is -9 to
-13pp, so `gateWidth` ships at 4.

### The stacking hazard, which the isolate sweep cannot see

Royal Gates alone is a -12pp rule. On a board already paying for its draws it is
not. Measured at stage 10, 16 boards, unlimited budget, so only structure is
under test:

| board | cleared |
|---|---|
| no modifiers | 16/16 |
| rush + heavydraw + dense | 11/16 |
| **the same, plus Royal Gates** | **5/16** |
| Royal Gates alone | 14/16 |

Restricting the empty-column sink and doubling the price of hunting for
something to put in one are the same tax charged twice, so Royal Gates excludes
Heavy Draw. This is worth remembering as a general warning: a paired isolate
sweep prices a rule against a *plain* board and is blind to superlinear
stacking. `maxRulesFor` and `maxBoard` exist for the same reason, and the caps
were not enough on their own here — it took an explicit exclusion.

**Not re-measured, and therefore not claimed:** Keystone and Locksmith now have
something to bypass, but their rescue and worth numbers were taken when there
was nothing in the game for them to do. Neither has been re-audited, so neither
has earned a `saves` or `pays` chip on this change alone.

## 6g. The difficulty tightening, measured

Playtest feedback was that the game was too easy and paid too much gold. Three
things changed together, and the curve was measured before and after with
`scripts/curve.ts 24 1,3,5,7,9,11,13` — 24 boards a stage, bare starting deck,
no build, so this is the floor a player without a build faces.

| stage | cleared, before | cleared, after | winnable (after) |
|-------|-----------------|----------------|------------------|
| 1     | 83%             | 83%            | 100%             |
| 3     | 75%             | 67%            | 96%              |
| 5     | 58%             | 38%            | 96%              |
| 7     | 50%             | 46%            | 100%             |
| 9     | 58%             | 54%            | 92%              |
| 11    | 46%             | 17%            | 88%              |
| 13    | 38%             | 21%            | 96%              |

Across all 168 boards the clear rate went from **58% to 47%**. Read the
aggregate, not the rows: at 24 boards a cell carries about +/-14 points, so the
stage-5 dip below stage 7 and 9 is inside the noise and is **not** something to
tune against — chasing exactly that dip once before cost 20 points of stage-5
clear rate and dug a deeper one.

What changed:

- **`ratioFor` down 0.15 at every step** (1.55/1.40/1.25/1.10/0.95, tail
  `0.95 x 0.97^(stage-17)`).
- **Gold cut.** `baseGold` from `12 + stage x 3` to `8 + stage x 2`, and the
  under-par bonus from 3 gold a move to 1. The under-par line is the one gold
  source that scales with *skill* — the reference bot never beats par, so every
  harness in this project was blind to it while a competent player farmed it
  every level.
- **Both allowance ratchets capped** (see "Moves are a bank, not an allowance").

One caveat worth keeping visible: `winnable` barely moved, so this pass made
boards *less affordable* rather than *harder*, which is the thing the standing
brief warns against. It was the right lever for the reported problem — the
allowance was the runaway — but the next difficulty pass should come from the
board side, not this one.

## 6g-bis. The modifier floor, and where a floor does its damage

Boards rolled modifiers until the threat budget was met and then stopped, so a
level's whole character came down to the two or three heavy modifiers the budget
bought. Most levels looked like most other levels, and a gauntlet was a gauntlet
in the numbers rather than on the screen. `pickModifiers` now takes a `minCount`
and tops a board up with the cheapest thing still legal once threat is met —
texture at roughly fixed price, since what the fill adds is mostly compensated
back in `stipendFor`.

Measured on the same 24-boards-a-stage sweep, and the result is the useful part:

| stage | before the floor | flat floor (2 / 3 on gauntlets) | floor held back to stage 4 |
|-------|------------------|----------------------------------|-----------------------------|
| 1     | 83%              | 75%                              | 75%                         |
| 3     | 63%              | **42%**                          | 58%                         |
| 5     | 50%              | 50%                              | 54%                         |
| 7     | 50%              | 50%                              | -                           |
| 9     | 29%              | 29%                              | -                           |
| 11    | 21%              | 21%                              | -                           |
| 13    | 21%              | 21%                              | -                           |

**Stages 5 through 13 are identical with and without it.** Deep boards already
carry enough threat to reach the floor on their own, so every point the flat
floor cost was spent in the first three levels — twenty-one of them at stage 3
alone. A floor is worth having for how a board reads, but a flat one buys a wall
in the opening and no texture anywhere the run actually needs it, so it is held
back until stage 4. The opening is where a loss feels least like a near miss.

(Stage 1's 83% to 75% is two boards in twenty-four and survives the change, so
it is the documented run-to-run drift from wall-clock solver budgets, not the
floor.)

### Where the session landed

Bare starting deck, no build, no bank — the floor a player without a build
faces, and the worst case rather than the typical one:

| | stage 1 | 3 | 5 | 7 | 9 | 11 | 13 | mean |
|---|---|---|---|---|---|---|---|---|
| before any of this | 83% | 75% | 58% | 50% | 58% | 46% | 38% | 58% |
| after the tightening | 83% | 67% | 38% | 46% | 54% | 17% | 21% | 47% |
| after the variations | 83% | 63% | 50% | 50% | 29% | 21% | 21% | 45% |
| after the floor | 75% | 58% | 54% | 50% | 29% | 21% | 21% | 44% |

The variations barely moved the clear rate but pulled `winnable` down at depth
(stage 11 from 88% to 79%, stage 13 from 96% to 79%), which is the shape the
standing brief asks for: boards outgrowing the player rather than the purse
being throttled. Read the means, not the cells — at 24 boards a cell carries
about +/-14 points.

## 6h. Tribute levels: making growth mandatory

Capping deck growth raised the reference player's mean run depth from **3.3 to
4.6** — the largest effect measured anywhere in this project. The player can
read that off the game as easily as the harness can, which made "remove a card"
the correct answer on every reward screen that offered it. A choice with a known
right answer is not a choice.

Every third cleared level is now a **tribute**: the only options are one card in
each of the four suits, same rank, same enchantment. The deck has to grow; the
decision is which suit carries it, which is a real question about what the
tableau can absorb and where you want that effect to sit. The card always
arrives enchanted, so a tribute is a trade rather than a tax.

Decks already at `MAX_DECK` are exempt and get the ordinary reward roll. That
cap is a measured cliff, not a soft ceiling — a bounded-lookahead player clears
8 of 12 boards at 31 cards and 2 of 12 at 34 — and the tribute exists to stop
thinning being free, not to push a deck past the size the game works at.

## 6h-bis. The deck grew into cards it already held

Reported from a playtest: a tribute offered a 7 to a deck that already had 7s.

`newCard` picked a rank — `hi + 1` at 65%, otherwise anywhere from 1 to `hi` —
and then rolled a suit freely. The fill-in branch could therefore only ever land
on a rank the deck already held, and with the suit unconstrained it produced
**exact duplicates**: a second 7 of spades in the same deck. The starting deck
is ranks 1-7 in all four suits, so at the beginning of a run every fill-in was
one. Measured over 300 runs: **34% of every add option offered**, and a tribute
screen averaging **1.4 duplicates among its four**, sometimes all four.

Growth is now keyed on the `(rank, suit)` pairs the deck holds. It stays
ladder-first — higher ranks are the scarce resource, being the only legal column
bases — but the fill-in branch thickens a rank with room instead of restating
one without. Taking the 8 of spades opens three more places at rank 8; removing
a card reopens the place it left.

### The fix had a second half

Forbidding duplicates alone made things worse in a way the first fix hid.
Extending on nearly every add produced decks shaped:

```
A-7 x4,  8 x1,  9 x1,  10 x1,  J x1
```

A thin spike of singleton high ranks — exactly what `MAX_DECK` exists to
prevent ("a deck spread thinly over more ranks stops offering the alternating
card one rank down that a descending run needs"). Duplicates had been quietly
padding the bottom of the ladder, and removing them exposed that the growth
policy had no reason to ever build width.

So the ladder needs a footing: the top rung must hold at least two suits before
the next one opens. The same four cards of growth now buy

```
A-7 x4,  8 x3,  9 x1
```

— two usable ranks instead of four unusable ones. Tributes run through the same
`growthRank` as ordinary adds rather than always opening a fresh rung, which
they did at first and which cancelled the footing rule on the three levels a
tribute fires. A tribute therefore offers between two and four suits rather than
always four; two is still a choice, and it beats offering a card you own.

## 6h-ter. The saved board was not the board

A resumed level does not store its board. It stores the `LevelSpec` and the
moves played, re-deals from the spec, and replays the moves into the result.
That is only sound while the same spec deals the same board.

It does not. `dealLevel` chooses its layout by estimated win chance against the
**allowance** — `winChance(stipendBase, thisPlainPar, ...)` — so the allowance is
part of the board's identity. Dealing one spec at two allowances gives two
different boards, and **every balance pass moves the allowance**. This session
alone moved it three times: `ratioFor`, the bank cap, and under-par no longer
granting `bonusMoves`.

Measured: holding the spec and seed fixed and changing only the allowance by
the size of this session's tightening, the layout differs on **68 of 240
boards (28%)**.

`applyMove` checks nothing. So a player who quit mid-level under an older build
and came back under a newer one had their old moves applied to a new layout —
moving cards that were not in those columns, splicing at indices past the end.
Silent, and it looks like a corrupted board rather than an upgrade.

The run now carries `levelKey`, a fingerprint of the board the moves were played
on, and a resume replays only when it matches. The check runs on a clone first,
because `BoardView` holds `level.sim` by reference from `mount` and cannot be
handed a replacement afterwards. A save written before the field has `levelKey`
null — which is the right answer for those saves too, since they cannot be
trusted either — and the board is simply dealt fresh with a line of copy saying
so.

This is the same shape as the `completeRun` fix and deserves the same note: the
bug is not that a particular field was missed, it is that **a save is only as
valid as the assumption that the generator is a pure function of what was
saved**. It is not, and it never will be while boards are selected on
affordability. The fingerprint fixes the class.

## 6h-quater. Keystone and Locksmith, re-audited against a gate

Both had measured as doing nothing, and both for the same reason: their whole
effect is bypassing empty-column restrictions, and until Royal Gates was wired
there were none in the game to bypass. Keystone sat at +0.6 moves and 4% of lost
boards; Locksmith set `RuleSet.empty` to the value it already had.

The question is conditional, so `scripts/gates.ts` measures it that way — one
board, the gate flipped on a clone, at an unlimited budget so only structure is
under test. 120 boards, stage 10:

| board | no Keystone | with Keystone | Keystone is worth |
|---|---|---|---|
| plain | 70% | 64% | **-6pp** |
| Royal Gates | 48% | 57% | **+10pp** |

Keystone helped where there was a gate and **hurt where there was not**, which
named the culprit. It had been given a second effect — entering an empty column
free — precisely because it had nothing to bypass, "to give it something to do
on every board rather than only under Royal Gates". Entering an empty column is
usually a bad move, since it spends the only true sink in the game, and pricing
it at nothing is what got the player to make it. The same shape as Anchor: an
effect that adds legal moves is a rescue on a dead board and a tax the rest of
the time.

Re-run with that half removed, so the card is legality and not price:

| board | no Keystone | with Keystone | Keystone is worth |
|---|---|---|---|
| plain | 70% | 70% | **+0pp** |
| Royal Gates | 46% | 54% | **+8pp** |

The penalty is gone exactly and the benefit survives, so the free-entry half is
cut. (The gated baseline moving 48% to 46% between the two runs is the
documented wall-clock board-set drift, not the change.)

Royal Gates lands on 10.1% of all boards and 18.0% of boards from stage 8 up,
where it is legal. So Keystone is worth about **+1.4pp across a run** — real,
but far too thin to promise, and it keeps no chip. It is no longer a trap, which
is the actual result: the card was net **negative** to own before this.

**Locksmith needs no arm of its own.** On a gated board the charm sets `empty`
back to `'any'`, which is exactly the ungated column of the table, so it
recovers the whole 22-point Royal Gates penalty on the boards that carry one —
about +4pp expected across deep boards.

### And it waives Tithe, which its text always promised

At 18.0% of deep boards and 60 gold — the top of the rare band — a hedge against
one modifier was not worth its price. The answer was not to cut the price. The
charm's text is *"Empty-column restrictions never apply to you"*, and Tithe, a
two-move tax on entering one, is a restriction; it simply never applied it.
Covering Tithe as well takes the charm from 18.0% of deep boards to **32.0%**.

Measured on 120 paired Tithe boards: **61% cleared paying the tax, 93% with it
waived, +32pp.** Larger than the 22 points it recovers under Royal Gates, and
that is the right way round — against a tight allowance, saving moves beats
restoring legality. Expected across deep boards the two halves come to roughly
+9pp, which a 60-gold rare can carry.

**This is not the mistake Keystone made,** and the distinction is the whole
reason it measures positive. Keystone entered empty columns *free* on every
board, including the ones with no restriction at all, and measured -6pp because
entering an empty column is usually a bad move and pricing it at nothing is what
got it played. Locksmith only ever restores the *ordinary* price. There is a test
asserting it never goes below it.

### An instrument note, because this one nearly produced nonsense

The two halves need different regimes, and using one for both would have been
confidently wrong in either direction.

Royal Gates changes what is **legal**, so it is measured at an unlimited budget
where only structure shows. Tithe changes what things **cost**, and at an
unlimited budget a cost is invisible by construction — the arms come out
identical and the honest reading of that is "no effect", which is the instrument
talking rather than a fact about the charm.

The first Tithe pass hit the other wall. At bank 0 the control cleared **1 of
120** — a deep Warden with no carry is already dead — and against a control
pinned at zero any move-saving effect measures enormous. It read +32pp, the same
number the sound run later produced, and it would have been right by accident.
The regime that matters is the one a player is actually in: arriving with the 21
moves `humanrun.ts` measures as peak bank since the cap, where the control sits
at 61% and off both walls. `scripts/gates.ts` now warns when a control lands
within 5% of either wall.

## 6h-quinquies. The curve did not move, measured rather than argued

Three changes landed after the difficulty arc was last measured: the Keystone
free-entry cut, the modifier floor being held back to stage 4, and the Locksmith
Tithe waiver. Two reviews flagged that nobody had re-run the spine against them.
Re-run 2026-09-10, same 24 boards a stage, bare deck, no build:

| stage | 1 | 3 | 5 | 7 | 9 | 11 | 13 | mean |
|---|---|---|---|---|---|---|---|---|
| baseline (2026-09-09) | 75% | 58% | 54% | 50% | 29% | 21% | 21% | 44.0% |
| after all three | 75% | 58% | 50% | 50% | 33% | 17% | 21% | 43.4% |

Four stages identical, three moved by exactly **one board in twenty-four**, which
is the wall-clock deal drift this document already warns about. `winnable` is
identical at every stage: 100/100/96/100/92/79/79 both times.

So the answer is nothing moved, and it was predictable from the code — Keystone
diverges only on `d.key`, which is `ench === 'key'`, and this curve deals a bare
`starterDeck` where every card has `ench: null`; Locksmith needs the charm, which
this curve does not carry; and the floor was already in the baseline. That
argument was made in a review two days ago and recorded as *a proof from the
code, not a measurement*. This is the measurement, and it agrees.

Worth keeping the distinction. The argument was sound and would have been worth
acting on, but it was cheap to check and the project has been wrong four times
about instruments it reasoned about instead of running.

## 6i. Two checks that came back clean

Recorded because a negative result nobody wrote down gets re-run forever.

**The daily deal is safe.** It is one seed shared by everyone who plays that
day, so a dead opening board is not "a run that ended" — it is the same ruined
board for every player at once, which is a different and worse kind of bad. It
had never been checked since deals stopped being certified. Walking a year of
real date keys (365 seeds, from 2026-09-08): **0 opening boards with no line at
all**, and 43 of 365 (12%) lost by the fallible player, which sits right against
the 83% stage-1 clear rate in the curve. Nothing to fix.

That the daily is safe is close to structural rather than lucky: its first board
is an ordinary stage-1 board, and stage 1 measured 100% winnable in the curve
sweep. It is worth re-checking only if stage 1 itself gets harder.

**Every measurement script still runs.** There are sixteen of them now, several
written against signatures that have since changed, and a script that throws is
a measurement nobody can reproduce. All sixteen execute against current code and
produce output: `balance`, `columns`, `compound`, `cost`, `curve`, `deadboards`,
`economy`, `enchaudit`, `escapes`, `humanrun`, `odds`, `passes`, `probe`,
`rulecost`, `solverlab`, `worth`. Note `probe.ts` takes `(stockSize, faceUp,
columns)` rather than a sample size, so passing it a small number silently
measures a degenerate board rather than failing — the one script whose arguments
do not follow the others.

## 7. Known gaps

- No leaderboards or cloud save — both need a backend, and the game is
  deliberately offline for now. The daily deal is seeded from the date, so a
  leaderboard is a small addition later.
- No localisation pass; all copy is English and hard-coded.
- Difficulty at the shallow end is set by `ratioFor`, not by search quality (see
  the measurement in §2). Whether stage 1 at 1.70 is the right welcome is a
  judgement call that wants real players, not more telemetry. (This bullet said
  1.30 until the 2026-09-05 review; that was the old curve, and `ratioFor` has
  opened at 1.70 since.)
- **There is no clearability guarantee any more, on purpose.** It was retired
  when deals became honest shuffles. The number that replaced it is the
  estimated win chance in `src/game/odds.ts`, and about a fifth of boards are
  lost whatever the allowance. Calling those "dead shuffles rather than missed
  lines" was too strong and is corrected: re-measured with a real node bound and
  a clean control, 42% of them do have a line, though not one shown to be
  findable by a person. `rescue.ts` still names a winning card on 24 of 25.
  The claim that used to close this bullet — six-column boards the sharpest
  edge at 76% against 91% for seven — **does not reproduce and is withdrawn.**
  Re-measured over 194 boards at stages 2-14 at each level's own budget, six
  columns cleared 54% and seven cleared 38%: the ordering is reversed and both
  figures are far from the old ones. No replacement number is given, because
  that measurement is confounded and so, probably, was the original — column
  count is set by the Narrow and Wide modifiers, which carry threat that the
  stipend then compensates, and the stages are not evenly spread across the
  arms. Answering it properly means holding stage and threat fixed and varying
  only the column count.
- **The win curve in `odds.ts` was re-measured after the pivot and held.** It
  was originally taken on a generator that eased boards until they fit, so it
  was the most load-bearing possibly-stale number in the project; a second sweep
  on honest shuffles moved every point by 5 points or less, inside the noise at
  40 samples. The two sweeps are pooled, so it now rests on 80 boards a point.
- **The economy is tuned against the wrong player.** A shallow player needs a
  median 1.0-1.7x par while `ratioFor` pays 1.25x plainPar at stage 10 and falls
  geometrically past 17, so full runs with that player end around stage 2-3
  rather than 15. (The 0.90x quoted here before the 2026-09-05 review was from
  the superseded curve.) Note that §7's other economy bullets are about the
  allowance, whereas `docs/ECONOMY.md` now concludes the ceiling is set by dead
  shuffles instead — the allowance is no longer the binding constraint. The ratio curve
  needs recalibrating against a human-shaped player, not the solver. Numbers and
  caveats in `docs/ECONOMY.md`.
- Landscape and tablet layouts are locked to portrait rather than designed.
