# Slate (SquadBets) - Architecture & Roadmap

## Context
The repo contains the implemented mobile-first, play-money tournament app, branded Slate. Blind picks and bankrolls are protected by Postgres RLS until tournament-wide lock; odds ingestion is budget-controlled; guests join from an invite link. This document summarizes the current implementation and its phased history. `CLAUDE.md`, `CHANGELOG.md`, migrations through `20261109000025_token_mode_fixes.sql`, and `src/app/` are the source of truth. Hosting and external auth setup remain beta blockers (below).

### Current product defaults
| Decision | Default | Why |
|---|---|---|
| Lock granularity | **Tournament-wide** `lock_time` (defaults to earliest kickoff in the slate) | Matches your spec. Per-game locks are backlog; there is no per-event lock column. |
| Player-prop grading | **Host manually grades props** in v1. Auto-grading comes later. | The Odds API supplies prop *odds* but no player *stats*. Live ESPN stats already power display and probabilities; auto-settlement from those stats is backlog. |
| Odds source | Book priority with fallback; prop books selected per player | Lines stay predictable and cost stays at 1 region. |
| Cache layer | **Postgres is the cache.** No Redis in v1. | At friend-group scale, a table plus Realtime is enough. Upstash can be added later if read load ever needs it. |
| Scheduler | `pg_cron` + `pg_net` → Supabase Edge Functions | Vercel Hobby crons only run daily. |
| Unwagered money | Counts toward your final score; optional `all_in` / `min_bets` house rules determine qualification. `min_total_wager_cents` is legacy and unused. | This is the common format for these contests. |
| Same-game legs in a parlay | Host switch, enabled unless explicitly false | One slot per game market or player stat; repeated slots reject with `CONFLICTING_LEGS`. Pricing and probability use an approximate independent-leg product. |
| Money | Integer **cents** (bigint wager/bankroll amounts) | No floating-point drift. |

---

## 1. CLAUDE.md (repo guidance summary)

```markdown
# SquadBets

## Stack
Next.js (latest stable, App Router, RSC) · TypeScript strict · Tailwind v4 · shadcn/ui · lucide-react
Supabase (Postgres, Auth incl. anonymous sign-ins, RLS, Realtime, Edge Functions, pg_cron)
TanStack Query v5 · Zod · The Odds API v4 · Vercel (+ next/og for share images)
Tests: Vitest (pure logic) · pgTAP via `supabase test db` (RLS/RPC) · Playwright (e2e, mobile viewport)

## Commands
npm run dev                  # Next dev server
npx supabase start           # local Postgres/Auth/Realtime (Docker; CLI is a devDependency)
npx supabase db reset        # re-apply migrations + seed.sql
npx supabase migration new <name>
npm run db:types             # regenerate src/lib/supabase/database.types.ts from local DB
npm test                     # vitest
npm run test:db              # supabase test db (pgTAP in supabase/tests)
npm run test:integration     # real parallel RPCs vs local stack (tests/integration)
npm run e2e                  # playwright vs a PRODUCTION build it starts itself (needs local
                             # Supabase + seed + functions serve; one-time: npx playwright install webkit)
npx supabase functions serve --env-file supabase/functions/.env   # odds-sync (fake provider) for local dev
npm run lint && npm run typecheck   # typecheck runs `next typegen` first (PageProps/LayoutProps)
npm run odds -- status|dry-run|sync|enable|disable   # Odds API budget (never prints the key)
npm run metrics              # beta numbers: repeat rate (groups that play again)
node scripts/make-icons.mjs  # regenerate PWA icons + favicon (public/icons, src/app/icon.png)

## Layout
src/app/                     /, /create, /join/[code], /t/[code], /account, /auth/callback
                             /join/[code]/opengraph-image (invite image), /manifest.webmanifest
src/components/sportsbook/   board, game detail (?game=ID), slip drawer, My picks
src/components/tournament/   lobby, rules, host controls, Realtime; post-lock ?tab=games
src/components/leaderboard/  standings, player dropdowns, host PropsDesk
src/lib/core/                pure TS odds, slip, props and probability helpers
src/lib/supabase/            browser/server/public clients, queries, generated types
src/proxy.ts                 session refresh
supabase/migrations/         schema, RLS, RPC source of truth
supabase/functions/odds-sync/ one Edge entrypoint for catalog, odds, props, scores, stats, live jobs
supabase/functions/_shared/  provider, normalizers, ESPN stats/live and roster adapters

Blind picks are gated by database RLS; writes use RPCs, never client odds or direct wager writes.
Service credentials remain server-only. See root CLAUDE.md for the complete rules and Next.js conventions.
```

---

## 2. Database Schema & RLS (`supabase/migrations/`, migrations 0001-0025)

### Tables (abridged schema overview)
The migrations are the executable DDL; this is a summary, not a reset script.

| Tables | Role |
|---|---|
| `profiles`, `events` | Public-facing identities and provider game catalog/scores |
| `tournaments`, `tournament_events` | Host, invite code, slate, tournament-wide lock, bankroll and JSON rules |
| `tournament_participants` | Hidden pre-lock bankrolls; legacy stored EV/rank fields are unused |
| `odds_cache`, `odds_markets` | Canonical prices and separate market freshness; alternate props include `alt_point` in their key |
| `wagers`, `wager_legs` | Snapshotted stakes/prices, outcomes and credited payout; read-time `live_probability`, `live_stat`, `participant_team` fields |
| `prop_results` | Host-entered stat results visible to the squad |
| `player_stats`, `game_live`, `player_teams` | ESPN live stats/scoreboard and roster-based player teams |
| Private sync state, `job_leases`, `api_usage`, budget/settings tables | Scheduling, single-flight, provider usage and credit enforcement |

`allowed_bet_types` includes game markets, `parlays`, `max_parlay_legs`, opt-in `player_props`, `same_game_parlays` (default on), `all_in`, `min_bets`, and optional `tokens`. Token amounts are cents, sum to the bankroll and force all-in; each wager spends one unused token. Migration 0025 enforces compatible bankroll/min-bets/max-bet settings and allows clearing tokens before anyone bets. The slip's "Parlay + singles" mode submits a parlay plus remaining singles atomically so all-in can be met.

There is no built chat/reaction feed; that remains backlog.

### Visibility helpers (security definer, which avoids recursive RLS)
```sql
create function private.is_participant(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournament_participants p
                 where p.tournament_id = tid and p.user_id = (select auth.uid()));
$$;

-- TIME-based, so reveal is exact even if the cron status job is late
create function private.is_revealed(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tournaments t
                 where t.id = tid and (t.lock_time <= now() or t.status <> all ('{draft,open}')));
$$;

create function private.owns_participant(pid uuid) returns boolean ... -- p.id = pid and p.user_id = auth.uid()
create function private.shares_tournament(other uuid) returns boolean ... -- for profiles visibility
```

### RLS policies (enabled on public tables; no FORCE RLS on wager/participant tables)
| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| profiles | own row, or `shares_tournament(id)` | UPDATE own row only (display_name, avatar) |
| tournaments | host or `is_participant(id)` | none (RPC). Host edits go through `update_tournament` RPC, which rejects changes once locked and allows bankroll changes only while the host is alone with no bets; token consistency is also enforced. |
| tournament_events | `is_participant(tournament_id)` | none (RPC) |
| tournament_participants | **own row**, or `is_participant(tid) AND is_revealed(tid)` | none (RPC) |
| wagers | **`owns_participant(participant_id)`**, or `is_participant(tid) AND is_revealed(tid)` | **none.** RPC-only writes (`place_wagers`, `cancel_wager`, `replace_wager`, grading). No client write grants. |
| wager_legs | same predicate as wagers, using the denormalized `tournament_id` + join to the owner | none |
| events | Public catalog (`anon` and authenticated) | service_role only |
| odds_cache | authenticated (includes anonymous guests) | service_role only |
| prop_results | Tournament participants | Host grading RPC only |

Bankroll is hidden too. `remaining_bankroll_cents` pre-lock would leak how much someone bet, so participant rows are also blind. For the pre-lock lobby, `get_roster(tid)` (security definer, participant-only) returns just `display_name, avatar, joined_at, has_submitted boolean`, which is enough for "5/8 locked in" social pressure without leaking the picks.

The public share preview `get_tournament_preview(code)` is granted to `anon` and returns only title, host name, sport, matchup, lock_time, participant count, bankroll, DB-clock `is_locked` and `server_now`. It powers the OG image and the join page.

### RPCs (security definer, `set search_path = ''`)
- **`create_tournament(title, description, sport_key, event_ids[], bankroll, max_bet, allowed, lock_time?)`** → `code`. Generates the code as prefix (from title, e.g. TNF) + 4 Crockford chars, with retry on collision. Defaults `lock_time` to `min(commence_time)`. Auto-joins the host.
- **`join_tournament(code)`** → participant row. Rejects if revealed. Idempotent.
- **`place_wagers(tid, slip jsonb)`** (batch singles, parlay, or mixed; all-or-nothing). All of these checks happen in one transaction:
  - lock the participant row with `SELECT … FOR UPDATE`
  - require `now() < lock_time` and every leg's event `commence_time > now()`
  - check each market against `allowed_bet_types` and the leg count against `max_parlay_legs`; allow same-game legs unless disabled; reject duplicate game-market/player-stat slots (alternates map to their main stat)
  - re-read every price from `odds_cache`. Reject with `ODDS_CHANGED` (returning the new prices) if any price or point differs from the client's `expected_price`. Reject `ODDS_STALE` if `fetched_at` is older than the freshness window.
  - compute decimal odds (product of legs) and payout `floor(amount × decimal)`
  - enforce `amount ≤ max_bet` and `amount ≤ remaining_bankroll`
  - debit the bankroll, add to potential payout, insert the wager and its legs
- **`cancel_wager(wager_id)`**: pre-lock, pending wagers only (`WAGER_SETTLED` otherwise), refunds. Atomic cancel + re-place uses the `replace_wager` RPC.
- **Service-only** (revoked from authenticated): `private.advance_statuses()`, `scores_ingest`, `private.grade_event(event_id)`, ingestion/budget RPCs. The leaderboard is an on-read security-invoker view, not a recompute job.

### Lock/reveal mechanics
- RLS uses `lock_time <= now()`, so picks are revealed **at the exact second** with no dependence on a job running.
- `pg_cron` runs `private.advance_statuses()` every 10 seconds: open -> locked -> live -> settled. Private participant-only channel `tournament:<id>` carries signals: `tournament` `{status, lock_time}`, `roster` `{change, user_id}`, and `scores` `{}`. Deletion sends status `deleted`. No picks/bankrolls are broadcast. Clients use `router.refresh()` and RLS reads, plus countdown, channel rejoin/visibility refresh, 20s version polling and 60s live refresh.

- A trigger blocks moving `lock_time` later once it has passed, and blocks any wager write after lock, even from RPC bugs.

### RLS test matrix (pgTAP, `supabase/tests/rls_blind_picks.test.sql`)
Users A, B, and outsider C:
1. Before lock, B sees 0 of A's wagers, legs, and bankroll.
2. C sees nothing at any time.
3. A sees their own.
4. After lock (simulated by setting `lock_time = now() - 1s`), B sees A's.
5. A direct `insert into wagers` fails for everyone.
6. `place_wagers` fails after lock, over bankroll, over max bet, on a disallowed market, or on a stale/changed price.
7. Concurrent `place_wagers` calls cannot overdraw the bankroll.

---

## 3. Odds Ingestion & Caching Strategy

**Principle:** fetch only what active tournaments need, at a cadence tied to time-to-kickoff. Write only changed prices, so Realtime traffic equals actual line movement.

**Pipeline:**
1. Every minute `pg_cron` -> `private.trigger_odds_sync()` -> `pg_net` -> `odds-sync`.
2. `odds_sync_claim()` claims due jobs using a lease row; PostgREST calls cannot share a session advisory lock.
3. Catalog, game odds, props, scores, stats and live jobs share the entrypoint. Paid calls reserve budget before calling and settle usage afterwards.
4. Normalization picks canonical prices (props choose a book per player). `odds_sync_ingest()` diff-upserts prices; unchanged prices only advance `odds_markets.last_seen_at`.
5. Clients read `odds_board` with DB-clock `is_stale` and subscribe to price changes on `odds_cache`.

**Cadence tiers (SQL/settings are authoritative):**
| Window/job | Interval | Data |
|---|---|---|
| Catalog | 6h | Free `/events` catalog |
| >24h to kickoff | 12h | Enabled game markets; props use their own event clock |
| 1-24h | 2h | Same |
| <1h | 30 min | Same |
| Scores | 15 min while tracked games are under way | Budgeted `/scores?daysFrom=1`; authoritative finals |
| NBA/NFL stats and live scoreboard | About once a minute | Free ESPN display/probability data; no automatic prop grading |

**Budget and breaker.** Default paid calls are disabled. Database reservations enforce the configured 400-credit monthly cap against a 500-credit quota and the provider's remaining counter; see the Phase 4 implementation notes for operator commands. No live odds polling is built. Prop calls cost requested markets x regions, so expanded catalogs cost more than the original three-market estimate.

**Bet acceptance.** Freshness is 1.5 x the SQL refresh interval + 1 minute, adjusted with the breaker; it uses market freshness, not price-row timestamps. `ODDS_CHANGED` returns moved prices for "Accept new odds".

**Closing line.** Pregame rows freeze via `locked_at`; bets also retain their own snapshots. The schema supports separate live rows, but live odds ingestion is not enabled.

**Scores and live stats.** `scores` jobs call `scores_ingest`; final game scores grade core markets and settle wagers transactionally. ESPN `live` jobs update `game_live` and in-progress event scores; only `scores_ingest` makes events final. ESPN `stats` jobs update `player_stats`, exposed through `wager_legs.live_stat`. Host-entered `grade_prop` remains the prop settlement path.

---

## 4. Win Probability & Grading Math (SQL runtime; TS helpers and tests in `src/lib/core/`)
- **Implied probability:** `+A → 100/(A+100)`, `−A → |A|/(|A|+100)`. Remove the vig by normalizing across a market's outcomes.
- **Single bet P(cash):** computed on read in SQL (`private.leg_probability`), using de-vigged pregame prices and score/time models for game lines. NBA/NFL props use box-score stats plus clock (`private.prop_live_probability` wrapping `leg_probability_base`), with pregame fallback. No live odds polling is required; live stats do not settle props.

- **Parlay P(cash):** product over pending legs. A hit leg = 1, a miss = 0 (dead), a push is removed. Leg-by-leg status and probability are shown in the UI.
- **Grading:**
  - Leg results are hit/miss/push by market (spread push on exact integer lines).
  - A won single pays `amount × decimal`. A push refunds the stake.
  - A parlay pushes its push legs out of the odds (decimal recomputed without them). Void legs drop out too; all-push/void wagers refund the stake.
  - The participant is credited the payout.
- **Leaderboard per participant:**
  - `cash` = remaining bankroll, including credited payouts
  - `max` = cash + Σ pending payouts
  - `EV` = cash + Σ P(cash) × payout
  - Rank qualified players first, then EV, then cash; unmet house rules give standing `disqualified`.
  - Status is **Busted** (max = 0), **Eliminated** (max < leader's cash), or **Alive**.
  - The security-invoker `leaderboard` view computes these on read; signals trigger RLS-protected refetches.

---

## 5. Milestone Roadmap

### Phase 0: Scaffold (built)
- Next.js App Router, TypeScript, Tailwind/shadcn, Supabase, npm scripts and test configuration are in the repo. Public hosting is still outstanding.

### Phase 1: Auth, tournament creation, invite link & SMS preview (built; external setup pending)
- Anonymous browser sign-in, email magic links/account claim, `src/proxy.ts` session refresh and profile trigger.
- `/create` wizard, `/join/[code]` single-screen join and invite OG image, `/account`, `/auth/callback`.
- Native share/SMS invite link; under-15s join remains a product target, not a production measurement. Twilio OTP, Turnstile and public-device preview validation remain outstanding.

### Phase 2: Odds ingestion, slip builder & bankroll validation (built)
- Migrations 0004-0005 and later updates: lease-based odds sync, cache/freshness, batch `place_wagers`, cancel/replace, bigint amounts and capped payouts.
- `/t/[code]` contains game lines, game-detail tabs (`?game=ID`), opt-in props and the slip drawer. Token mode supports "Parlay + singles". There are no `/slip` or `/sweat` subroutes.

### Phase 3: Blind lock & live reveal (built)
- RLS, lock triggers, 10s status cron, private Realtime signals and DB-clock countdown.
- Pre-lock My picks and roster; post-lock one-time reveal, then Leaderboard | Games tabs (`?tab=games`) and each player's expandable picks.
- Host editing, early lock, removal and pre-lock delete; players may leave before lock.

### Design foundation (updated 2026-11-08)
Light "Ticket stub": paper/black ink, bold tap outlines, selected tabs light blue, coral highlights and the `slate/` wordmark. See `docs/DESIGN.md` and `CHANGELOG.md`.

### Phase 4: Real odds, safely (built; production setup pending)
- Secret-only API key, fake provider locally, database credit reservations/cap, operator dry-run and enable/disable commands. Game lines and per-event props use configured pregame cadence; no live odds polling.

### Phase 5: Live grading, win probability, realtime leaderboard (built core; enhancements backlog)
- `odds-sync` scores jobs automate core-market finals; host PropsDesk grades opt-in props. NBA/NFL live box scores and scoreboard drive chance bars and projected standings.
- Security-invoker leaderboard, player dropdowns, final celebration and plain-text "Copy result" are built.
- **Backlog:** auto-settling props (including non-participant void logic), reactions/moment badges, chat/feed, shareable final-results images and Slip Receipts, sweat alerts. Invite OG images and plain-text result copying do not implement those receipt/result-image features.
- Live in-game odds and alternate game spreads/totals are not offered.

---

## Verification (applies to every phase)
- `npx supabase db reset` then `npm run test:db`: RLS/RPC pgTAP suite. The blind-pick tests are the gate for merging.
- `npm test`: core math, code generation, payout and grading cases.
- `npm run e2e`: Playwright on an iPhone viewport, with a multi-context test (two users) for blind and reveal.
- Local dev uses `ODDS_PROVIDER=fake` through the real normalize/ingest path; `npm run odds -- dry-run` plans costs without provider calls.
- Manual: real SMS share to iMessage and Android for previews, and a two-phone sweat test during a live game.

---

## Implementation notes: as built (Phase 0–1, 2026-11-03)
Implementation details (historical milestones, reconciled with current behavior):
- **npm, not pnpm.** Corepack needs admin rights on the dev machine. The Supabase CLI is a devDependency (`npx supabase`).
- **Next.js 16.4.** Middleware is `src/proxy.ts`. Cache Components is on, so per-user pages are a static shell plus `<Suspense>` plus `await connection()` (see CLAUDE.md).
- **`events` is readable by `anon`.** Game schedules are public, and the create wizard lists games before the host has a session. Everything tournament-related stays participant-only.
- **`get_tournament_preview` returns `is_locked`,** computed with the DB clock, so the join page never decides lock state with the server clock.
- **`create_tournament(p_title, p_event_ids, p_code_prefix, …)`.** The prefix comes from `src/lib/core/codes.ts` (cosmetic). The 4-char suffix is generated in SQL with `gen_random_bytes`. Guards:
  - 10 tournaments per host per hour
  - at most 20 events per tournament
  - one sport only
  - lock must be at or before the first kickoff
  - at most 100 participants (enforced by `join_tournament`)
- **No `FORCE ROW LEVEL SECURITY`.** Writes happen only through security-definer RPCs owned by `postgres`. Clients have no write grants on those tables at all, which is stricter than having no policies.
- **Local game catalog comes from `supabase/seed.sql`**, with games relative to `now()`, instead of a one-off Odds API fetch. Real ingestion is implemented in odds-sync.
- **Join flow signs guests in from the browser,** not a server action. Supabase's anonymous sign-in limit is per IP, and a server action would make every signup come from the server's IP.

**Phase 1 items still open:**
- SMS OTP. Email magic link is done. SMS needs Twilio credentials in Supabase Auth.
- Turnstile captcha on anonymous sign-ins. Needs Cloudflare keys.
- Linking a Vercel project.
- Checking the OG preview on a real iMessage/Android device. Needs a public deploy.

## Implementation notes: as built (Phase 2, 2026-11-03)
**Deviations from the plan, and why:**
- **One batch RPC, `place_wagers(tournament, slip)`, instead of `place_wager`.** A slip of singles, a parlay, or mixed bets books all-or-nothing in a single transaction. `ODDS_CHANGED` reports every moved line at once, with the new prices in `details`.
- **Bet freshness is tied to the sync cadence.** The plan's fixed 10/4-minute windows contradicted its own 3h/20min cadence. Prices are now bookable up to 1.5 × the refresh interval + 1 minute. Cadence and freshness come from the same SQL functions (`private.odds_refresh_interval` / `odds_max_age`), and both widen together under the credit breaker.
- **Freshness lives in `odds_markets.last_seen_at`, not on the price rows.** Unchanged prices never touch `odds_cache`, so Realtime traffic equals real line movement. Clients read the `odds_board` view, where `is_stale` is computed by the DB clock.
- **One canonical price per outcome.** The `odds_cache` key is (event, market, outcome, player, is_live). Book choice (priority list with fallback) happens in the normalizer, and the source book is stored for provenance.
- **Single-flight uses a lease row (`private.job_leases`) instead of an advisory lock.** PostgREST calls don't share a session.
- **A new tournament makes its sport due immediately.** Otherwise newly added games could wait up to 3h for first prices.
- **The catalog uses the free `/events` endpoint** (0 credits) instead of an h2h `/odds` call.
- **The fake provider (`ODDS_PROVIDER=fake`) replaces recorded fixtures.** It returns responses in The Odds API v4 shape for events already in the DB, deterministically, with drift every 10 minutes. The production normalize/ingest path therefore runs locally and in tests.
- **Blind RLS on wagers/legs landed in Phase 2, not Phase 3.** CLAUDE.md rule 1 requires it the moment wagers exist.
- **Money columns moved to bigint, and parlay payouts are capped at 1000-to-1.** The cap is enforced identically in SQL and `src/lib/core/odds.ts`.
- **`events.commence_time` moving earlier pulls `lock_time` forward** (trigger), which keeps "lock ≤ first kickoff" true.

**Deferred:**
- **Auto-settling props is backlog.** Opt-in prop betting, host grading and live prop stats/probabilities are built (migrations 0010-0023).
- **No edit UI for placed bets yet.** `replace_wager` (atomic cancel + re-place) exists and is tested; the UI offers cancel and re-add.
- **`min_total_wager_cents` is legacy and unused.** Current house rules use `all_in` / `min_bets`, enforced on submit; cancellation may leave a player ranked last. Token mode (0024-0025) forces all-in and validates token/rule consistency.

## Implementation notes: as built (Phase 3, 2026-11-03)
Migration `20261103000006_lock_reveal.sql`, pgTAP `04_lock_reveal.test.sql` (64 tests), integration `tests/integration/realtime.test.ts`, e2e `e2e/reveal.spec.ts`.

**Built:**
- **Lock guards (triggers).** Once `lock_time` passes (by `clock_timestamp()`, so a slip whose transaction straddles the lock is refused) or the status leaves draft/open: no wager/leg insert, no change except outcome columns (`status`, `is_locked`, `win_probability`, `settled_at`; legs also `odds_id`), and no delete except cascades from a deleted participant, account or tournament. The tournament's lock time and money rules freeze, status only moves forward, and nobody new can join. `pull_lock_forward` never touches a lock that already passed.
- **Status machine.** `private.advance_statuses()` runs every **10 seconds** under pg_cron: open → locked at `lock_time`, locked → live at first kickoff, live → settled once every game is final and every wager graded (grading is now implemented). Locking flips `wagers.is_locked`. There's a daily cleanup of `cron.job_run_details`.
- **Signals, not data.** One private Realtime channel per tournament, `tournament:<id>`, fed by `realtime.send` from triggers. `tournament` events carry `{status, lock_time}`; `roster` events carry `{change, user_id}` on join/leave and only when a player's "picks in" flag flips (later bets stay silent). RLS on `realtime.messages` admits participants only. There's no INSERT policy, so clients can't publish. Lobbies respond by re-rendering server components, so RLS stays the only gate on what's visible.
- **Missed signals are covered three ways.** A catch-up refresh on every channel (re)join, a refresh when the tab becomes visible, and a 20s poll of `tournaments.updated_at`. An e2e run with Realtime disabled still reveals on time via the countdown and the poll.
- **DB-clock countdown.** The `server_now` computed field plus `createServerClock` mean a phone with a wrong clock still flips at the real lock moment.
- **Host controls.** `update_tournament(id, changes jsonb)` edits title/description, lock time (any time in (now, first kickoff]), max bet, and bet types. Bankroll can change only while the host is alone with no bets. `lock_tournament_now(id)` and `remove_participant(id, user_id)` complete the set. A removed player is recorded in `private.tournament_removals`, and `join_tournament` refuses them with `REMOVED_BY_HOST`. Rule edits apply to new bets only, and no host error depends on hidden picks (lowering the max bet below a hidden bet succeeds), so the host cannot probe picks through errors. Token-rule consistency has additional migration 0025 guards.
- **Reveal UI.** One-time "Picks are in!" moment, then Leaderboard | Games tabs on `/t/[code]`; player dropdowns group picks by game with stake, payout and chance bars. The former By game / By player presentation has been replaced.


**Deviations:**
- The reveal is a section of `/t/[code]` rather than a separate route; the lobby swaps the sportsbook for the reveal at lock.
- Reveal data comes from plain RLS selects, not a security-definer RPC, so the blind-pick policies stay the single gate.
- `join_tournament` now reads the tournament `FOR SHARE`, so a join can't interleave with a bankroll edit or an early lock.

**Known gaps:**
- **Intermittent missed broadcasts.** In 1 of ~40 e2e runs a lobby received neither Realtime signal, even after the catch-up refresh. The suspected cause, unconfirmed, is the channel never joining right after the guest sign-in. The 20s poll bounds the impact; the root cause isn't confirmed.
- **No un-remove.** A removed player can rejoin only with a different account (a guest can clear cookies).

## Implementation notes: as built (Phase 4, 2026-11-03)
Default budget: The Odds API **free tier** (500 credits/month). Migration 0007 (`odds_budget`).

**Budget, enforced by the DB.** Every paid call reserves its estimated cost with `odds_budget_reserve` before calling, then `odds_budget_settle` replaces the estimate with the real cost from `x-requests-last` / `x-requests-remaining`. The DB refuses a reservation when:
- the paid-call switch is off (`PAID_CALLS_DISABLED`; the switch is **off by default**);
- this calendar month's ledger (UTC) would pass the cap of 400 (`BUDGET_EXHAUSTED`);
- the provider's own counter would drop below its last 100 (`quota − cap`). This also covers usage the ledger can't see, such as another environment sharing the key.

Reservations are serialized by an advisory transaction lock; the integration test proves a parallel race can't overspend, and it fails without the lock (426/400). An unsettled reservation keeps counting, so a crash can only over-count. A refused sport backs off for 15 minutes so cron stops waking the function.

**Free calls.** The catalog (`/events`) costs 0 and still records headers, which keeps the provider-counter reading fresh. Settings live in `private.app_settings`. To upgrade the plan, change `odds_monthly_quota`, `odds_monthly_cap` and `odds_refresh_tiers`; no deploy is needed.

**Cadence (free tier).** Refreshes run every 12h when a game is more than 24h out, every 2h within 24h, and every 30 min in the last hour. Bets accept prices up to 1.5 intervals + 1 min old. That's at most 46 minutes in the last hour, about 3 hours on game day, and about 18 hours further out. Each game card shows "Odds checked N min ago", or "Updating odds…" once a market is stale. Rough cost: about 40–50 credits per sport per slate with all three markets, shared by every tournament on that sport.

**Operator commands** (`scripts/odds.mjs`):
- `npm run odds -- status`
- `npm run odds -- dry-run`: a plan with costs and no provider calls
- `npm run odds -- sync`
- `npm run odds -- enable`
- `npm run odds -- disable`

For production, run with `node --env-file=<prod env> scripts/odds.mjs …` and `ODDS_SYNC_SECRET` set.

**First real call (2026-11-03, local).**
1. Catalog: 41 real NFL/NBA games for 0 credits; provider at 500/500.
2. Dry run predicted 1 credit for a moneyline-only test tournament.
3. With the switch off, the sync was refused.
4. With the switch on: one call cost 1 credit, real DraftKings prices were stored, and the ledger and provider both read 499. The switch was turned off afterwards.

Local dev and e2e stay on `ODDS_PROVIDER=fake`.

**Going live in production:**
1. `npx supabase secrets set ODDS_PROVIDER=the-odds-api ODDS_API_KEY=… ODDS_SYNC_SECRET=…`, plus the Vault `odds_sync_url` / `odds_sync_secret`.
2. `odds -- dry-run`.
3. `odds -- enable`.

**Known gaps:**
- Our month is the UTC calendar month. If the provider resets on another day, the provider-counter guard keeps us safe, but the ledger may block a few days early.
- Two environments sharing one key each keep their own ledger, so only the provider-counter guard spans both. Use a separate key per environment once paid.

## Implementation notes: as built (Phase 5, 2026-11-03/04)
Migration 0008 (`grading`).

**Scores.** odds-sync includes job kind `scores`, due every `scores_refresh` (15 min) per sport while a game in a locked or live tournament is under way. A game counts as under way from kickoff until 12h after it, unless it's already final. Real calls use `/scores?daysFrom=1`, which costs 2 credits and includes games that just finished, and they go through the same `odds_budget_reserve`/`settle` path. The fake provider (`_shared/scores.ts`) reveals a hashed final score linearly over the sport's game length. `scores_ingest` writes events (`live`, then `final`). A final is final: re-sends and later corrections are ignored, so nothing can pay twice. Changed games send a `scores` signal on each sweating tournament's channel.

**Grading.**
- In the same transaction as the final, `grade_event` grades pending legs. Push rules: moneyline pushes on a tie, and spreads and totals push on an exact line.
- `settle_wager` then settles every wager it decides:
  - any miss → lost;
  - all legs push or void → pushed (stake refunded);
  - otherwise won at the stake × the product of the live legs, rounded the same way as `place_wagers` (4dp, capped at 1001, floor).
- It credits `remaining_bankroll_cents`, and `wagers.payout_cents` records the credited return.
- The lock guard was widened on purpose to allow `payout_cents`.
- `advance_statuses` voids legs on games with no final 12h after kickoff, or that are postponed or canceled, only once the tournament is locked; ungraded props void after 48h. It settles a tournament when no wager is pending and every game is final, void or stale.

**Win probability** (on read, no credits, no cron), from `private.leg_probability`:
- **Before a score exists:** moneyline uses the de-vigged closing price. Spreads and totals use a normal model centred on the closing line.
- **Live:** final margin ~ N(current margin + μ·r, σ²·r), where r is the share of the game left by wall clock.
  - Game length and σ: NFL 190 min and 13.5; NBA 150 min and 12. Totals use σ_T of 13 (NFL) or 17 (NBA).
  - μ comes from the closing spread, or from the moneyline via the logistic approximation of the probit (1.702).
- A parlay's chance is the product of its legs' chances.
- Exposed as PostgREST computed fields `live_probability` on `wagers` and `wager_legs`, plus `current_payout(wagers)`.

**Leaderboard.** The view `public.leaderboard` (security invoker, so it is as blind before lock as the tables under it) has:
- cash (`remaining_bankroll_cents`);
- max = cash + current returns of pending wagers;
- EV = cash + Σ P × return;
- rank by qualification, then EV, then cash;
- standing: `busted` (max = 0), `eliminated` (max < the best cash), otherwise `alive`; unmet house rules are `disqualified`.

`tournament_participants.expected_value_cents` and `rank` are unused; the view replaced them.

**Sweat UI.**
- Lobby after lock: leaderboard (projected while live; "Final standings" plus a winner card when settled).
- Game cards: score and a Live/Final pill.
- By-player view: per-bet won/lost/push or a "% to cash" bar, and per-leg ✓/✗/percent.
- `TournamentLive` refreshes on `scores` signals and every 60s while live, since chances drift with the clock.
- "Unbet" is the starting bankroll minus stakes, because the live bankroll includes winnings.

**Tests.**
- `06_grading.test.sql` (44) replays a three-player tournament with hand-computed payouts (12242 / 14154 / 0), a push-repriced parlay, probabilities (Φ, de-vig, halftime model: 0.6719 / 0.1535), blindness before lock, idempotent finals and auto-void.
- Mutation-checked: counting pushed legs in the price fails 7 tests; a wrong Φ constant fails 5.
- `_shared/scores.test.ts`, `src/lib/sweat.test.ts`.
- `e2e/sweat.spec.ts`: lock, live score, leaderboard, final, graded bets, credited bankroll, winner.
- e2e `placeBet` accepts a fake-odds drift (an expected "Accept new odds") instead of flaking.

**Backlog (not built):** chat/feed and reactions, auto-settling props, shareable final-standings images / Slip Receipts, and sweat alerts. Host-graded props and plain-text Copy result are built. Live in-game odds remain unimplemented.

**Known gaps:**
- Stat corrections after a final are ignored.
- "Live" before the cron flips the status shows the tournament status as "Locked" for up to 10s.
- The scores endpoint has no game clock; live ESPN data now supplements it for NBA/NFL stats and scoreboard display. Probability remains an approximation.

## Beta prep (2026-11-04, while the beta itself waits on deploy + keys)
- **Metric.** `public.beta_metrics()` (service role; `npm run metrics`) measures the feasibility test: **repeat rate**, the share of finished tournaments where 2+ of the same players appear in a tournament created after its lock. It also reports created and finished tournaments, distinct players, average players per tournament, and wagers. `07_beta_metrics.test.sql` covers it; lowering the threshold to 1 shared player fails the test.
- **Nudge.** The final standings end with a "Run it back" CTA (→ `/create`), styled with the current Ticket stub design.
- **Still blocked on the user:**
  - Vercel project and public URL;
  - Twilio (SMS OTP) and Turnstile keys;
  - prod Supabase plus `supabase secrets set` for odds;
  - 3–5 real friend groups.

## Implementation notes: as built (player props, 2026-11-04)
Migration 0010 (`player_props`).
- **Opt-in.** `allowed_bet_types.player_props` (a switch in the create wizard and in Edit rules, off by default).
  - The catalog is `private.prop_markets(sport)`, mirrored by `src/lib/core/props.ts`:
    - basketball: points, rebounds, assists;
    - football: passing, rushing, receiving yards, receptions, alternate ladders, passing TDs and anytime TD;
    - other sports: none.
  - `place_wagers` accepts those markets only when the flag is on.
- **Odds.** One `props` job per game (props live on the per-event endpoint `/sports/{s}/events/{id}/odds`). It costs prop markets × regions (≈3 credits per refresh) and is reserved through the same budget. It runs on its own clock (`private.props_sync_state`), never the sport's game-line clock, with the same cadence tiers.
  - The parser keeps only players priced on both sides at the same line.
  - The fake provider prices made-up players (never real names) on .5 lines.
- **Board.** Game cards open game detail (`?game=ID`): Popular, Game lines, and one tab per available stat. Main and alternate lines share player groups; player search and team grouping are built. Empty stat tabs are hidden.
- **Grading** (the API has no player stats). After the final, the host calls `grade_prop(tournament, game, market, player, stat)`.
  - The stat is entered once per player/stat (main and alternate lines together) and grades every pending pick on it the same way: over/under/push on each pick's own line.
  - It's stored in `public.prop_results`, which the squad can read, so the host can't quietly fudge a result.
  - Errors: NOT_HOST, INVALID_STAT, GAME_NOT_FINAL, ALREADY_GRADED, NOTHING_TO_GRADE.
  - Props nobody grades are voided (refunded) 48h after kickoff, so tournaments always finish.
  - UI: `PropsDesk` gives the host stat inputs, shows players what's still waiting on the host, and lists entered results for everyone.
- **Chance.** Live Prop Sweat is built: ESPN NBA/NFL box scores feed `player_stats` and `wager_legs.live_stat`; SQL uses stat progress and clock with pregame fallback. Anytime TD includes rushing, receiving and return TDs. These display/probability updates cost no odds credits and do not auto-grade. ESPN is unofficial/non-commercial; replace the feed before monetizing.
- **Tests:** `08_player_props.test.sql` (32), mutation-checked. Removing the props switch and dropping the 48h refund each fail tests. Normalizer/fake-props units, props catalog units, and `e2e/props.spec.ts`.
- **Known gaps:**
  - The host can mistype a stat; there's no correction flow, since a result is entered once.
  - Prop availability depends on the book: some players or markets may be missing.

## Implementation notes: as built (installable web app, 2026-11-04)
- PWA, not an app-store app: `src/app/manifest.ts` (served at `/manifest.webmanifest`, standalone, portrait,
  current Ticket stub colors) + `appleWebApp` metadata in the root layout. Icons are generated by
  `node scripts/make-icons.mjs` (sharp) into `public/icons/` (192, 512, maskable 512, apple-touch 180) and
  `src/app/icon.png` (favicon). Re-run it if the logo mark changes.
- `src/components/install-hint.tsx` on home + lobby: iPhone Safari gets "Share → Add to Home Screen" copy,
  Chrome/Android gets an Install button (captured `beforeinstallprompt`). Hidden when already installed
  (standalone) or dismissed (localStorage `squadbets:install-dismissed`). Decision logic is pure:
  `src/lib/install.ts` (unit-tested). e2e: `e2e/install.spec.ts`.
- No service worker / offline yet: odds and picks must be live, so offline adds little for v1.

## Implementation notes: as built (football alternates, touchdowns, player teams, 2026-11-05)
- Catalog (migration 0011): NFL/NCAAF props add `player_{pass,rush,reception}_yds_alternate`, `player_pass_tds`,
  `player_anytime_td`. Shapes verified against a real TNF response: alternates are an Over-only ladder (many lines
  per player); anytime TD is one "Yes" price per player, no line (includes "Team D/ST").
- odds_cache key now includes `alt_point` (= point for `_alternate` markets only): ladders get one row per line,
  main markets stay one row per side (a moved line replaces the old price). Ladder lines the book drops are deleted
  on that market's next sync (wager_legs.odds_id → null; bets keep their own copy).
- Grading: one stat per (player, stat): `grade_prop` maps `_alternate` → main market, grades both, stores the main
  key. "Yes" hits when stat (touchdowns) ≥ 1. One-sided props' chance = their own implied price (no pair to de-vig).
- Player teams (migration 0012): the Odds API has no player→team, so odds-sync stores NFL rosters from Sleeper's
  public player list (`_shared/rosters.ts`, once/day via `rosters_due`, only during props syncs, 0 credits) in
  `public.player_teams`; `odds_board.participant_team` resolves each player to the home/away team OF THAT GAME
  (`private.name_key` ignores case/punctuation/Jr.), NULL if neither — never a guess. Board groups props by team.
  **Sleeper's API is free for NON-COMMERCIAL use only: swap in a licensed roster feed before monetizing.**

## Implementation notes: as built (same-game parlays, 2026-11-05)
- Migration 0013: `allowed_bet_types.same_game_parlays` (create/update keep it; absent = ON, so existing
  tournaments got SGPs). `place_wagers` gives each leg a slot (`event|market` for game lines,
  `event|stat|player` for props, ladders mapped to their stat) and raises `CONFLICTING_LEGS` on a repeat;
  with the switch off it still raises `SAME_EVENT_PARLAY`. Client mirror: `legSlot` / `parlayEligibility`.
- Known approximation: legs in one game are correlated (Henry 100+ yds and Henry TD), but pricing multiplies
  them like independent legs (sportsbooks shave SGP prices) and live P(cash) multiplies too. Fine for play
  money; revisit (e.g. an SGP haircut) if competitive play or money ever enters.

## Real-data pass (2026-11-05, TNF props copied locally)
- Nicknames: Odds API "Matthew Hibner" vs Sleeper "Matt Hibner". `private.initial_key` (first initial + last name)
  is a fallback used only when exactly ONE rostered player of the game's two teams fits (migration 0014).
- `private.player_team(event_id, name)` is the single source (migration 0015): `odds_board.participant_team` and the
  `wager_legs.participant_team` computed field. `selectionLabel` prints "Derrick Henry (Ravens) 50+ Rush Yds" on the
  board, slip, My picks and reveal.
- Props tabs wrap (short names, full aria-labels) instead of a hidden sideways scroll; ladders show lines priced
  within ±500 by default with "Show all N lines".
