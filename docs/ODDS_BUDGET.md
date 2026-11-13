# Closed-beta Odds API budget

Run `node scripts/odds-budget-model.mjs` offline (no credentials, DB or API calls).
Migration `20261110000031_budget_pacing.sql` adds opt-in automatic pacing and a
narrow beta profile. Defaults remain manual / standard / paid OFF.

| Profile / workload | Credits/week | Average month | Five weeks |
|---|---:|---:|---:|
| Legacy manual standard, props off | 226 | 979.3 | 1,130 |
| Legacy standard, one prop game/sport | 434 | 1,880.7 | 2,170 |
| Legacy standard, all props | 2,290 | 9,923.3 | 11,450 |
| Auto standard, normal tier, props off | 76 | 329.3 | 380 |
| Beta, six NBA games on one night/week, normal | 33 | 143.0 | 165 |
| Beta, same slate, tight tier | 18 | 78.0 | 90 |
| Beta, same slate, critical tier | 13 | 56.3 | 65 |

These are uncapped demand estimates. Pacing can further reduce calls and delay
finals. The app cap is 400 of the provider's 500 credits, preserving a 100-credit
provider buffer. Average month = weekly cost * 52/12; five weeks is conservative
calendar planning. Legacy props-off spend is 96 odds + 130 scores per week;
auto standard normal demand is 42 odds + 34 scores. Beta normal is 21 odds + 12
scores. Groups share cache jobs; distinct slates, sports, later locks and creation
times can expand the workload.

## Workload and source facts

The original model uses 12 NFL Sunday games (seven at 13:00, four at 16:05, one at
20:20) plus six NBA games spread over three hours, each week. NFL games last 3.5h,
NBA games 2.5h. Groups open 48h ahead and lock at the earliest start. Beta uses
only the six NBA games on one weekly night. Six games across multiple sports or
nights cost more. Final delays, overtime, failures, retries, manual calls and other
API consumers need extra allowance. Models include a terminal poll when aligned
with cadence and assume timely finals; they are not settlement guarantees.

The model reads source constants: default odds are three markets with three books
(one billing group), costing 3 credits per sport call. Scores cost 2 credits with
`daysFrom=1`. NBA props are three markets; NFL props are ten markets, each billed
per event. Catalog, ESPN live/stats and Sleeper are free. ESPN live display does
not replace authoritative Odds API finals. Legacy cadence is 12h/2h/30m odds and
15m scores. The proposed snapshot rows in the offline model are comparisons only;
there is no snapshot-only production mode. The model does not simulate reservation
denials or the pacing controller. Review extractor assumptions when SQL changes.

## Operating the profiles

`npm run odds -- beta EVENT_ID ...` selects beta + auto with at most six explicit
IDs. An empty list safely schedules no paid pregame jobs. Replace IDs for each
weekly slate; expired IDs do not roll forward. Only allowlisted games within 48h
enter pregame jobs. Paid props are disabled in the due-list and reserve RPC even
if a host enables them. Existing settlement exposure remains eligible, including
games removed from the allowlist.

`npm run odds -- standard` selects standard + auto. Standard admits all tournament
slates and normal-tier props; requested demand can exceed 400. `manual` disables
pacing while retaining the profile; `auto` restores pacing. Beta's slate/props
restrictions and slower cadence remain active in manual mode. None of these
commands enable paid calls. Review `status` and `dry-run`, then `enable` when ready.
`disable` always blocks every paid reservation, including scores.

## Pacing and settlement priority

Auto computes today's ceiling from (remaining credits + today's spend) / remaining
UTC days, rounded up so small calls can proceed. A calendar-week ceiling uses
funds at the start of that week, prorated through month-end. Both subtract spend
already recorded, including unsettled reservations. Unused daily allowance is
redistributed over the remaining month; it cannot accumulate into a weekend burst.
The cap/provider buffer still apply. A crash retains its reservation; settle
replaces the estimate with charged usage. Once today's allowance is spent,
authoritative finals can wait until the next UTC day. No reserve can guarantee a
final once the monthly pool is exhausted; inspect missing finals in sync health.

Both modes protect **240 monthly credits for scores**, minus score spend/reservations
already recorded. Lower priorities cannot consume this pool. Auto also leaves at
least two credits, or the protected pool / remaining days rounded up, in today's
allowance. Scores may spend these credits; lower-priority refusals never set a
sport-wide backoff. Manual disables daily/weekly pacing but preserves the monthly
settlement pool, hard cap and provider buffer.

Claims sort scores/live first, then free stats, odds, props, catalog, with stable
sport/event ties. Every paid call still uses reserve/settle. No operator command
prints keys. `status` shows daily/weekly allowance remaining, settlement reserve,
profile, cadence and projected month-end usage. Projection scales month-to-date
usage by UTC calendar days elapsed; it is a trend estimate, not scheduled demand,
and can exceed the cap even though reservations stay capped. In manual mode the
allowances are informational.

Cadences live in `private.app_settings.odds_pacing_tiers`:

| Tier | Remaining monthly capacity | Odds >24h / >1h / close | Scores | Paid props |
|---|---|---|---|---|
| normal | at least 30% | 12h / 6h / 1h | 1h | standard only |
| tight | 10% to below 30% | 24h / 12h / 2h | 2h | dropped |
| critical | below 10% | 48h / 24h / 6h | 3h | dropped |

Bet freshness uses the same effective interval; slower cadence widens accepted
price age. Other service-only settings are `odds_budget_mode`,
`odds_budget_profile`, `odds_settlement_credits`, `odds_beta_event_ids`.
`odds_set_budget_policy` validates and atomically configures mode/profile/slate.
No migration enables auto or paid calls. For broader slates or faster guaranteed
settlement, increase the configured allowance rather than rely on this free beta.
