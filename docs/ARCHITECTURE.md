# SquadBets — Architecture Plan (for approval before Phase 1 code)

## Context
Greenfield project (`c:\Users\huckc\projects\BetvsFriends` is empty, not a git repo). We're building a mobile-first, play-money betting tournament app for friend groups. Core risk areas: (1) **blind picks**, where picks must be unreadable by other players until lock, enforced in Postgres rather than the UI; (2) **odds API credit budget**; (3) a **<15s join flow** from an SMS link. This plan covers the four deliverables you asked for: the CLAUDE.md content, the schema with RLS, the odds strategy, and the phased roadmap. Nothing gets written to the repo until you approve. Step 1 after approval is `git init` plus writing the CLAUDE.md below.

### Defaults I chose (override any of these when you approve)
| Decision | Default | Why |
|---|---|---|
| Lock granularity | **Tournament-wide** `lock_time` (defaults to earliest kickoff in the slate) | Matches your spec. Per-game locks for Sunday slates can come in v2 (the `tournament_events` table already supports them). |
| Player-prop grading | **Host manually grades props** in v1. Auto-grading comes later. | The Odds API supplies prop *odds* but no player *stats*. Auto-grading needs a second provider. |
| Odds source | Single primary book (env `ODDS_PRIMARY_BOOK`, e.g. `draftkings`) with a fallback list | Lines stay predictable and cost stays at 1 region. |
| Cache layer | **Postgres is the cache.** No Redis in v1. | At friend-group scale, a table plus Realtime is enough. Upstash can be added later if read load ever needs it. |
| Scheduler | `pg_cron` + `pg_net` → Supabase Edge Functions | Vercel Hobby crons only run daily. |
| Unwagered money | Counts toward your final score. Host can set `min_total_wager`. | This is the common format for these contests. |
| Same-game legs in a parlay | Disallowed in v1 (one leg per event) | Correlated legs would break the independence math in win probability. |
| Money | Integer **cents** everywhere | No floating-point drift. |

---

## 1. CLAUDE.md (written to repo root after approval)

```markdown
# SquadBets

Mobile-first, play-money sports betting tournaments for friend groups. Hosts create a contest
tied to a game/slate, share `/join/CODE` by SMS, players build blind slips until lock, then
everyone sweats a live leaderboard.

## Stack
Next.js (latest stable, App Router, RSC) · TypeScript strict · Tailwind v4 · shadcn/ui · lucide-react
Supabase (Postgres, Auth incl. anonymous sign-ins, RLS, Realtime, Edge Functions, pg_cron)
TanStack Query v5 · Zod · The Odds API v4 · Vercel (+ next/og for share images)
Tests: Vitest (pure logic) · pgTAP via `supabase test db` (RLS/RPC) · Playwright (e2e, mobile viewport)

## Commands
pnpm dev                     # Next dev server
supabase start               # local Postgres/Auth/Realtime (Docker)
supabase db reset            # re-apply migrations + seed.sql
supabase migration new <name>
pnpm db:types                # supabase gen types typescript --local > src/lib/supabase/database.types.ts
pnpm test                    # vitest
pnpm test:db                 # supabase test db (pgTAP in supabase/tests)
pnpm e2e                     # playwright
pnpm lint && pnpm typecheck

## Layout
src/app/                     routes (create/, join/[code]/, t/[code]/{page,slip,sweat}, auth/callback)
src/components/ui/           shadcn primitives (generated, don't hand-edit beyond theming)
src/components/<feature>/    slip/, odds/, leaderboard/, feed/
src/lib/core/                PURE TS, no deps: odds math, payouts, probability, invite codes.
                             Imported by both Next and Edge Functions; must stay runtime-agnostic.
src/lib/supabase/            browser/server/middleware clients + generated types
src/lib/queries/             TanStack Query hooks + query keys
supabase/migrations/         SQL (source of truth for schema, RLS, RPCs)
supabase/functions/          odds-sync, scores-sync, grade (Deno)
supabase/tests/              pgTAP: every RLS policy and RPC has tests

## Non-negotiable rules
1. Blind picks are enforced in the DATABASE (RLS + security-definer RPCs), never only in UI.
   Any new table/view/function touching wagers or bankrolls needs a pgTAP test proving a
   co-participant cannot read it before lock_time.
2. Clients never write wagers/participants directly. All mutations go through RPCs
   (create_tournament, join_tournament, place_wager, cancel_wager). No INSERT/UPDATE/DELETE
   policies exist on those tables.
3. Never trust client odds or amounts: place_wager re-reads odds_cache server-side and rejects
   on price change (client shows "odds changed, accept?").
4. Money = integer cents (`*_cents`). Odds stored as American int + decimal numeric(10,4).
5. All times are timestamptz/UTC; compare against DB `now()`, never client clocks.
6. The Odds API is called ONLY from Edge Functions with the secret key. Clients read odds_cache.
7. Security-definer functions: `set search_path = ''`, fully qualified names, live in schema
   `private` unless meant to be exposed as RPC; revoke execute from public/anon by default.
8. Service-role key is server-only (never `NEXT_PUBLIC_`).
9. Regenerate DB types after every migration; never hand-edit database.types.ts.
10. Mobile-first: design at 375px, tap targets ≥44px, bottom-sheet slip.

## Glossary
Lock = moment picks freeze and become visible (tournaments.lock_time). Reveal = post-lock visibility.
Sweat = live tracking phase. P(cash) = de-vigged implied probability a pending wager wins.
```

---

## 2. Database Schema & RLS (`supabase/migrations/0001_core.sql` … `0004_rpc.sql`)

### Tables (abridged DDL)
```sql
create schema if not exists private;
create extension if not exists pg_cron; create extension if not exists pg_net;

create type tournament_status as enum ('draft','open','locked','live','settled');
create type wager_type   as enum ('single','parlay');
create type wager_status as enum ('pending','won','lost','pushed','void');
create type leg_status   as enum ('pending','hit','miss','push','void');

-- "users": auth.users holds phone/email (PII stays out of public); profile is public-facing
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar_url text,
  is_guest boolean not null default true,          -- flips false when anon user links email/phone
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (                        -- canonical games (from Odds API)
  id text primary key,                              -- provider event id
  sport_key text not null,                          -- americanfootball_nfl, basketball_nba
  home_team text not null, away_team text not null,
  commence_time timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','final','postponed','canceled')),
  home_score int, away_score int,
  scores_synced_at timestamptz
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles,
  title text not null check (char_length(title) <= 60),
  description text,
  code text not null unique check (code ~ '^[A-Z0-9]{2,5}-[2-9A-HJ-KMNP-TV-Z]{4}$'),  -- e.g. TNF-8X29
  sport_key text not null,
  starting_bankroll_cents int not null default 10000 check (starting_bankroll_cents > 0),
  max_bet_cents int check (max_bet_cents > 0),      -- null = up to bankroll
  min_total_wager_cents int not null default 0,
  allowed_bet_types jsonb not null default
    '{"markets":["h2h","spreads","totals"],"parlays":true,"max_parlay_legs":6,"player_props":false}',
  lock_time timestamptz not null,
  status tournament_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tournament_events (
  tournament_id uuid references public.tournaments on delete cascade,
  event_id text references public.events,
  primary key (tournament_id, event_id)
);

create table public.tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  remaining_bankroll_cents int not null check (remaining_bankroll_cents >= 0),
  total_potential_payout_cents int not null default 0,   -- sum over pending wagers
  expected_value_cents int,                               -- live EV (Phase 4)
  rank int,
  joined_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);

create table public.odds_cache (                      -- one row per priced outcome
  id bigint generated always as identity primary key,
  event_id text not null references public.events,
  bookmaker text not null,
  market_key text not null,                         -- h2h|spreads|totals|player_pass_yds|...
  outcome_name text not null,                       -- team | Over | Under
  participant_name text not null default '',        -- player for props
  point numeric(6,1),                               -- spread/total/prop line
  price_american int not null,
  price_decimal numeric(10,4) not null,
  is_live boolean not null default false,
  fetched_at timestamptz not null,
  locked_at timestamptz,                            -- set at event start: closing-line snapshot
  unique (event_id, bookmaker, market_key, outcome_name, participant_name)
);

create table public.wagers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  participant_id uuid not null references public.tournament_participants on delete cascade,
  wager_type wager_type not null,
  amount_cents int not null check (amount_cents > 0),
  odds_american int not null, odds_decimal numeric(10,4) not null,
  potential_payout_cents int not null,
  status wager_status not null default 'pending',
  is_locked boolean not null default false,         -- denormalized flag; RLS does NOT rely on it
  win_probability numeric(5,4),                     -- live P(cash), Phase 4
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table public.wager_legs (
  id uuid primary key default gen_random_uuid(),
  wager_id uuid not null references public.wagers on delete cascade,
  tournament_id uuid not null,                      -- denormalized for cheap RLS
  event_id text not null references public.events,
  market_key text not null,
  selection text not null,                          -- outcome_name
  participant_name text not null default '',
  line numeric(6,1),                                -- target stat/line
  odds_american int not null, odds_decimal numeric(10,4) not null,
  status leg_status not null default 'pending',
  win_probability numeric(5,4),
  settled_at timestamptz
);

create table public.feed_items (                    -- Phase 4 trash talk + reactions
  id bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments on delete cascade,
  user_id uuid not null references public.profiles,
  kind text not null check (kind in ('message','reaction','system')),
  body text check (char_length(body) <= 280),
  target_wager_id uuid references public.wagers on delete cascade,
  created_at timestamptz not null default now()
);

create table private.api_usage (                    -- Odds API budget tracking
  id bigint generated always as identity primary key,
  endpoint text, credits_used int, credits_remaining int, called_at timestamptz default now()
);
-- + indexes on every FK, wagers(participant_id), wager_legs(event_id, status), odds_cache(event_id)
```

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

### RLS policies (enabled on every public table; `force row level security` on wagers/legs/participants)
| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| profiles | own row, or `shares_tournament(id)` | UPDATE own row only (display_name, avatar) |
| tournaments | host or `is_participant(id)` | none (RPC). Host edits go through `update_tournament` RPC, which rejects changes once locked and rejects bankroll changes after anyone has joined. |
| tournament_events | `is_participant(tournament_id)` | none (RPC) |
| tournament_participants | **own row**, or `is_participant(tid) AND is_revealed(tid)` | none (RPC) |
| wagers | **`owns_participant(participant_id)`**, or `is_participant(tid) AND is_revealed(tid)` | **none.** Only `place_wager` / `cancel_wager` write. |
| wager_legs | same predicate as wagers, using the denormalized `tournament_id` + join to the owner | none |
| events, odds_cache | `authenticated` (includes anonymous guests) | service_role only |
| feed_items | `is_participant(tid)`; reactions on wagers only allowed once revealed | INSERT where `user_id = auth.uid() and is_participant(tid)` |

Bankroll is hidden too. `remaining_bankroll_cents` pre-lock would leak how much someone bet, so participant rows are also blind. For the pre-lock lobby, `get_roster(tid)` (security definer, participant-only) returns just `display_name, avatar, joined_at, has_submitted boolean`, which is enough for "5/8 locked in" social pressure without leaking the picks.

The public share preview `get_tournament_preview(code)` is granted to `anon` and returns only title, host name, sport, matchup, lock_time, participant count, and bankroll. It powers the OG image and the join page.

### RPCs (security definer, `set search_path = ''`)
- **`create_tournament(title, description, sport_key, event_ids[], bankroll, max_bet, allowed, lock_time?)`** → `code`. Generates the code as prefix (from title, e.g. TNF) + 4 Crockford chars, with retry on collision. Defaults `lock_time` to `min(commence_time)`. Auto-joins the host.
- **`join_tournament(code)`** → participant row. Rejects if revealed. Idempotent.
- **`place_wager(tid, amount_cents, legs jsonb)`**. All of these checks happen in one transaction:
  - lock the participant row with `SELECT … FOR UPDATE`
  - require `now() < lock_time` and every leg's event `commence_time > now()`
  - check each market against `allowed_bet_types` and the leg count against `max_parlay_legs`; reject duplicate events
  - re-read every price from `odds_cache`. Reject with `ODDS_CHANGED` (returning the new prices) if any price or point differs from the client's `expected_price`. Reject `ODDS_STALE` if `fetched_at` is older than the freshness window.
  - compute decimal odds (product of legs) and payout `floor(amount × decimal)`
  - enforce `amount ≤ max_bet` and `amount ≤ remaining_bankroll`
  - debit the bankroll, add to potential payout, insert the wager and its legs
- **`cancel_wager(wager_id)`**: pre-lock only, refunds. "Editing a pick" = cancel + place, done atomically client-side via a single `replace_wager` RPC.
- **Service-only** (revoked from authenticated): `private.advance_statuses()`, `private.grade_event(event_id)`, `private.recompute_leaderboard(tid)`.

### Lock/reveal mechanics
- RLS uses `lock_time <= now()`, so picks are revealed **at the exact second** with no dependence on a job running.
- `pg_cron` runs `private.advance_statuses()` every minute. It moves open→locked (sets `wagers.is_locked`), locked→live (first event live), and live→settled (all wagers graded). The status trigger broadcasts `{type:'revealed'}` on Realtime channel `tournament:<id>`. Clients also set a local timer to `lock_time` and refetch, belt and suspenders.
- A trigger blocks moving `lock_time` later once it has passed, and blocks any wager write after lock, even from RPC bugs.

### RLS test matrix (pgTAP, `supabase/tests/rls_blind_picks.test.sql`)
Users A, B, and outsider C:
1. Before lock, B sees 0 of A's wagers, legs, and bankroll.
2. C sees nothing at any time.
3. A sees their own.
4. After lock (simulated by setting `lock_time = now() - 1s`), B sees A's.
5. A direct `insert into wagers` fails for everyone.
6. `place_wager` fails after lock, over bankroll, over max bet, on a disallowed market, or on a stale/changed price.
7. Concurrent `place_wager` calls cannot overdraw the bankroll.

---

## 3. Odds Ingestion & Caching Strategy

**Principle:** fetch only what active tournaments need, at a cadence tied to time-to-kickoff. Write only changed prices, so Realtime traffic equals actual line movement.

**Pipeline:**
1. `pg_cron` runs every minute and calls Edge Function `odds-sync` via `pg_net`.
2. `odds-sync` takes `pg_try_advisory_lock`, which gives single-flight execution (no double spend if invocations overlap).
3. It computes a due-list from tournaments in `open`/`locked`/`live` and their events.
4. It calls The Odds API, normalizes the response, and upserts into `odds_cache` only when price or point changed.
5. It updates `events` and logs `x-requests-remaining` to `private.api_usage`.

**Cadence tiers (per sport, since one `/v4/sports/{sport}/odds` call covers every game in a sport):**
| Window | Interval | Markets |
|---|---|---|
| Catalog (creating tournaments) | every 6h, plus on-demand when a host opens "create" if the catalog is older than 1h | h2h only, used to list upcoming games |
| > 24h to kickoff | 3h | h2h, spreads, totals |
| 1–24h | 20 min | same |
| < 1h | 3 min | same |
| Live, only events with pending wagers | 60s | h2h (+ spreads/totals if any pending leg needs them) |
| Player props | per event via `/events/{id}/odds`, only if a tournament enables props: 1h pre-game, 10 min in the last hour, none live in v1 | the requested prop markets only |

**Budget example.** NFL Sunday with 1 region and 3 markets costs about 3 credits per call:
- pregame: ~150 credits/day
- live: 4 windows × ~3.5h × 60 calls/h × 1 market ≈ 840
- scores (60s while live, 1–2 credits each): ~400

That is roughly 1.5k credits per Sunday, so the $30/20k tier covers a season of weekly use (verify current pricing at build time).

**Circuit breaker.** If `credits_remaining` drops below 20% of the monthly allotment, intervals double. Below 5%, live polling stops: the leaderboard falls back to pregame probabilities and an admin alert fires.

**Client side.**
- Server components render the initial odds.
- TanStack Query keys `['odds', eventId]` with `staleTime: 30s`.
- A single Realtime `postgres_changes` subscription on `odds_cache` filtered by `event_id=in.(…)` patches the query cache.
- Price-movement flash animation (green up, red down).
- Odds older than the freshness window show a "stale" badge and their buttons are disabled.

**Bet acceptance.**
- Freshness window: 10 min when kickoff is more than 1h away, 4 min inside the last hour.
- If the price changed, the slip shows "Odds changed: −110 → −115. Accept?" and resubmits.

**Closing line.** At `commence_time` the sync sets `odds_cache.locked_at` on pregame rows. Those rows are then frozen as the closing line, which allows CLV stats later. Live prices go in separate `is_live=true` rows, so they never overwrite pregame rows.

**Scores.** `scores-sync` runs every 60s while any tracked event is live, using `/v4/sports/{sport}/scores`. When an event becomes `final` it calls `private.grade_event`.

---

## 4. Win Probability & Grading Math (`src/lib/core/`, pure TS, Vitest-covered)
- **Implied probability:** `+A → 100/(A+100)`, `−A → |A|/(|A|+100)`. Remove the vig by normalizing across a market's outcomes.
- **Single bet P(cash):**
  - Moneyline: the de-vigged live probability.
  - Spread/total, when the live line differs from the bet line: normal model. Infer the mean margin from the live line, use σ = sport σ × √(fraction of game remaining), then compute `P(margin > −bet_line)`.
  - If no live market is available, fall back to the last known value, then to the pregame value.
- **Parlay P(cash):** product over pending legs. A hit leg = 1, a miss = 0 (dead), a push is removed. Leg-by-leg status and probability are shown in the UI.
- **Grading:**
  - Leg results are hit/miss/push by market (spread push on exact integer lines).
  - A won single pays `amount × decimal`. A push refunds the stake.
  - A parlay pushes its push legs out of the odds (decimal recomputed without them). A void parlay refunds the stake.
  - The participant is credited the payout.
- **Leaderboard per participant:**
  - `cash` = remaining bankroll, including credited payouts
  - `max` = cash + Σ pending payouts
  - `EV` = cash + Σ P(cash) × payout
  - Rank by cash, then EV.
  - Status is **Busted** (max = 0), **Eliminated** (max < leader's cash), or **Alive**.
  - `recompute_leaderboard` writes these onto participant rows, and Realtime pushes them to clients.

---

## 5. Milestone Roadmap

### Phase 0: Scaffold (half a day)
- `git init`, then `create-next-app` (TS, Tailwind, App Router, `src/`), then `shadcn init`
- `supabase init`, ESLint/Prettier, Vitest/Playwright config, CLAUDE.md, `.env.example`
- Vercel project linked to a Supabase project, plus a CI workflow (lint, typecheck, vitest, `supabase test db`)

### Phase 1: Auth, tournament creation, invite link & SMS preview
- Migrations 0001–0002: profiles, events, tournaments, tournament_events, participants, helpers, RLS, `create_tournament`, `join_tournament`, `get_tournament_preview`, `get_roster`.
- Auth:
  - Supabase anonymous sign-in (with Turnstile captcha) for guests
  - magic link and SMS OTP (Twilio) as alternatives
  - "Claim account" uses `linkIdentity` / `updateUser({email|phone})` and flips `is_guest`
- Auth plumbing: middleware session refresh plus a profile auto-create trigger on `auth.users` insert.
- `/create` is a 3-step mobile wizard (pick game(s) from the catalog, then rules, then share). The catalog is seeded from a one-off Odds API h2h fetch.
- `/join/[code]` flow: open link, then anonymous sign-in, then enter a display name, then join. This is one screen and is measured to be under 15s.
- `/join/[code]/opengraph-image.tsx` (next/og) renders a matchup card with title, lock time, and player count. `generateMetadata` provides og/twitter tags. The share button uses `navigator.share`, falling back to `sms:?&body=`.
- `/t/[code]` lobby: rules, countdown to lock, and the roster.
- **Exit criteria:**
  - pgTAP passes for participant/tournament RLS
  - Playwright covers create → share → join on a 375px viewport
  - the OG preview is verified on a real iMessage

### Phase 2: Odds ingestion, slip builder & bankroll validation
- Migration 0003: odds_cache, wagers, wager_legs, api_usage, `place_wager`, `cancel_wager`, `replace_wager`.
- Edge Function `odds-sync` with tiered cadence, single-flight lock, diff-upsert, and budget breaker. `pg_cron` schedule.
- `src/lib/core/odds.ts` (conversions, parlay pricing, payout) with exhaustive Vitest tests.
- Sportsbook UI: game cards with ML/Spread/Total buttons, a props tab gated by rules, and a bottom-sheet slip (singles vs parlay toggle, stake keypad, live bankroll remaining, max-bet hints). Optimistic slip state uses TanStack Query mutations with server-error rollback, and handles `ODDS_CHANGED`.
- **Exit criteria:**
  - concurrency test: parallel `place_wager` calls can't overdraw the bankroll
  - stale and changed odds paths are covered
  - credit usage is logged

### Phase 3: Blind lock & live reveal
- Migration 0004: `is_revealed`-based policies on wagers and legs, a lock-enforcement trigger, `advance_statuses` cron, and a reveal broadcast.
- "My picks" view pre-lock. Lobby shows "X/Y submitted" through `get_roster`.
- Reveal moment: lock countdown, then a refetch on the broadcast or timer, then an animated "Picks are in" grid of everyone's slips grouped by game, plus a consensus view (e.g. "6 of 8 on KC −3").
- Host controls before lock: edit rules, push `lock_time` earlier, remove a player.
- **Exit criteria:**
  - the full pgTAP blind-pick matrix (section 2) is green
  - a manual two-browser test shows nothing leaks before lock via the network tab, Realtime, or the roster

### Design foundation (done 2026-11-03)
"Night game" visual identity and design system; see `docs/DESIGN.md`. Order agreed with the user: design foundation → Phase 4 → Phase 5 → closed beta (3–5 friend groups; success = a group starts a second tournament).

### Phase 4: Real odds, safely (re-scoped 2026-11-03 at the user's request)
Goal: the most basic integration with The Odds API that can't leak the key, can't overspend, and degrades to "odds unavailable" instead of breaking. Scope is set at the start of the phase; the starting points are:
- The key exists only as an Edge Function secret (rule 6) and is never logged; local dev and CI keep using the fake provider.
- A hard credit budget enforced in the database (refuse to call, not just slow down) sized to the plan the user picks (the free tier is 500 credits/month), plus the existing breaker.
- Minimum-cost fetching: one region, one book, only markets and games that open tournaments need, no live odds.
- A one-command dry run against the real API (one call, credits reported) before the cron is switched on.

### Phase 5: Live grading, win probability, realtime leaderboard
- `scores-sync` and `grade_event` (core markets automated); a host prop-grading UI.
- `src/lib/core/probability.ts`: de-vig, normal-model spread/total, parlay product. Live odds polling for events with pending wagers.
- `recompute_leaderboard` after each odds/scores sync, then Realtime on participants and wagers.
- Sweat screen:
  - leaderboard with cash, EV, and max, plus status bars for Alive, Eliminated, and Busted
  - per-wager P(cash) gauge
  - parlay leg tracker (✓ / ✗ / live %)
- Feed: messages, emoji reactions on revealed wagers, and system posts ("Mike's 4-leg parlay just died 💀").
- Settlement: final standings card with a shareable OG image.
- **Exit criteria:**
  - replay test: feed recorded odds and scores fixtures through grading and verify the final standings
  - probability math matches hand-computed cases

---

## Verification (applies to every phase)
- `supabase db reset && pnpm test:db`: RLS/RPC pgTAP suite. The blind-pick tests are the gate for merging.
- `pnpm test`: core math, code generation, payout and grading cases.
- `pnpm e2e`: Playwright on an iPhone viewport, with a multi-context test (two users) for blind and reveal.
- Odds sync dry-run mode (`ODDS_SYNC_DRY_RUN=1`) reads recorded fixtures from `supabase/functions/_fixtures`, so dev doesn't burn credits.
- Manual: real SMS share to iMessage and Android for previews, and a two-phone sweat test during a live game.

---

## Implementation notes: as built (Phase 0–1, 2026-11-03)
Deviations from the plan above, and why:
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
- **Local game catalog comes from `supabase/seed.sql`**, with games relative to `now()`, instead of a one-off Odds API fetch. Real ingestion arrives with odds-sync in Phase 2.
- **Join flow signs guests in from the browser,** not a server action. Supabase's anonymous sign-in limit is per IP, and a server action would make every signup come from the server's IP.

**Phase 1 items still open:**
- SMS OTP. Email magic link is done. SMS needs Twilio credentials in Supabase Auth.
- Turnstile captcha on anonymous sign-ins. Needs Cloudflare keys.
- Linking a Vercel project.
- Checking the OG preview on a real iMessage/Android device. Needs a public deploy.

## Implementation notes: as built (Phase 2, 2026-11-03)
**Deviations from the plan, and why:**
- **One batch RPC, `place_wagers(tournament, slip)`, instead of `place_wager`.** A slip of N singles or one parlay books all-or-nothing in a single transaction. `ODDS_CHANGED` reports every moved line at once, with the new prices in `details`.
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
- **Player props → Phase 5**, alongside host grading. Props are ungradeable before that, so taking prop bets now would create bets that can't be settled. The data model, normalizer and slip already handle `participant_name`.
- **No edit UI for placed bets yet.** `replace_wager` (atomic cancel + re-place) exists and is tested; the UI offers cancel and re-add.
- **`min_total_wager` isn't enforced** (no lock-time rule yet), and the slip doesn't survive a page refresh.

## Implementation notes: as built (Phase 3, 2026-11-03)
Migration `20261103000006_lock_reveal.sql`, pgTAP `04_lock_reveal.test.sql` (64 tests), integration `tests/integration/realtime.test.ts`, e2e `e2e/reveal.spec.ts`.

**Built:**
- **Lock guards (triggers).** Once `lock_time` passes (by `clock_timestamp()`, so a slip whose transaction straddles the lock is refused) or the status leaves draft/open: no wager/leg insert, no change except outcome columns (`status`, `is_locked`, `win_probability`, `settled_at`; legs also `odds_id`), and no delete except cascades from a deleted participant, account or tournament. The tournament's lock time and money rules freeze, status only moves forward, and nobody new can join. `pull_lock_forward` never touches a lock that already passed.
- **Status machine.** `private.advance_statuses()` runs every **10 seconds** under pg_cron: open → locked at `lock_time`, locked → live at first kickoff, live → settled once every game is final and every wager graded (so never, until Phase 5 grading). Locking flips `wagers.is_locked`. There's a daily cleanup of `cron.job_run_details`.
- **Signals, not data.** One private Realtime channel per tournament, `tournament:<id>`, fed by `realtime.send` from triggers. `tournament` events carry `{status, lock_time}`; `roster` events carry `{change, user_id}` on join/leave and only when a player's "picks in" flag flips (later bets stay silent). RLS on `realtime.messages` admits participants only. There's no INSERT policy, so clients can't publish. Lobbies respond by re-rendering server components, so RLS stays the only gate on what's visible.
- **Missed signals are covered three ways.** A catch-up refresh on every channel (re)join, a refresh when the tab becomes visible, and a 20s poll of `tournaments.updated_at`. An e2e run with Realtime disabled still reveals on time via the countdown and the poll.
- **DB-clock countdown.** The `server_now` computed field plus `createServerClock` mean a phone with a wrong clock still flips at the real lock moment.
- **Host controls.** `update_tournament(id, changes jsonb)` edits title/description, lock time (any time in (now, first kickoff]), max bet, and bet types. Bankroll can change only while the host is alone with no bets. `lock_tournament_now(id)` and `remove_participant(id, user_id)` complete the set. A removed player is recorded in `private.tournament_removals`, and `join_tournament` refuses them with `REMOVED_BY_HOST`. Rule edits apply to new bets only, and no host error depends on hidden picks (lowering the max bet below a hidden bet succeeds), so the host can't probe picks through errors.
- **Reveal UI.** A one-time "Picks are in!" moment per device, then a **By game** consensus view (`src/lib/core/consensus.ts`: distinct players per side, most common line, "Split 1–1" / "Everyone's on X" / "n of m on X") and a **By player** view with every slip, amount risked, potential win, and unbet bankroll.

**Deviations:**
- The reveal is a section of `/t/[code]` rather than a separate route; the lobby swaps the sportsbook for the reveal at lock.
- Reveal data comes from plain RLS selects, not a security-definer RPC, so the blind-pick policies stay the single gate.
- `join_tournament` now reads the tournament `FOR SHARE`, so a join can't interleave with a bankroll edit or an early lock.

**Known gaps:**
- **Intermittent missed broadcasts.** In 1 of ~40 e2e runs a lobby received neither Realtime signal, even after the catch-up refresh. The suspected cause, unconfirmed, is the channel never joining right after the guest sign-in. The 20s poll bounds the impact; the root cause isn't confirmed.
- **No un-remove.** A removed player can rejoin only with a different account (a guest can clear cookies).

## Implementation notes: as built (Phase 4, 2026-11-03)
Plan: The Odds API **free tier** (500 credits/month). Migration 0007 (`odds_budget`).

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

**Scores.** odds-sync has a third job kind, `scores`, due every `scores_refresh` (15 min) per sport while a game in a locked or live tournament is under way. A game counts as under way from kickoff until 12h after it, unless it's already final. Real calls use `/scores?daysFrom=1`, which costs 2 credits and includes games that just finished, and they go through the same `odds_budget_reserve`/`settle` path. The fake provider (`_shared/scores.ts`) reveals a hashed final score linearly over the sport's game length. `scores_ingest` writes events (`live`, then `final`). A final is final: re-sends and later corrections are ignored, so nothing can pay twice. Changed games send a `scores` signal on each sweating tournament's channel.

**Grading.**
- In the same transaction as the final, `grade_event` grades pending legs. Push rules: moneyline pushes on a tie, and spreads and totals push on an exact line.
- `settle_wager` then settles every wager it decides:
  - any miss → lost;
  - all legs push or void → pushed (stake refunded);
  - otherwise won at the stake × the product of the live legs, rounded the same way as `place_wagers` (4dp, capped at 1001, floor).
- It credits `remaining_bankroll_cents`, and `wagers.payout_cents` records the credited return.
- The lock guard was widened on purpose to allow `payout_cents`.
- `advance_statuses` voids legs on games with no final 12h after kickoff, or that are postponed or canceled. It settles a tournament when no wager is pending and every game is final, void or stale.

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
- rank by EV, then cash;
- standing: `busted` (max = 0), `eliminated` (max < the best cash), otherwise `alive`.

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

**Deferred (not built):** chat/feed and reactions, host grading of player props (props aren't offered yet), the shareable final-standings OG image, and live in-game odds (too costly for the free tier).

**Known gaps:**
- Stat corrections after a final are ignored.
- "Live" before the cron flips the status shows the tournament status as "Locked" for up to 10s.
- Wall-clock game length is a rough proxy for game time; the scores endpoint doesn't give the clock.

## Beta prep (2026-11-04, while the beta itself waits on deploy + keys)
- **Metric.** `public.beta_metrics()` (service role; `npm run metrics`) measures the feasibility test: **repeat rate**, the share of finished tournaments where 2+ of the same players appear in a tournament created after its lock. It also reports created and finished tournaments, distinct players, average players per tournament, and wagers. `07_beta_metrics.test.sql` covers it; lowering the threshold to 1 shared player fails the test.
- **Nudge.** The final standings end with a "Run it back" CTA (→ `/create`), the screen's one volt button.
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
    - football: passing, rushing, receiving yards;
    - other sports: none.
  - `place_wagers` accepts those markets only when the flag is on.
- **Odds.** One `props` job per game (props live on the per-event endpoint `/sports/{s}/events/{id}/odds`). It costs prop markets × regions (≈3 credits per refresh) and is reserved through the same budget. It runs on its own clock (`private.props_sync_state`), never the sport's game-line clock, with the same cadence tiers.
  - The parser keeps only players priced on both sides at the same line.
  - The fake provider prices made-up players (never real names) on .5 lines.
- **Board.** A collapsible "Player props" panel per game, with market tabs and Over/Under buttons. Labels read like "Jayson Tatum Over 27.5 Pts".
- **Grading** (the API has no player stats). After the final, the host calls `grade_prop(tournament, game, market, player, stat)`.
  - The stat is entered once per line and grades every pending pick on it the same way: over/under/push on each pick's own line.
  - It's stored in `public.prop_results`, which the squad can read, so the host can't quietly fudge a result.
  - Errors: NOT_HOST, INVALID_STAT, GAME_NOT_FINAL, ALREADY_GRADED, NOTHING_TO_GRADE.
  - Props nobody grades are voided (refunded) 48h after kickoff, so tournaments always finish.
  - UI: `PropsDesk` gives the host stat inputs, shows players what's still waiting on the host, and lists entered results for everyone.
- **Chance.** A pending prop uses the de-vigged current Over/Under pair at the bet's line, falling back to the bet's own price. There's no live model; stats aren't available.
- **Tests:** `08_player_props.test.sql` (32), mutation-checked. Removing the props switch and dropping the 48h refund each fail tests. Normalizer/fake-props units, props catalog units, and `e2e/props.spec.ts`.
- **Known gaps:**
  - The host can mistype a stat; there's no correction flow, since a result is entered once.
  - Prop availability depends on the book: some players or markets may be missing.

## Implementation notes: as built (installable web app, 2026-11-04)
- PWA, not an app-store app: `src/app/manifest.ts` (served at `/manifest.webmanifest`, standalone, portrait,
  night-game colors) + `appleWebApp` metadata in the root layout. Icons are generated by
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
