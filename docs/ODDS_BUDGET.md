# Demand-driven Odds API budget

Migrations 20261111000032?0034 upgrade the plan to **20,000 credits/month**,
with a **19,000 app cap**, 1,000 provider buffer, and a settlement reserve of
12% of the cap (2,280 initially, less recorded scores spend). The paid switch
remains OFF on a new installation; migration never enables it. Existing operator
switch state is preserved. Budget mode defaults to auto after this upgrade.

Every paid request reserves through odds_budget_reserve before fetch and settles
through odds_budget_settle, including failed requests. Unknown cost retains the
estimate. Reservations count immediately, serialized by the existing advisory
lock. The latest provider x-requests-remaining observation overrides optimistic
ledger capacity; outstanding reservations also subtract from that counter.
Response observations are ordered by settlement time, not reservation start.
The monthly ledger and provider buffer both constrain available capacity.

Auto pacing divides available funds across remaining UTC days and calendar weeks.
Unused daily capacity redistributes through month-end. Lower priorities cannot
consume the monthly settlement pool or today's protected scores share. Exhausted
daily allowance stops calls until capacity becomes available; freshness does not
promise fresh odds after a budget refusal. Manual mode is an explicit operator
override of daily/weekly pacing, retaining the cap, reserve and kill switch.

| Demand | Normal | Tight | Critical |
|---|---|---|---|
| Pending tournament pick, in play or within 30m | 15s | 1m | 5m |
| Other live tournament game | 2m | 5m | 5m |
| Other game within 1h | 2h | 4h | 6h |
| Game within 24h | 6h | 12h | 24h |
| Further out | 12h | 24h | 48h |

Tight starts below 30% of monthly capacity or today's allowance; critical
starts below 10% of either pool. Thresholds use
configured cap, never the old 400/500 limits. Settings live in
private.app_settings.odds_demand_tiers. Only unfinished tournament events in the
12h live window are eligible. Per-event due filtering precedes sport batching,
so a hot game does not add all far-away games to its request. Prices are shared
across tournaments. No global all-sports fast polling.

Cadence and freshness share private.odds_event_interval / odds_refresh_interval.
The existing odds_max_age signature serves both odds_board and wager validation
(ODDS_STALE / ODDS_CHANGED). Freshness is interval ? 1.5 + min(60s, interval/3):
a 15s cadence accepts up to 27.5s. Started games ingest separate is_live=true rows;
frozen pregame closing lines remain unchanged. Wager RPCs still reject live prices.
Props use the per-event endpoint only for tournaments enabling player_props,
remain pregame, and use the same event demand interval. Tight/critical auto tiers drop
props first. Beta's explicit slate and props restrictions remain in force.

Three featured markets ? one region cost 3 credits/call. One sport at 15s costs
720/hour, at 20s costs 540/hour, at 2m costs 90/hour. A 30-day month permits about
633 app credits/day before reserve priority; fast polling is intentionally brief
and budget-limited, never a continuous service guarantee. Scores cost 2/call;
props cost their market count per region. Catalog and ESPN display feeds are free.

Run `npm run odds -- status` for effective demand tiers, allowance, provider
counter and projected month-end trend; `dry-run` shows the next batch and spend
rates without provider calls. `enable` and `disable` control the independent paid
switch. `standard`, `beta EVENT_ID ...`, `auto`, and `manual` retain their operator
semantics. Projection is a trend, not a guarantee or permission to exceed the cap.
The legacy offline odds-budget-model.mjs compares historical beta workloads and
does not simulate these demand tiers; use status/dry-run for the deployed policy.

The preferred runner is workers/odds-worker (Node 24 ESM). It shares the Edge
engine, including fake provider support, normalization, single-writer lease,
run tracking, budget settlement and change-only cache writes. SQL heartbeat is
service-only and uses the DB clock; GET /health reports worker health. Cron keeps
its existing minute schedule but skips while a successful worker heartbeat is
less than 45s old. Worker failure automatically restores Edge fallback. Multiple
workers and cron still contend on the same lease. No API keys enter SQL or logs.

Validation in the Docker-free sandbox: lint, typecheck, Vitest only. Claude must
apply migrations to a disposable Supabase DB and run pgTAP, including 23_fast_odds,
then verify concurrent reservations, closing/live separation and cron takeover.
Legacy pgTAP files asserting free-tier defaults (400 cap, manual mode and old
cadences) need updated expectations in their owning task; they were not edited.
DB generated types require regeneration by the owner of src after DB application.

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

The model does not modify production configuration or paid-call switches.

## College sports (OFF by default)

`odds_college_enabled=false` keeps NCAAF (`americanfootball_ncaaf`) and NCAAB
(`basketball_ncaab`) off. Game lines only: no props, Sleeper rosters, or player stats.
ESPN scoreboard live data is display-only; paid Odds API scores provide finals.

The model adds one Saturday per week, opening 48 hours before earliest kickoff and
locking then. N available games are capped at `odds_college_max_events` (default 8).
Selected games start hourly, lasting 210 minutes for football and 150 for basketball.
The same tiers apply: 12h / 2h / 30m odds, 15m scores. Scores cost **2 credits per
sport call**; winner/spread/total cost **3 credits per sport refresh**, not per event.
The cap limits the modeled scoring window, not individual sport-call cost. Different
group selections can expand the union of events; per-tournament limits alone do not
guarantee an eight-event union. These are incremental costs, without props.

| Scenario | N | Selected/sport (cap 8) | Lines/week | Scores/week | Credits/week | Average month | Five weeks |
|---|---:|---:|---:|---:|---:|---:|---:|
| NCAAF only | 4 | 4 | 48 | 54 | 102 | 442.0 | 510 |
| NCAAB only | 4 | 4 | 48 | 46 | 94 | 407.3 | 470 |
| Both | 4 | 4 | 96 | 100 | 196 | 849.3 | 980 |
| NCAAF only, capped | 16 | 8 | 48 | 86 | 134 | 580.7 | 670 |
| NCAAB only, capped | 16 | 8 | 48 | 78 | 126 | 546.0 | 630 |
| Both, capped | 16 | 8 | 96 | 164 | 260 | 1,126.7 | 1,300 |

**College does not fit the free tier together with NFL/NBA.** Adding both capped
slates raises current props-off five-week demand from 1,130 to **2,430 credits**.
Enable only on a paid plan with headroom or in place of NFL/NBA after modeling the
chosen slate and cadence. Replacement alone does not guarantee a free-tier fit:
current-cadence college rows also exceed the 400-credit app cap.
The prop extractor accepts legacy prefix branches and exact NBA/NFL SQL branches.
