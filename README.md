# SquadBets

Play-money betting tournaments with your friends. Blind picks until kickoff, then a live sweat.

## Local setup

Prereqs: Node 24, Docker Desktop.

```bash
npm install
npx supabase start          # prints local URL + publishable/secret keys
cp .env.example .env.local  # paste keys from `npx supabase status`
npx supabase db reset       # apply migrations + seed
npm run dev
```

Conventions, commands, and the non-negotiable rules live in [CLAUDE.md](CLAUDE.md).
Architecture and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
