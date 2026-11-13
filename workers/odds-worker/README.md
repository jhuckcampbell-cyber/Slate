# Odds worker

Run with Node 24+: `node --env-file=.env.worker workers/odds-worker/index.mjs`.
Build from repository root with `docker build -f workers/odds-worker/Dockerfile .`.
Inject secrets at runtime; never copy env files into an image.

Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ODDS_SYNC_SECRET (same as Edge),
ODDS_PROVIDER=fake|the-odds-api. Paid provider also needs ODDS_API_KEY.
Optional: ODDS_BOOKMAKERS (default draftkings,fanduel,betmgm),
ODDS_WORKER_POLL_MS (250?10000, default 1000), PORT (8080), ODDS_WORKER_HOST (0.0.0.0).
No keys appear in health responses or logs. Keep service credentials server-side.

The shared Edge engine claims/renews/releases the existing single-writer lease,
reserves/settles every paid request, normalizes through _shared, and diff-upserts.
The loop checks SQL due jobs each second; checking does not spend provider credits.
Props remain per-event and tournament opt-in. Free scores/stats/catalog work remains supported.
SIGTERM/SIGINT stops new cycles and drains the current cycle (120s shutdown grace).

GET /health returns 200 after a successful cycle, 503 after 45s without one.
A DB-clock heartbeat uses odds_worker_beat; cron skips only while it is fresh
(<45s), then resumes its existing one-minute Edge fallback. Failed cycles do not beat.
Deploy migrations 0032?0034 before the worker. Paid calls remain OFF until explicitly enabled.
