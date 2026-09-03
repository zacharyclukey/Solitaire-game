# Working agreement

## Start of every autonomous session, before touching the project

1. Schedule a review check-in **12 hours out** (`send_later`), so a dead session never loses the thread.
2. Schedule the **next work session** (`send_later`, typically 2-8 hours out) with a prompt naming what it should pick up.
3. Only then start work.

Do this first, every time, even if the session is short. The owner is often not watching;
the schedule is what keeps the project moving.

## Standing brief

- **Boards provide the difficulty curve; the bank provides the ability to meet
  it.** Depth should mean a harder puzzle, not a stingier allowance. The economy
  is what makes a complicated late deck survivable — a buffer that lets the
  player attempt something hard — not the thing that kills them. Keep it thin:
  a resource to spend well, not a system to administer.
- Difficulty must scale as a run goes deeper, and a run must eventually end.
  Runs end because boards outgrow the player, not because the allowance was
  quietly throttled.
- Success must feel like the player's doing, not the game's.
- A loss must feel like a near miss — fixable by one different move or one different enchantment.
- It has to feel like solitaire.
- Runs should be pretty hard.
- **The game is losable by default.** Deals are honest shuffles, not boards
  certified against the deck in hand. Skill and choices are what make a board
  winnable, and the ratio of winnable to losable IS the difficulty curve. A
  run-ending deal is fine; it only has to sit in a range that feels achievable.
- What must never happen is an *illegible* loss. Every lost board should be able
  to name what would have won it — a different line, a card passed over in the
  shop — and the player needs outs they can buy for the boards that are
  genuinely dead. Variance without escapes is not a roguelite, it is bad luck.
- Iterate, invent and design along the way — do not just execute the ticket as written.
  If measurement contradicts the plan, change the plan and say so.

## House rules

- `npx tsc --noEmit` and `npx vitest run` pass before any commit.
- Gameplay changes also need the smoke test: `npm run build`, serve on 4173,
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/qa.mjs "http://localhost:4173/?qa=1" /tmp/qa 4`, zero errors.
- Commit with an explicit file list. Never `git add -A` (it has swept up other agents' WIP).
- Branch: `claude/solitaire-roguelike-game-k408z6`.
- Never put a number in the docs that was not measured. Per-stage rates need >=20 runs;
  below that the noise is +/-14 points and you will tune against nothing.
