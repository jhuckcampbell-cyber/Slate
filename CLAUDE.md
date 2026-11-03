# SquadBets

Mobile-first, play-money sports betting tournaments for friend groups. Hosts create a contest
tied to a game/slate, share `/join/CODE` by SMS, players build blind slips until lock, then
everyone sweats a live leaderboard.

Full architecture & roadmap: see `docs/ARCHITECTURE.md`.

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

Windows dev box: Docker Desktop must be running before `npx supabase start`. Stopping a
background `npm run start` leaves `next start` orphaned on :3000 (and it may not appear in
Get-NetTCPConnection): find it by command line and `taskkill /T /F`. Never rebuild under a running
`next start` — it serves stale chunk names (500s). Playwright refuses to reuse a server for this reason.

## Odds pipeline (Phase 2)
pg_cron (every min) → private.trigger_odds_sync() → pg_net → Edge Function odds-sync →
odds_sync_claim() [lease + due jobs] → provider → normalize (_shared) → odds_sync_ingest() [diff-upsert].
- ODDS_PROVIDER=fake locally (deterministic, drifts every 10 min, zero credits); prod:
  `npx supabase secrets set ODDS_PROVIDER=the-odds-api ODDS_API_KEY=... ODDS_SYNC_SECRET=...`
  plus Vault secrets `odds_sync_url` / `odds_sync_secret` (seed.sql sets local ones).
- Cadence AND bet freshness come from one SQL source: private.odds_refresh_interval / odds_max_age.
- odds_cache rows change only on real price moves (Realtime); market freshness lives in odds_markets.
- Clients read the `odds_board` view (DB-clock is_stale) + Realtime on odds_cache.

## Lock & reveal (Phase 3)
- Lock guards are TRIGGERS (migration 0006): after lock nothing can add/edit/delete a pick, move the lock,
  change the rules, or add a player, even code that bypasses the RPCs. Grading may only touch outcome
  columns (status, settled_at, win_probability, is_locked). If Phase 5 grading needs another column, widen
  the guard on purpose.
- pg_cron runs private.advance_statuses() every 10s: open → locked → live → settled.
- Realtime: private channel `tournament:<id>` (participants only; RLS on realtime.messages) carries
  SIGNALS, never data: `tournament` {status, lock_time}, `roster` {change, user_id}. Clients re-render
  via router.refresh() so RLS stays the only gate. Never put picks or bankrolls in a payload.
- Host RPC errors must never depend on hidden picks (the host could probe them through errors).
- Next 16 keeps visited routes mounted but hidden: in e2e, scope locators (e.g. getByRole("dialog")) when a
  label also exists on a previously visited page.

## Next.js 16 specifics (this is NOT older Next.js; see AGENTS.md + node_modules/next/dist/docs)
- Middleware is `src/proxy.ts` exporting `proxy()` (refreshes the Supabase session cookie).
- `params` / `searchParams` are Promises; use the global `PageProps<"/route">` / `LayoutProps` types.
- Cache Components is ON. Per-user pages = sync default export rendering
  `<Suspense fallback={<PageSkeleton/>}><Inner/></Suspense>`, and `Inner` starts with
  `await connection()` (auth cookies, the clock, and Supabase's getClaims are per-request).
- `notFound()` inside streamed content renders the segment's not-found UI but can't set a 404
  status. Test the UI, not the status code.
- Client inputs that matter before hydration (join flow) are UNCONTROLLED (`defaultValue` +
  FormData) so text typed on slow phones isn't wiped when React hydrates.
- shadcn here is the Base UI flavor: no `asChild`. For links styled as buttons use
  `className={cn(buttonVariants(), ...)}` on `<Link>`.

## Layout
src/app/                     routes (create/, join/[code]/, t/[code]/{page,slip,sweat}, auth/callback)
src/components/ui/           shadcn primitives (generated, don't hand-edit beyond theming)
src/components/<feature>/    slip/, odds/, leaderboard/, feed/
src/lib/core/                PURE TS, no deps: odds math, payouts, probability, invite codes.
                             Imported by both Next and Edge Functions; must stay runtime-agnostic.
src/lib/supabase/            client.ts (browser) · server.ts (RSC/actions) · proxy.ts (session refresh)
                             public.ts (cookie-less anon: share previews/OG) · queries.ts · types
src/lib/queries/             TanStack Query hooks + query keys
supabase/migrations/         SQL (source of truth for schema, RLS, RPCs)
supabase/functions/          Deno Edge Functions. Entrypoints (*/index.ts) are excluded from the Node
                             toolchain: add each new function dir to tsconfig "exclude".
supabase/functions/_shared/  PURE TS shared by functions (import with .ts extensions); Vitest-tested
src/components/sportsbook/   board (event cards), slip store + drawer, my picks
src/components/tournament/   lobby pieces: countdown, live channel, squad list, host tools
src/components/reveal/       post-lock reveal (consensus by game, slips by player)
tests/integration/           Vitest against the local stack (concurrency, Realtime channel auth)
supabase/tests/              pgTAP: every RLS policy and RPC has tests

## Non-negotiable rules
1. Blind picks are enforced in the DATABASE (RLS + security-definer RPCs), never only in UI.
   Any new table/view/function touching wagers or bankrolls needs a pgTAP test proving a
   co-participant cannot read it before lock_time.
2. Clients never write wagers/participants directly. All mutations go through RPCs
   (create_tournament, join_tournament, place_wagers, cancel_wager, replace_wager, update_tournament,
   lock_tournament_now, remove_participant). Players have
   no INSERT/UPDATE/DELETE grants on those tables at all.
3. Never trust client odds or amounts: place_wagers re-reads odds_cache server-side and rejects
   with ODDS_CHANGED (new prices in `details`) on any move; the slip shows "Accept new odds".
   Client-side payout previews must use src/lib/core/odds.ts (mirrors the SQL rounding exactly).
4. Money = integer cents (`*_cents`). Odds stored as American int + decimal numeric(10,4).
5. All times are timestamptz/UTC; compare against DB `now()`, never client clocks.
6. The Odds API is called ONLY from Edge Functions with the secret key. Clients read odds_cache.
7. Security-definer functions: `set search_path = ''`, fully qualified names, live in schema
   `private` unless meant to be exposed as RPC; revoke execute from public/anon by default.
8. Service-role key is server-only (never `NEXT_PUBLIC_`).
9. Regenerate DB types after every migration; never hand-edit database.types.ts.
   RPCs raise stable UPPER_SNAKE error codes; map them to copy in src/lib/errors.ts.
10. Mobile-first: design at 375px, tap targets ≥44px, bottom-sheet slip.

## v1 product defaults
- Tournament-wide lock_time (defaults to earliest kickoff). Per-game locks are v2.
- Player props are graded manually by the host in v1 (Odds API has no player stats).
- One leg per event in a parlay (keeps win-probability independence assumption valid).
- Min stake $1; parlay payout capped at 1000-to-1 (decimal 1001); money columns are bigint cents.
- Unwagered bankroll counts toward final score; host may set min_total_wager.

## Glossary
Lock = moment picks freeze and become visible (tournaments.lock_time). Reveal = post-lock visibility.
Sweat = live tracking phase. P(cash) = de-vigged implied probability a pending wager wins.
