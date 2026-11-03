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
npm run e2e                  # playwright vs a PRODUCTION build (needs local Supabase + seed;
                             # one-time: npx playwright install webkit)
npm run lint && npm run typecheck   # typecheck runs `next typegen` first (PageProps/LayoutProps)

Windows dev box: Docker Desktop must be running before `npx supabase start`.

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
   RPCs raise stable UPPER_SNAKE error codes; map them to copy in src/lib/errors.ts.
10. Mobile-first: design at 375px, tap targets ≥44px, bottom-sheet slip.

## v1 product defaults
- Tournament-wide lock_time (defaults to earliest kickoff). Per-game locks are v2.
- Player props are graded manually by the host in v1 (Odds API has no player stats).
- One leg per event in a parlay (keeps win-probability independence assumption valid).
- Unwagered bankroll counts toward final score; host may set min_total_wager.

## Glossary
Lock = moment picks freeze and become visible (tournaments.lock_time). Reveal = post-lock visibility.
Sweat = live tracking phase. P(cash) = de-vigged implied probability a pending wager wins.
