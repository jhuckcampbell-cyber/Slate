# SquadBets

Mobile-first, play-money sports betting tournaments for friend groups. Hosts create a contest
tied to a game/slate, share `/join/CODE` by SMS, players build blind slips until lock, then
everyone sweats a live leaderboard.

Full architecture & roadmap: see `docs/ARCHITECTURE.md`. Design system: `docs/DESIGN.md`.

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
- Credit budget (Phase 4, migration 0007): every PAID call must `odds_budget_reserve` first and
  `odds_budget_settle` after. The DB refuses when the paid switch is off (default), the monthly cap (400 of
  the free tier's 500) would be passed, or the provider's counter is low. Never add a paid call that skips it.
  Operate with `npm run odds -- status|dry-run|sync|enable|disable`. Cadence tiers live in app_settings.

## Lock & reveal (Phase 3)
- Lock guards are TRIGGERS (migration 0006): after lock nothing can add/edit/delete a pick, move the lock,
  change the rules, or add a player, even code that bypasses the RPCs. Grading may only touch outcome
  columns (status, settled_at, win_probability, is_locked, payout_cents). Widen the guard on purpose if
  grading ever needs another column.
- pg_cron runs private.advance_statuses() every 10s: open → locked → live → settled.
- Realtime: private channel `tournament:<id>` (participants only; RLS on realtime.messages) carries
  SIGNALS, never data: `tournament` {status, lock_time}, `roster` {change, user_id}. Clients re-render
  via router.refresh() so RLS stays the only gate. Never put picks or bankrolls in a payload.
- Host RPC errors must never depend on hidden picks (the host could probe them through errors).

## Grading & sweat (Phase 5)
- Scores: odds-sync job kind `scores` → `scores_ingest` (service role). A final grades legs and settles wagers
  in the same transaction (`grade_event` → `settle_wager`, which credits bankrolls). Finals are final: never
  re-grade, never pay twice. No final 12h after kickoff → legs void (refund). Signal: `scores` {}.
- Payout math must mirror place_wagers: product of live leg decimals, round 4dp, cap 1001, floor(stake × dec);
  pushed/void legs drop out. Win probability is computed ON READ (`live_probability` computed fields,
  `private.leg_probability`); the `leaderboard` view is security invoker, so it is blind before lock.
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
src/components/game/         live game card (score, clock, last play from game_live)
src/components/settings/     Settings sheet (odds as American or %, stored per phone in src/lib/prefs.ts)
src/lib/plain-english.ts     odds as %, "bet $10 to win", house-rules checklist, the "How it works" explainer
src/components/reveal/       post-lock: PlayerBets (drops down from each leaderboard row), by-game
                             consensus as a collapsed "Picks are in" dropdown, sweat outcomes
src/components/leaderboard/  live/final standings (from the leaderboard view)
tests/integration/           Vitest against the local stack (concurrency, Realtime channel auth)
supabase/tests/              pgTAP: every RLS policy and RPC has tests

## Non-negotiable rules
1. Blind picks are enforced in the DATABASE (RLS + security-definer RPCs), never only in UI.
   Any new table/view/function touching wagers or bankrolls needs a pgTAP test proving a
   co-participant cannot read it before lock_time.
2. Clients never write wagers/participants directly. All mutations go through RPCs
   (create_tournament, join_tournament, place_wagers, cancel_wager, replace_wager, update_tournament,
   lock_tournament_now, remove_participant, grade_prop). Players have
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
11. Visual design follows docs/DESIGN.md (palette since 2026-11-05: violet brand + coral hype, "game night" not
    sportsbook; plain words over jargon: Winner not Moneyline, "to win" not ML): semantic color tokens only (brand/hype/win/loss/warn/surface-2,
    never raw palette classes like emerald-400), `font-display` + `num` for titles and numbers, brand
    primitives from src/components/brand.tsx. After UI changes run the screenshot tour
    (SCREENS=./screens npx playwright test e2e/screens.spec.ts) and look at it.

## v1 product defaults
- Tournament-wide lock_time (defaults to earliest kickoff). Per-game locks are v2.
- Live NBA player stats: odds-sync job `stats` pulls ESPN's public box score (free, unofficial, non-commercial) for games in play
  with a prop pick → player_stats → wager_legs.live_stat ("18 Pts · needs 8 more" in each player's dropdown). Display only.
- Player props are opt-in per tournament (NFL adds alternate yards ladders, passing TDs, anytime TD; players grouped by
  team via Sleeper rosters, non-commercial only) and graded by the HOST entering each stat once (grade_prop; results are
  public in prop_results; ungraded props refund 48h after kickoff). Odds API has no player stats.
- Same-game parlays: host switch (allowed_bet_types.same_game_parlays, ON unless false). Each leg takes a slot:
  one per game line, one per player stat (ladder = its main stat); a repeat is CONFLICTING_LEGS. Payout = product
  of legs (no correlation haircut) and live P(cash) multiplies legs as if independent: approximate for SGPs.
- Min stake $1; parlay payout capped at 1000-to-1 (decimal 1001); money columns are bigint cents.
- Unwagered bankroll counts toward final score. House rules (allowed_bet_types.all_in / min_bets, migration 0017):
  players who miss them rank below everyone who met them (leaderboard.qualified, standing 'disqualified');
  min_total_wager_cents is legacy and unused.
  With min_bets, place_wagers also keeps $1 back per bet still owed (migration 0020, LEAVES_TOO_LITTLE; slip.ts reserveCents).
- Leave (player) / delete (host) only before lock: leave_tournament / delete_tournament. A 'tournament' signal with
  status 'deleted' sends open lobbies home.
- Live game feed (migration 0018): odds-sync job `live` reads ESPN's free scoreboard once a minute for NBA/NFL games
  in play → game_live (score, clock, down & distance, last play). In-progress scores also update events (live chances);
  a final only ever comes from scores_ingest. Display-only, non-commercial: replace before monetizing.

## Creative enhancements (log: CHANGELOG.md)
Built: 1. Live Prop Sweat: prop chance follows the box score + clock (private.prop_live_probability wraps
leg_probability_base); Safe/Sweating/Danger tags (src/lib/sweat.ts sweatTag). Never use live odds for this:
it would cost credits and jitter.
Backlog, in order:
2. Self-settling props: grade finals from the box score; a player who never played gets his leg voided (parlay drops it).
3. Slip Receipts: a share card (next/og) for each player after reveal, auto-titled from the slip ("4-leg Hail Mary", "Chalk Heavy").
4. Reactions on revealed picks + moment badges (Bad Beat = leg was 80%+ and missed, Survived, Cooked).
5. Sweat alerts: "Embiid needs 2 for Dave's parlay" when a leg is one play away.

## Glossary
Lock = moment picks freeze and become visible (tournaments.lock_time). Reveal = post-lock visibility.
Sweat = live tracking phase. P(cash) = de-vigged implied probability a pending wager wins.
