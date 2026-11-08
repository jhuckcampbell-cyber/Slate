# Changelog

Product and design decisions, newest first. Each entry says what changed and why it makes the game better.
Guardrails that never move: $100 play money, private friend groups, SMS-link join, blind picks until lock,
live sweat. See "Creative enhancements" in CLAUDE.md for the running backlog.

## 2026-11-08: a calmer leaderboard and a lighter lobby

Friends found the leaderboard "too much and confusing".

- **One number per player.** Each row is rank, name, the projected total in big type, and how far up or down from the
  starting bankroll they are (▲ $49.65 / ▼ $12). "Cash · Max" is gone; a short line under the title says what
  "projected" means. A note appears only when it matters (broke a house rule, busted, can't catch the lead).
- **One chance per bet.** Tapping a name shows their bets with a single bar and "Safe · 99% to cash". A single bet's
  only pick no longer repeats the same percentage; parlay legs still show each leg's chance.
- **Rules fold into one line** ("$100 each · 3+ bets · $20 max bet"); tap for bet types and parlays. The "picks stay
  hidden" note is a quiet line instead of another box.
- **Bankroll / At risk / Potential** is one strip instead of three cards.
- **The "Get the app" tip shows on your first visit only**, not on every page forever.

## 2026-11-08: a page for every game

- **Tap a game to see everything you can bet on it**, like a real sportsbook. The board stays clean (each game's
  spread, total and winner, plus "Player props & more"); the game page has tabs: **Popular** (the game lines and the
  top three players for each stat), **Game lines**, then one tab per stat. Each stat's tab holds both the over/under and
  the milestones (50+, 75+, 100+) under each player, so there are no separate "Alt" tabs to hunt through.
- The phone's back button closes it, a reload keeps it open (`?game=` in the URL), and picks from the board and any
  game page build one slip.
- Alternate spreads and totals are not offered yet: they would cost extra Odds API credits.

## 2026-11-08: football props move during the game

- **Yards, catches and touchdowns now update live.** The box-score job only ran for basketball, so a football prop
  sat at its pregame chance all game and the projected leaderboard never moved. Now odds-sync reads ESPN's free NFL box
  score too (passing, rushing and receiving yards, receptions, passing TDs, anytime TD): "62 Rush Yds · needs 13 more",
  "No TD yet" / "1 TD · scored", and the chance and projected money follow. No Odds API credits.
- **The live chance fits football.** Yards spread with the line (one long run moves them a lot), so a 30-yard first
  quarter doesn't look like a lock. Anytime TD fades with the clock until he scores. Negative rushing yards are kept.
  Migration 0023, pgTAP 16.

## 2026-11-08: house rules checked on submit, every player's props, honest empty tabs

From the founder's and friends' first real games.

- **You can't break a house rule by accident anymore.** Friends submitted one bet when the host required three (or
  kept cash when the host said "bet everything") and were ranked last at lock. Now a slip only goes through if, once
  placed, you meet every house rule. The database enforces it (migration 0022, errors `HOUSE_RULE_MIN_BETS` /
  `HOUSE_RULE_ALL_IN`), and the slip shows a ✓/✗ checklist with a button that says what's missing ("Add 1 more pick
  to place", "Bet $40 more to place"). With "bet everything" on, **Bet it all** splits what's left across your
  picks to the cent. Cancelling a bet before lock is still allowed; the checklist then reminds you to re-bet or
  rank last. This replaces the $1-per-owed-bet reserve from 2026-11-05.
- **Every player's props, not just one.** Rush yards once showed only Trevor Lawrence: each prop type came from one
  sportsbook, the first that had posted any line, and early in the week DraftKings had only the QB. Now each
  player comes from the first sportsbook (DraftKings, FanDuel, BetMGM) that prices them cleanly, so one book posting
  late no longer hides everyone else. No extra Odds API credits (all three books were already in the call).
- **No more "Props post shortly…" tabs.** Prop types with no lines yet are hidden; if a game has none at all, it
  says so plainly ("usually a day or two before kickoff").

## 2026-11-05: receptions

- **Receptions props** for football: over/under on catches, plus the alternate "5+ / 7+ catches" ladder (migration
  0021, tabs "Receptions" and "Alt receptions"). Graded like the other props: the host enters the catches once.
  Cost note: two more markets per NFL props call (about 2 more Odds API credits per game refresh).

## 2026-11-05: rules up top, a bet cap, player search, likeliest-first props

- **Rules at the top.** The Rules card now sits right under the tournament title, before the games, so nobody bets
  without knowing the game they joined.
- **One bet can't swallow the bankroll.** When the host requires N bets, every bet still owed keeps $1 back, so
  nobody can stake everything on one pick and then be unable to meet the rule. Enforced in the database
  (`place_wagers` wrapper, migration 0020, error `LEAVES_TOO_LITTLE`) and mirrored in the slip (`reserveCents`):
  the slip explains the limit and "Max" respects it. The host's existing Max bet still applies on top.
- **Search players** in every props list (name or team, any order of words).
- **Likeliest first.** Anytime-scorer and alternate-yardage lists go by chance (favorites at the top, long shots
  last) instead of A to Z; over/under props go by the line (stars first). Ties fall back to the name.

## 2026-11-05: team helmets, and a local data glitch fixed

- **Team helmets.** A small helmet (NFL) or jersey (NBA) in the team's colors sits next to every player and team:
  on the game lines, in Player props (team headers, each player, each ladder), the bet slip, My picks and every
  friend's revealed bets. Colors only, no logos (trademarks). Why: "who plays for whom" at a glance, without reading.
- **Glitch (local dev only, production was never affected):** the fake odds generator gave one made-up player every
  stat (a "receiver" with passing yards), never gave fake players a team, and mixed into a copied real game. Now it
  follows a depth chart (QB passes, 1-2 run, 2-4 catch), every fake player has a team, and names are unique across
  the league, so local looks like production.

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
