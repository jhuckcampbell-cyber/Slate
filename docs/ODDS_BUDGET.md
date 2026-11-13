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
