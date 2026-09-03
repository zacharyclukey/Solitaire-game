# Working agreement

## Start of every autonomous session, before touching the project

1. Schedule a review check-in **12 hours out** (`send_later`), so a dead session never loses the thread.
2. Schedule the **next work session** (`send_later`, typically 2-8 hours out) with a prompt naming what it should pick up.
3. Only then start work.

Do this first, every time, even if the session is short. The owner is often not watching;
the schedule is what keeps the project moving.

## Standing brief

- Difficulty must scale as a run goes deeper, and a run must eventually end.
- Success must feel like the player's doing, not the game's.
- A loss must feel like a near miss — fixable by one different move or one different enchantment.
- It has to feel like solitaire.
- Runs should be pretty hard.
- **Never** deal a board that cannot be cleared with the resources the player actually has.
- Players must not lose late runs to an unsolvable deck. They must lose to their own economy.
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
