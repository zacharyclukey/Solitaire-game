# Store listing — Facedown 1.0.0

Bundle / application ID: `com.facedown.game` · versionName `1.0.0` · versionCode `1`

Everything below is ready to paste. Character counts are given where a store
enforces a limit; re-count if you edit the text.

---

## Names

| Field | Value | Limit |
| --- | --- | --- |
| App name (Apple) | `Facedown` | 30 |
| App name (Google) | `Facedown: Solitaire Roguelite` | 30 |
| Subtitle (Apple) | `Solitaire roguelite. Dig deep.` | 30 (uses 30) |
| Short description (Google) | `Solitaire with the foundations removed. Turn every card, run after run.` | 80 (uses 71) |

Apple's name field is deliberately just the word — the subtitle carries the
genre. Google indexes the name field far more heavily, so the genre goes in it
there.

## Promotional text (Apple, 170 — uses 148)

```
No foundations, no stock, no luck to hide behind. Every board is solved before
it's dealt, so if you lose you lost it fairly. See how deep you can get.
```

## Description

```
Solitaire with the foundation piles taken away.

Nothing ever leaves the board. The only goal is to turn every face-down card,
and the only resource is moves — spend the last one and the run is over.

FACEDOWN IS A ROGUELITE
Your deck is the board. Between levels you choose what to enchant, what to add
and what to cut, then pick which set of broken rules to take on next: a safer
board, a standard one, or a gauntlet that pays better and bites harder. Every
fifth level a Warden is waiting. Your score is how deep you got.

EVERY DEAL IS FAIR
A solver plays every board before you see it. The move allowance you're given
is derived from a line that genuinely exists, so no deal is ever impossible —
and by the deepest levels it expects you to play as well as the machine does.

TWELVE ENCHANTMENTS, FIFTEEN CHARMS, TWENTY-TWO RULES
A Torch turns the deepest buried card in its column. A Twin turns every hidden
card of its rank. An Anchor lets anything at all stack on it. Then the level
fights back: suits locked, stacks inverted, the reserve narrowed, sequences
broken up. They combine differently every run.

BUILT FOR A PHONE
Tap to pick up and see where a card can go, or just drag it. One-handed,
portrait, and quick to put down. Four-colour suits, high contrast and reduced
motion are all in Settings.

NO STRINGS
No ads. No purchases. No account. No network. Nothing is collected, and the
whole game works in aeroplane mode.

There's a two-minute guided board the first time you open it. After that
you're on your own.
```

## What's New — 1.0.0

```
First release.
```

## Categories

| Store | Primary | Secondary |
| --- | --- | --- |
| Apple | Games → Card | Games → Puzzle |
| Google | Games → Card | — |

## Apple keywords (100 — uses 95)

```
patience,klondike,freecell,deckbuilder,roguelike,run,puzzle,offline,strategy,singleplayer,cards
```

Words already in the app name or subtitle (`facedown`, `solitaire`, `roguelite`,
`dig`, `deep`) are deliberately absent: Apple indexes those fields already, so
repeating them here wastes the budget.

---

## Age rating

**Answer: Apple 4+ / Google Everyone.** Every content question is "None".

The one that needs care is gambling, because this is a card game.

> **Simulated gambling — answer: No.**
> There is no wagering. The player never stakes anything on a chance outcome:
> gold is earned by clearing a level and spent at a fixed-price shop, and
> nothing in the game can be bought with real money. There are no casino
> games, no slot machines, no betting, no odds displayed, and no card game of
> chance played against a house. Solitaire itself is a puzzle, not a wager.
>
> Both Apple's questionnaire and Google's IARC form treat "simulated gambling"
> as *simulating the act of betting*. Facedown does not. **Confirm this with
> the questionnaire wording in front of you at submission time** — IARC's
> phrasing changes, and a wrong answer here is a rejection.

Everything else — violence, language, sexuality, horror, drugs, contests,
user-generated content, unrestricted web access, location sharing — is None.

## App Privacy (App Store Connect)

Answer **"No, we do not collect data from this app."** That single answer
produces the "Data Not Collected" card on the listing, and no further
questions are asked.

Also relevant, and already configured in the project:

- `ITSAppUsesNonExemptEncryption` is `false` in `Info.plist`, so the export
  compliance question is answered automatically on every upload.
- `PrivacyInfo.xcprivacy` declares no tracking, no tracking domains, no
  collected data types, and one required-reason API (user defaults, `CA92.1`).

## Data safety (Google Play Console)

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | No |
| Is all of the user data collected by your app encrypted in transit? | N/A — no data is collected or transmitted |
| Do you provide a way for users to request that their data is deleted? | N/A — nothing is collected; local progress is erased in Settings or by uninstalling |
| Ads | No ads |
| In-app purchases | None |
| Target audience | 13+ (see note) |

**Note on target audience.** The game contains nothing unsuitable for any age
and would qualify for Google's Families programme, but opting in adds ongoing
policy obligations. Declaring 13+ is the simpler path for a first release; that
is a business decision, not a technical one.

## Required before you can submit

These cannot be produced from the repository — a human must supply them:

- [ ] A **support URL** that resolves (both stores).
- [ ] A **privacy policy URL** hosting `docs/store/privacy-policy.md`, and the
      support email filled into that file where it says `SUPPORT_EMAIL_HERE`.
- [ ] An **Apple Developer Program** membership and a registered App ID for
      `com.facedown.game`.
- [ ] A **Google Play Console** account and an upload key (see `RELEASE.md`).
- [ ] Screenshots: run `npm run screenshots`. Apple requires the 6.9" set and,
      if you ship to iPad, the 13" set; Google requires at least two phone
      screenshots plus a 1024×500 feature graphic, which is **not** generated
      by the script and must be designed.
- [ ] A decision on the copyright line and seller/developer display name.
