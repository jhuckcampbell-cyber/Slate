# Changelog

Product and design decisions, newest first. Each entry says what changed and why it makes the game better.
Guardrails that never move: $100 play money, private friend groups, SMS-link join, blind picks until lock,
live sweat. See "Creative enhancements" in CLAUDE.md for the running backlog.

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
