# Changelog

Product and design decisions, newest first. Each entry says what changed and why it makes the game better.
Guardrails that never move: $100 play money, private friend groups, SMS-link join, blind picks until lock,
live sweat. See "Creative enhancements" in CLAUDE.md for the running backlog.

## 2026-11-05 (overnight): friendlier, sleeker, easier to follow

Asked for by the founder after the first friends test. Each item says why.

- **New look: "game night", not a sportsbook.** The volt-lime-on-black palette read like DraftKings. The main color is
  now electric violet with a coral accent (one set of tokens in globals.css, easy to tune). Page titles are sentence case
  instead of all caps. Jargon is gone from the surface: "Moneyline" is "Winner", "Celtics ML" is "Celtics to win",
  the "Board" tab is "Games".
- **New logo.** A violet-to-coral tile with a bold white S and a spark (the live sweat). Used in the app bar, the
  installed-app icons, the favicon and the iMessage invite preview.
- **Home is a real menu.** The demo card with made-up names (Mike, Sam, Jo...) is gone. Your tournaments come first:
  live ones show the score and clock, past ones fold into "Past tournaments" with how you finished ("2nd of 5").
  Newcomers get three plain steps. A Settings gear sits top right.
- **Settings: odds as a percentage.** "-110 / +250" or "52% / 29%" (the chance each pick wins), saved on the phone.
  Why: percentages are the fastest way for a non-bettor to understand a price.
- **"New to this? How it works."** Tapping a tournament's title (or the pill under it) opens a plain-English sheet
  built from that tournament's actual rules: what it is, how it works, how you win, house rules, only the bet types
  this tournament allows, and how to read odds with dollar examples.
- **House rules: bet the whole bankroll, and a minimum number of bets.** Set when creating or in Edit rules. Players
  see a live checklist ("$60 left to bet · 1 of 2 bets"). Anyone who misses a rule isn't kicked out: they rank below
  everyone who followed them ("Broke a house rule · ranked last"). Why: no data is mutated at lock, it's visible and
  fair, and you can't win by sitting on cash when the group agreed not to.
- **Leave / delete.** Before picks lock, a player can leave (joined by accident) and the host can delete the
  tournament (two-step confirm). After lock neither is possible: friends are sweating those picks.
- **Quick switching.** The code chip in a tournament's top bar opens your tournaments; Home and New tournament too.
- **Watch the game in the app.** A live game card with a big score, clock ("8:21 - 3rd"), down & distance, and the
  last play, from ESPN's free scoreboard once a minute (NBA + NFL, zero odds credits). Bonus: in-progress scores
  now move every bet's live chance each minute instead of every 15. Finals still only come from the graded feed.
- **The ending gets a moment.** When a tournament finishes, a full-screen champion reveal with confetti and a
  podium, once per phone, then the final standings.
- **Fixes found along the way:** NBA clock under a minute ("45.3") was unreadable to the stats model; a player who
  left on purpose would have been sent to "The host removed you"; the host's explainer said "You invited you".

## 2026-11-05: Live Prop Sweat (enhancement #1)

**What.** NBA prop picks now follow the game:
- Each pick shows its player's live number and what it needs: "18 Pts · needs 8 more", "28 Pts · went over".
- A prop's chance to cash follows the box score and the clock instead of sitting at its pregame price all game:
  - an Over already past its line is 100%; an Under past its line is 0%;
  - in between, it's pace: points so far + the pregame expectation (from the player's main de-vigged Over/Under)
    × share of the game left, with a spread that narrows as the clock runs.
- Every open bet gets a tension tag: **Safe** (80%+), **Sweating**, **Danger** (20% or less). The tag colors the
  bet's progress bar; each leg's own chance is colored the same way.

**Why.** The sweat is the product. Before this, a friend whose player had 12 of 12.5 points still saw "50% to cash".
That kills the moment the app exists for. Now the leaderboard (ranked by projected value) moves with every
basket. The tags make the tension readable at a glance from across the couch.

**Smoothing.** The chance comes from the box score and the clock, not from live odds, so it can't jitter. It moves
only when a player scores or time runs, and the bars animate between values. Live odds would also cost credits on
every refresh; this costs none.

**Data.** ESPN's public box score (free, no key, no Odds API credits), about once a minute, only for NBA games in play
that someone bet a prop on, and only until the final. It is unofficial and not licensed for commercial use: swap in a
licensed feed before Slate makes money. Grading still goes through the host's stat entry.
