# Closed-beta Odds API budget

Run `node scripts/odds-budget-model.mjs` from any directory (Node only; no packages,
API calls, database, or credentials). The model reads repository defaults, not deployed
`app_settings`; check deployed settings separately before enabling paid calls.

**Current cadence does not fit the free tier, even with props off.** Three to five
groups can share the same cached jobs, but score polling alone exceeds the app cap.

| Scenario | Credits/week | Average month | Five weeks |
|---|---:|---:|---:|
| Current, props off | 226 | 979.3 | 1,130 |
| Current, props on one game per sport | 434 | 1,880.7 | 2,170 |
| Current, props on every game | 2,290 | 9,923.3 | 11,450 |
| Current, props off, opens seven days ahead | 286 | 1,239.3 | 1,430 |
| Current, props off, five groups created hourly | 250 | 1,083.3 | 1,250 |
| Proposed 12h/6h/1h odds; hourly scores; props off | 76 | 329.3 | 380 |
| Proposed one odds snapshot; 30-minute scores; props off | 74 | 320.7 | 370 |
| Proposed one snapshot, all props; hourly scores | 178 | 771.3 | 890 |

Average month means 52/12 weekly pairs. Five weeks provides conservative calendar
planning; actual UTC calendar-month spend depends on which nights fall in the month.
These are uncapped demand estimates: production will refuse calls at the cap,
leaving stale odds and potentially delaying grading, rather than spend these totals.

## Workload and source facts

Assume one 12-game NFL Sunday (seven starts at 13:00, four at 16:05, one at 20:20)
and one six-game NBA night (starts spread over three hours), every week. NFL games
last 3.5 hours; NBA games 2.5 hours. All groups initially open 48 hours before the
first start and lock at that first start. These are workload assumptions, not
provider guarantees. The script steps through minutes, polls immediately when due,
and stops scoring after the final poll. It includes one terminal poll at the modeled
finish when aligned with cadence. Final-report delays, overtime, failures, retries,
additional sports, manual calls, and other API consumers require extra allowance.

The script extracts these constants from source:

- Migration `20261103000007_odds_budget.sql`: quota **500**, app cap **400**,
  protected provider buffer **100**; odds every **12 hours** beyond 24 hours before
  kickoff, **2 hours** between 24 hours and one hour, **30 minutes** thereafter.
- Migration `20261103000008_grading.sql`: scores every **15 minutes**.
  `_shared/scores.ts` and `odds-sync/index.ts`: **2 credits** per sport-level scores
  call with `daysFrom=1`, including completed games for settlement.
- `_shared/budget.ts`: unique markets × ceil(bookmaker count / 10).
  `odds-sync/index.ts` defaults to DraftKings, FanDuel, BetMGM: one billing group,
  so default winner/spread/total lines cost **3 credits** per sport refresh.
- Latest `private.prop_markets`, in `20261105000021_receptions.sql`: NBA points,
  rebounds, assists = **3** markets; NFL = **10** markets (four main yards/catches
  markets, four alternate markets, passing TDs, anytime TD). Each event is a
  separate paid call. The old “approximately 3” props comment is outdated for NFL.

The due-list in `20261104000010_player_props.sql` groups game lines and scores by
sport, and props by distinct event. Groups and players do not multiply costs for
identical slates. Props enabled by even one group activate that event's full sport
market list; the current host switch does not select individual markets. Different
group selections expand the union of events, multiplying props and potentially
extending scoring windows. Independent tournament creation can force early odds
and props refreshes; the hourly-creation row models five groups for each sport.
Separate tournaments with later locks also keep pregame polling active longer
than this shared-earliest-lock baseline.

Current props-off weekly cost is **96 odds + 130 scores**. Scores alone average
**563.3/month**. Catalog calls, ESPN live scores/stats and Sleeper rosters use zero
Odds API credits. ESPN's display-only live feed does not replace authoritative final
grading through `scores_ingest`. Unfinished games may keep paid score polling active
until the scheduler's 12-hour cutoff; this model assumes normal timely finals.

The quota breaker does not rescue this plan: its 2× slowdown starts below 20% of
provider quota, but the cap already protects that 100-credit buffer. The model uses
factor 1. Successful calls are assumed charged at reserved cost; actual usage
headers settle the ledger and can differ. Missing headers retain reservations.
Extractors fail on unrecognized source formats; review them when changing SQL
settings or scheduler structure. This is a baseline simulator, not a SQL interpreter.

## Recommendations

1. **For current behavior, use a paid allowance.** Budget at least **1,430 credits**
   for five weeks with props off and seven-day signup, plus operating headroom;
   target **2,000 credits/month**. Full-slate props need **11,450** for five weeks
   even with 48-hour signup; target **15,000 or more**. These are required credit
   allowances, not claims about currently offered plans or prices. Choose an
   available plan covering them, then update quota/cap together and preserve a buffer.
2. **For a constrained free beta**, disable props, restrict opening to 48 hours,
   coordinate group creation, set tiers to **12h / 6h / 1h** and scores to **60m**.
   This gives **380 credits in five weeks**, leaving only **20** under the cap.
   It fits the modeled workload but is fragile; limit extra nights and monitor the
   ledger. Accept up to roughly an hour of delayed final settlement. Live ESPN
   display can still refresh independently. These are recommendations only; no
   settings are changed by this work.
3. **Gate all player props initially**, especially NFL's four alternate ladders and
   the passing/anytime TD markets. If testing props later, whitelist one game per
   sport and a small market subset: NFL passing/rushing/receiving yards or NBA
   points only. A single NFL game's current full bundle adds **160 credits/week**;
   one NBA game's adds **48**. UI hiding alone saves nothing: change the backend
   job's market list/event eligibility. A one-time full-slate props snapshot still
   costs **138 credits** before lines or scores, so it cannot fit this weekly free beta.
4. Snapshot-only odds could support 30-minute settlement at **370 credits/five
   weeks** with props off, but require explicit scheduler and freshness-policy
   changes. `odds_max_age` derives from refresh intervals; stopping refreshes alone
   makes cached prices stale and blocks betting. Prefer the paid tier if fresh
   prices, faster settlement, varied locks, or reliable operational margin matter.

Only this document and the offline script are added. No production configuration
or paid-call switch is modified.
