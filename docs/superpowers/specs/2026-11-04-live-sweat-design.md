# Live sweat: in-game stats, early cashing, live-cash leaderboard

Status: draft for approval · 2026-11-04

## Why

Mid-game, the sweat screen today is mostly static. Game scores refresh every 15 minutes (and cost
Odds API credits), player props show nothing until the host types in the final stat, and the
leaderboard ranks by projected value, which feels abstract. The owner wants the sweat screen to feel
like a live game tracker for your bets: "if I have Tyrese Maxey over 18.5 points and he has 12, I want
to see how close he is." Seeing the game (score, clock, what just happened) and your bets moving is
the point of the sweat phase.

## Goals

1. **Live game strip**: score, clock/period, and the most recent plays for every game in the
   tournament, with an "all plays" view.
2. **Live bet trackers** on every open leg:
   - props: current stat vs line ("12 / 18.5 · needs 7") with a progress bar;
   - spreads / totals / moneylines: where it stands now ("Up 5 · covering by 1.5").
3. **Early cashing (owner-confirmed)**: an Over prop cashes the moment the live stat passes the line;
   the payout goes into the bankroll right then and the leaderboard moves. Anytime TD cashes on the TD.
4. **Leaderboard ranks by live cash** (bankroll incl. anything already cashed). Projected value moves
   into each player's dropdown (tap the name), next to their bets.
5. **Updates without refreshing**, roughly every 30–60s while a game is on.
6. **Spend fewer Odds API credits**, not more.

## Non-goals

- Live in-game betting (placing new bets after lock). Lock rules are unchanged.
- A paid stats provider. Revisit if ESPN proves unreliable.
- Correlation modelling for same-game parlays (unchanged: legs multiplied as independent).
- Team/league logos (still banned by DESIGN.md).

## Anti-goals (fails even if it "works")

- Paying out twice, or taking money back after it was cashed.
- Any Realtime payload carrying picks, stats tied to a user, or bankrolls (signals only, as today).
- Burning more Odds API credits than today's 15-minute score polling.
- Blind picks leaking before lock through the new live tables or views.

## Decisions made by the owner

- **Data source: ESPN's free public site API** (unofficial, no key), e.g.
  `site.api.espn.com/apis/site/v2/sports/{basketball/nba|football/nfl}/scoreboard` and
  `.../summary?event={espnId}` (box score per player, play-by-play, status/clock). Verified live on
  2026-11-04: NBA scoreboard + summary return score, clock, per-player MIN/PTS/REB/AST..., and plays.
- **Roles of each source:**
  - **Player props: ESPN is the official source.** ESPN's live box score decides when an Over has
    hit (early cash) and ESPN's final box score grades everything else (Unders, unhit Overs).
  - **Game results (spreads, moneylines, totals): The Odds API is the official source.** ESPN is only
    the trigger/reminder: when ESPN says something decisive happened (a game went final, or the live
    combined score passed a total's line), make ONE budgeted Odds API scores call to confirm, and
    grade from the Odds API result. This replaces the fixed 15-minute in-play polling.
- **Over props cash immediately** when hit, mid-game, and the money lands in the bankroll at once.
- **Leaderboard = live cash.** Projected value lives in the tap-to-open dropdown.
- **Theme:** the existing "Night game" design system (docs/DESIGN.md). Approved mockup:
  `.superpowers/brainstorm/4655-1793838089/content/sweat-live-v2.html`.

## Behaviour

### When money hits the bankroll

| Bet | Cashes / loses when | Official source |
|---|---|---|
| Prop Over (pts, reb, ast, pass/rush/rec yds, pass TDs, alt ladders) | **wins** the moment ESPN's live stat > line; loses at final | ESPN |
| Anytime TD | **wins** on the first TD (rush or receiving); loses at final | ESPN |
| Prop Under | at final | ESPN |
| Game total Over | **wins** once the confirmed combined score > line; loses at final | Odds API (ESPN-triggered) |
| Game total Under, spread, moneyline | at final | Odds API (ESPN-triggered) |
| Parlay | wins when every leg is won (pushes/voids drop out, as today); **loses the moment any leg loses**, even mid-game | per leg |

A leg that has already won shows "locked in" inside a still-open parlay. Payout math is unchanged
(mirrors place_wagers; CLAUDE.md "Grading & sweat").

### Corrections (builder's call, recorded here: _cash stands_)
Once a leg is won or lost it is final, same as "finals are final" today. A later ESPN stat correction
never reverses a cashed leg or charges anyone back. The host's existing manual prop grading
(grade_prop) remains as the fallback for props ESPN never reports (player missing from the box score,
name mismatch, feed down), and the 48h prop / 12h game void rules stay as the last resort.

### Players who don't play (builder's call, recorded here: _void_)
A prop on a player who logs 0 minutes / is listed DNP, inactive or scratched in ESPN's final box
score is **void (stake refunded / parlay leg drops out)**, matching sportsbook convention, instead of
grading Unders as winners at 0. A player who plays and records 0 is graded normally.

### ESPN vs host grading (builder's call, recorded here: _ESPN first, host after a grace period_)
For props on ESPN-matched players, `grade_prop` is refused (new stable error code) until ESPN has had
a grace period to post its final box score (≈2h after the game goes final). After that, or for
players ESPN never matched, the host grades as today. First official write wins, as now.

### Projected (dropdown)
Projected = live cash + Σ (each open bet's live chance to cash × its payout). Also show "max if all hit".
- Props: chance from **pace**, not pregame odds: current stat, time elapsed, line. Before tip-off it
  falls back to today's pregame de-vigged probability. Exact model left to the builder (see below).
- Spreads/totals/moneylines: existing live model (score + clock), now fed by the fresher ESPN score.
- Computed on read, as today (`live_probability` / `private.leg_probability`); the leaderboard view
  stays security-invoker and blind before lock.

### Screen (approved mockup, app theme)
- Header with LIVE chip; games strip: teams, big scoreboard numerals, clock + period, last 2 plays,
  "All plays ›".
- Standings by live cash (owner-confirmed: **money you actually have right now** =
  `remaining_bankroll_cents`, open stakes NOT counted). Because that alone hides who's in good shape,
  every row with open bets also shows a **"how it's going" indicator** (owner asked for it; the form
  is my call): one dot per open bet, `win` if it would cash if games ended now, `loss` if not, `muted`
  if not started, plus a short line like "2 of 3 winning · +$420 if it ended now". The
  "if it ended now" amount uses the current score/stat only (no probabilities), so it's honest and
  easy to read; Projected stays in the dropdown.
- Your row is highlighted. Tapping any row opens: Projected, Max if all hit,
  and that player's legs with trackers (stat / line / needs N / progress bar; CASHED +$X chip in `win`;
  stake → payout in `brand`). Builds on the in-progress, uncommitted leaderboard dropdown work in
  `src/components/leaderboard/leaderboard.tsx` and `src/components/reveal/reveal.tsx`: keep it.
- Tabs (Standings / Picks / Games) were a mockup suggestion, not a requirement: builder's call.

## Constraints (from CLAUDE.md; non-negotiable)

- Odds API calls only from Edge Functions, each paid call through `odds_budget_reserve`/`settle`.
- ESPN fetches also run server-side only (Edge Function), never from clients. Clients read our DB.
- Realtime carries signals only; clients `router.refresh()`; RLS is the only gate.
- New tables/views touching wagers get pgTAP tests proving co-participants can't read before lock.
  Live game/player stats are public sports data (not user data) but must not be joinable into a
  pre-lock pick leak.
- Grading touches only outcome columns; settle via the existing `settle_wager` path; never pay twice.
- Pure logic (pace probability, tracker text, "is this Over decided?") in `src/lib/core` with Vitest;
  any SQL mirror must match it exactly (as odds.ts mirrors SQL rounding today).
- `supabase/functions/_shared` stays pure; new ESPN normalizer gets a fake/fixture provider for local
  dev and e2e (like `ODDS_PROVIDER=fake`), with zero network calls in tests.
- Mobile-first 375px, ≥44px taps, semantic tokens; run the screenshot tour after UI changes.

## Left to the builder

- **Matching**: ESPN event ↔ our `events` row (teams + date; reuse the team-nickname matching from
  migration 0014) and ESPN athlete ↔ prop `participant_name` (normalise names; unmatched players fall
  back to host grading and are listed in host tools).
- **Stat mapping** per market: NBA PTS/REB/AST; NFL passing/rushing/receiving yards, passing TDs,
  anytime TD = rushing + receiving TDs (decide on return TDs and state it).
- **Storage shape** for live games (score, clock, period, recent plays) and live player stats, and
  how much play-by-play to keep.
- **Cadence**: ESPN poll every ~30s per in-play sport via the existing pg_cron → odds-sync pattern
  (new job kind) or a sibling function; only while a locked/live tournament has a game in play.
- **Odds API safety net** if ESPN goes quiet or breaks: e.g. one budgeted scores call at expected game
  end and every 60 min after kickoff, so games still grade. Must stay under today's credit usage.
- **Pace model** for prop probability (e.g. Poisson/normal on remaining expected stat from the
  per-minute rate blended with the pregame line); must be monotonic and sane at 0% and 100% elapsed.
- Signal names/payloads (e.g. `live` {}), debounce so clients don't refresh more than every ~15s.
- Whether ESPN-triggered Odds API confirms are batched per sport.
