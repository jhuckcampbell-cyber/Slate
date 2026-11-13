# Odds sourcing & display: how sportsbooks do it, and what Slate should do

Researched 2026-11-09. **Not legal advice.** Prices come from vendor pages fetched on that date unless they
are marked *(unverified, seen 2026-11-09)*. Vendors change prices often, so re-check before buying anything.

---

## 1. Executive summary

- **Keep The Odds API as the primary odds source through beta and early growth.** Its terms explicitly allow
  showing odds in a commercial app UI, as long as we don't resell the raw data as a feed. It covers
  NBA/NFL game lines, player props and alternate lines. Pre-match prices refresh every 60s and in-play every 40s.
  The cost model (markets × regions) already lives in `budget.ts`. The free tier (500 credits) is too small for a
  real beta. **$30/month for 20K credits** is the right first step, and $59/month for 100K is the growth step.
- **The odds are not the biggest licensing risk. Our scores, stats and rosters are.** ESPN's endpoints are
  undocumented and have no license. Sleeper's docs say the API is free for non-commercial use only and
  that commercial use needs a license. Before charging money we must replace `live`, `stats` and the roster
  source with a licensed feed. The cheapest one-vendor candidate is **BALLDONTLIE** (GOAT tier, $39.99/month per league).
  It covers odds, props, box scores and live data, but its commercial terms are unverified. **SportsDataIO** is the
  established option, but it needs a sales call.
- **Sportsbooks don't invent most of their prices.** The big US books buy official league data (NFL: Genius
  Sports exclusive; NBA: Sportradar + Genius). They build their own models or use B2B platforms such as
  Kambi, Sportradar MTS and OpenBet, then adjust for market signals (sharp books such as Pinnacle and Circa)
  and for their own betting flow. A play-money app has no liability to manage, so it can simply **copy the
  consensus**, which is what we already do.
- **We can manufacture prices cheaply.** We already have de-vig and normal-model code in `src/lib/core/probability.ts`.
  From one main line per player stat we can generate the whole alt-ladder ("20+ / 25+ / 30+ pts")
  instead of paying for `*_alternate` markets. This cuts prop credit spend by roughly half. A consensus-fair price
  (median de-vig across our 3 books) is also a good default for play money.
- **Display wins worth adopting** (most map onto screens we already have):
  - up/down movement flashes on price changes
  - a lock icon instead of a greyed button for stale or suspended markets
  - ladder rows ("To score 25+")
  - an SGP builder that greys out conflicting legs before submit
  - a "% chance" toggle (already built)
  - pick'em-style "More / Less" copy for beginners
- **If we ever add paid entry and prizes, that is a different legal product.** Dual-currency sweepstakes
  sportsbooks (the Fliff model) are being banned or challenged state by state. California AB 831 took effect
  2026-01-01 and New York's ban was signed in Dec 2025. Free play money with no prize of value is the safe
  zone. Talk to a gaming lawyer before changing that.

---

## 2. Display patterns worth adopting (mapped to our screens)

These come from how DraftKings, FanDuel, BetMGM, Caesars, ESPN Bet (theScore Bet since late 2025), bet365,
Fanatics, Hard Rock, PrizePicks/Underdog and Fliff present markets. The observations are from public product
experience and the UX write-ups cited in §7; I didn't screenshot each app this session. Each item is translated
into our "Ticket stub" design language (docs/DESIGN.md).

| Pattern (who does it) | What it is | Our screen | Adopt? / notes |
|---|---|---|---|
| **3-column game row** (all US books) | Team rows × [Spread | Total | Moneyline], each a tappable price button with line on top and price below | `event-card.tsx` | Already have it. We label it "Winner", not "Moneyline" (rule 11). Keep it. |
| **Popular / Game lines / Props tabs on a game page** (DK, FD, Fanatics) | Game page split into tabs, with "Popular" first | `game-page.tsx` | Already built. Consider a **"Quick picks"** row at the top of Popular: one spread, one total, and the top 3 player props by betting interest. Books rank by handle; we could rank by how many squad members picked it, which is post-lock only so blind picks are safe. |
| **Line-movement flash** (DK green/red arrow or tint for a few seconds; FD subtle arrow) | Shows that a price just moved and which way | Price button in `event-card` / `game-page` | **Adopt.** `odds_cache` rows only change on real moves, so a Realtime UPDATE *is* a move. Keep the previous price client-side and show ▲/▼ for ~5s. Use the existing `win`/`loss` tokens, not raw greens. Pairs naturally with the `ODDS_CHANGED` flow in the slip. |
| **Suspended / locked market** (all books: padlock icon replaces price, button disabled; markets often vanish briefly in-play) | Honest "you can't bet this right now" | `odds_board.is_stale`, buttons | **Adopt the padlock.** Show a lock glyph (lucide `Lock`) in place of the price with "Updating…" on tap, rather than a greyed button or a hidden market. Hiding markets makes users think the app is broken. |
| **Odds format toggle** (most books: American/Decimal/Fractional in settings) | User preference | Settings sheet | Done (American or %). Decimal adds little for US users. |
| **"Bet $10 to win $X" preview** (FD, DK slip; PrizePicks shows "2x/3x/5x") | Payout in dollars, not odds | Slip + price buttons | Done in slip. Optional: a long-press or tooltip on a price button showing "$10 wins $X" for novices. |
| **Alt-line ladders** (DK "Alt Points", FD "To score X+ points" milestone buttons, Fanatics ladders) | One row per threshold, price rising as the threshold rises | Props tab per stat | **Adopt "X+" milestone rows**, which are easier than over/under at a half point. See §5 for how to generate them without extra credits. NFL already has alt yards ladders. |
| **SGP builder** (FD "Same Game Parlay" button on each game, DK SGP, bet365 "Bet Builder") | Tap legs within a game; price updates live; incompatible legs greyed out with a tooltip | Slip in `mixed` / parlay mode | **Adopt the pre-emptive grey-out.** We already reject `CONFLICTING_LEGS` on submit. Grey the conflicting button client-side with "Already have a pick on this" so users never hit the error. Books apply a correlation haircut; we don't (by design). Say so in "How it works". |
| **Boosts / "Profit boost" badges** (all books) | Promo pricing | n/a | Skip. They create a pricing-fairness question in a friends contest. Possible later as a host tool ("house boost on one game"). |
| **Live / in-play view** (all books: score bug + clock above the markets, "LIVE" tag, markets suspended at key moments) | Score context next to prices | Games tab (`game/`) | We show the score bug post-lock but no live betting (picks lock at tournament lock). Keep it. The coral live dot already matches the book convention. |
| **Pick'em "More / Less"** (PrizePicks, Underdog "Higher/Lower") | Props shown as one projected number; user picks direction; payout by number of picks | Props tab copy | **Borrow the language, not the model.** Label over/under buttons "More than 24.5" / "Less than 24.5" in plain-English mode. Beginners understand this far better than "O 24.5 −115". |
| **Social sportsbook currency framing** (Fliff Coins vs Fliff Cash) | Play-money balance always visible | Bankroll chip | We already show the bankroll. Don't introduce a second currency (see §6 legal). |
| **Beginner explainers** (FD/DK "How to bet" hubs, odds converters; PrizePicks onboarding carousel) | Inline (i) explainers | "How it works" (`plain-english.ts`) | Done. Add a one-screen "What does −150 mean?" with the `$` and `%` side by side, linked from the first price button a new user taps. |
| **Bet tracker with live cash-out probability** (DK/FD "My Bets" with live progress bars on props) | Progress bar "18/25 pts" | Leaderboard PlayerBets dropdown | Already built (live prop sweat). This is our differentiator. Keep investing here (backlog #5 sweat alerts). |

**Don't adopt:** dense multi-market grids on the home board, auto-scrolling tickers, cash-out (meaningless
with no real money and complicates grading), and "trending bets" before lock (it would leak blind picks; rule 1).

---

## 3. How sportsbooks source odds

**1. Official data comes first.** Leagues sell official betting data feeds (play-by-play, scores, stats, low latency)
through exclusive or semi-exclusive distributors:
- **NFL:** Genius Sports is the exclusive distributor of official NFL data to sportsbooks. The NFL holds equity in it.
- **NBA:** Sportradar and Genius Sports both hold non-exclusive US rights. Any operator wanting official NBA data
  must partner with one of them.
- Several states require or incentivize official data for in-play bets. Latency is the product: official feeds are
  pitched in the sub-second range, and scouts at venues beat the TV broadcast.

**2. Pricing ("trading") follows one of three models:**
- **In-house trading:** large books (FanDuel/Flutter, DraftKings after its in-house migration, bet365) run their own
  quant models and trading desks. They use official data plus their own models.
- **B2B platform / managed trading:** Kambi, Sportradar MTS/Managed Trading, OpenBet (Endeavor), IGT PlaySports,
  Genius (BetVision/trading), and historically SBTech (now inside DraftKings). The operator gets a full price feed plus
  risk tools and adjusts margins. Kambi says AI now prices or manages nearly half its bets.
- **Market-following:** most books, B2B ones included, watch the sharp, high-limit market. Pinnacle and Circa
  (Las Vegas) accept large bets from professionals and move quickly, so their lines are treated as the "true" price.
  Recreational books then add a bigger margin and shade toward public bias. Opening lines often come from a sharp
  book or a model; the rest of the market follows within minutes.

**3. Risk management.** Books limit or profile sharp customers, set per-market liability limits, and suspend markets
during dangerous moments (in-play scoring chances, injury news). That is why "suspended" exists. Props carry more
margin (often 8–10% hold vs ~4.5% on −110/−110 sides) because models for them are weaker.

**4. Implication for us.** We carry no liability: play money, and bankrolls are fixed per tournament. We don't need a
trading desk, official data or sub-second latency. Copying the consensus of 2–3 major books is not just acceptable
but *better* for fairness among friends, because nobody in the group can exploit a stale outlier. Rule 3
(server re-reads, `ODDS_CHANGED`) already covers the only real risk, which is picks against stale prices.

---

## 4. Provider comparison

Legend: ✔ = vendor states it's included; ? = not confirmed. "Commercial" means: may a monetized consumer app
*display* the data?

### Odds feeds

| Provider | Price (monthly) | Coverage (US books) | Props / alt lines | Live odds | Latency / refresh | Commercial ToS | Fit for us |
|---|---|---|---|---|---|---|---|
| **The Odds API** (current) | Free 500 cr · **$30 / 20K** · $59 / 100K · $119 / 5M · $249 / 15M | DK, FD, BetMGM, Caesars, ESPN Bet/theScore, Fanatics, Hard Rock, BetRivers, etc. Free tier = "most bookmakers" | ✔ props + alternates (per-event endpoint, selected sports/books) | ✔ | Pre-match featured markets 60s (ramps to 40s in the last 6h); props 60s; in-play 40s. Scores ~30s | **Display in commercial apps allowed**; no resale as a standalone data product; no attribution required | Best for now. Known cost model; already integrated |
| **SportsGameOdds** | Amateur free (2,500 objects, 10 min) · Rookie $99 (100K objects, 3 min) · Pro $299 (unlimited, sub-minute) · All-Star custom | 77–82 books on paid tiers | ✔ props + alt lines on every tier, same endpoint as game lines | ✔ | 10 min / 3 min / sub-minute by tier | Not stated on pricing page; ask before relying on it | Good growth alternative; "objects" pricing favors props-heavy use |
| **BALLDONTLIE** | Free (5 rpm) · All-Star $9.99/league · **GOAT $39.99/league** · All-Access $299.99 | "major US sportsbooks" (tutorials name DK, FD, Caesars, BetMGM, bet365, BetRivers) *(unverified, seen 2026-11-09)* | ✔ props (NBA props "live, not stored") | ✔ | ? | Not stated on homepage; check ToS | **One vendor for odds + box scores + live** for ~$80/month (NBA + NFL). Strong candidate to replace ESPN/Sleeper |
| **OpticOdds** | Not published; ~$5,000/month reported by competitors *(unverified, seen 2026-11-09)* | 200+ books | ✔ | ✔ SSE / RabbitMQ push | sub-second claimed | Enterprise contract | Overkill until monetized at scale |
| **OddsBlaze** | $29–$249 or "from $299" depending on source *(unverified, seen 2026-11-09)*; no free tier | US books + SGP pricing | ✔ (incl. SGP prices) | ✔ | REST; push on enterprise | ? | Interesting only if we ever want real book SGP prices |
| **Unabated API** | Not published; ~$3,000/month reported *(unverified, seen 2026-11-09)* | Sharp-focused, US | ✔ | ✔ WebSocket | real-time | ? | No |
| **SportsDataIO** | No public prices; "pricing based on use case"; Discovery Lab free trial is scrambled data | 10+ books in odds feeds | Props/futures in a separate "Vault" product with separate key | ? | ? | Commercial agreement required; trial not licensed for display | Monetized stage (combined odds + official-quality stats) |
| **Sportradar** (Odds Comparison / US APIs) | Enterprise; developer trial exists *(unverified, seen 2026-11-09)* | Wide | ✔ | ✔ | Official-data latency | Contract | Monetized/scale only |
| **API-Sports** (api-basketball / api-american-football) | Free 100 req/day; ~$15–$35 direct or ~$10–$20 via RapidAPI for 7.5K–150K req/day *(seen 2026-11-09)* | Odds coverage for US sports not confirmed | ? | ? | Soccer odds are daily pre-match only | ? | Not for odds |
| **Goalserve** | 30-day trial; NFL/NBA tiers ~$250–$1,500 per term per third-party summary *(unverified, seen 2026-11-09)* | "20+ bookmakers" | ? | ✔ | scores 2–4s | ? | Possible stats + odds bundle; dated UX |

### Scores / box scores / rosters (replacing ESPN + Sleeper)

| Provider | Price | NBA/NFL live box score | Rosters | Commercial ToS | Notes |
|---|---|---|---|---|---|
| ESPN site API (current) | Free | ✔ | ✔ | **None.** Undocumented, reverse-engineered; ToS risk under heavy automated use | Fine for a closed beta, **must replace before monetizing** |
| Sleeper API (current, NFL rosters) | Free, no auth, <1000 calls/min | n/a | ✔ | **Free for non-commercial; commercial needs a license from Sleeper** | Replace or license before monetizing |
| The Odds API `/scores` | 1 credit (2 with `daysFrom`) | scores only, no player stats | ✗ | ✔ (same terms as odds) | Already used for finals |
| BALLDONTLIE GOAT | $39.99/league | ✔ "live box scores" | ✔ | check ToS | One vendor for everything; cheapest candidate |
| SportsDataIO | sales | ✔ | ✔ | contract | Established; used by many fantasy apps |
| MySportsFeeds | free for personal/non-commercial (no real-time); commercial by quote *(unverified, seen 2026-11-09)* | ✔ on paid | ✔ | quote | Small-team friendly |
| API-Sports | $0–$35 | ✔ (games/statistics) | ✔ | standard paid license *(verify)* | Very cheap; check live latency for NFL |
| Goalserve | quote / trial | ✔ (2–4s scores) | ✔ | ? | |

Background: game facts and statistics generally aren't copyrightable in the US (*NBA v. Motorola*, 1997;
*C.B.C. v. MLB Advanced Media*, 2007, for fantasy use of player names and stats). Providers restrict use **by
contract** (ToS), not copyright. That is why the ToS column matters more than the data itself.

---

## 5. Recommended path for Slate

### Stage 0: now / closed beta (free, non-commercial)

**Odds:** stay on The Odds API. Upgrade to **$30/20K** the week real groups start playing. The 500 free credits
cover about one NFL Sunday at our current cadence (ARCHITECTURE §3 estimates ~1.5K/Sunday at higher cadence).
- `npm run odds -- status` then set `odds_monthly_quota=20000`, `odds_monthly_cap≈16000` (keep the 20%
  headroom pattern) and loosen `odds_refresh_tiers` in `private.app_settings`. **No deploy needed** (by design).
- Keep `ODDS_BOOKMAKERS=draftkings,fanduel,betmgm`. Up to 10 books cost the same as 1 region
  (`oddsCallCost` = markets × ceil(books/10)). We could add caesars, fanatics, espnbet and hardrockbet **for free**
  to strengthen the consensus, as long as we stay at ≤10.

**Credit levers, in order of impact:**
1. **Generate alt ladders instead of fetching `*_alternate` markets.** Fetch only the main line per stat
   (`player_points`, `player_rebounds`, …). Derive "15+ / 20+ / 25+ / 30+" in a new pure function in `_shared`
   (or `src/lib/core`) from the de-vigged main-line probability, using a normal model with a per-stat SD
   (already the approach in `probability.ts`). The cost per prop call drops by the number of alt markets
   requested. This only applies to NBA; NFL alt yards stay fetched until the model is validated.
2. **Props only for games in an open tournament with props on**, and no prop refresh after lock (picks are frozen).
3. Stop game-line refreshes at tournament lock, not kickoff, when every tournament on that game is locked.

**Scores/stats/rosters:** keep ESPN + Sleeper during a free, invite-only beta. Wrap each behind an interface
(`_shared/live.ts`, `stats.ts`, `rosters.ts` already isolate them) so the later swap is a provider switch,
mirroring `ODDS_PROVIDER`. Add a `STATS_PROVIDER` env, defaulting to `espn`.

**Display:** ship the movement flash, padlock-for-stale, "More / Less" copy, and the SGP grey-out from §2.

### Stage 1: growth (still free to users, maybe ads/sponsors = commercial)

As soon as there is *any* revenue (ads count), we are commercial for ToS purposes.
- **Odds:** The Odds API **$59/100K** gives room for 60s pre-lock cadence and many prop games. Alternative:
  SportsGameOdds Rookie $99 (props and alt lines included per object; 3-min refresh).
- **Stats + rosters:** move to **BALLDONTLIE GOAT** (NBA + NFL ≈ $80/month), if its ToS permits commercial
  display (verify in writing). Fallbacks: API-Sports (cheap) or a MySportsFeeds commercial quote. Pipeline changes:
  - new `STATS_PROVIDER=balldontlie` implementations of `live`, `stats` and roster loading behind the same
    normalize/ingest RPCs (`game_live`, `player_stats`)
  - these calls don't spend Odds API credits, so give them their own rate limiter, not the `odds_budget` ledger.
    Or generalize `odds_budget` to `provider_budget` keyed by provider, so `npm run odds -- status` shows both.
- **Self-settling props** (backlog #2) become legitimate at this point, because the box score is licensed.
- **Consensus pricing:** switch the canonical price from "first book in priority order" to a **median de-vig across
  books**, then re-apply a fixed small margin (or none). Store the per-book source rows for provenance. This takes
  one change in `normalize.ts` (pickBook → consensus) and stays fully deterministic for `ODDS_CHANGED` checks.

### Stage 2: monetized (paid features, subscriptions, or prizes)

- **Paid features for play money (no prizes)**, e.g. a "Pro host" subscription. Keep the odds provider; sign a
  commercial stats license (SportsDataIO or Sportradar if BALLDONTLIE's license doesn't fit). Budget roughly
  $100–$600/month for licensed US stats *(unverified ranges, seen 2026-11-09)*. Remove every ESPN/Sleeper call.
- **Prizes of value (sweepstakes / paid entry):** stop and get gaming counsel first (§6). If we go ahead, we'd want
  prices that are clearly *ours*, not "DraftKings' odds". Run our own consensus/model lines with documented
  margins, add geofencing and age/KYC, and probably move to an official-data-derived feed.
- **Affiliate links to real sportsbooks:** this requires state affiliate/vendor licensing in most legal states,
  plus responsible-gaming copy. It's a separate project.

### Generating our own lines: tradeoffs

| Approach | Pros | Cons |
|---|---|---|
| Copy one book (today) | Simple, recognizable numbers | Single-book outliers; dependent on that book's coverage |
| **Consensus de-vig (median of 3–8 books)** | Fairer, robust to stale books, free with ≤10 books per region | Prices won't exactly match any app a user checks; need to explain "Slate line" |
| Fair odds, no vig | Truly fair for friends; simpler EV story | Unfamiliar numbers (−104/+104 instead of −110/−110); fat favorites/longshots look odd |
| Model alt ladders from main line | Cuts prop credits a lot; endless ladders | Normal approximation misprices tails (blowouts, minutes risk); needs per-stat SD calibration from historical data |
| Full model props (projections from box scores) | No odds provider needed for props | Needs injury/lineup news, which is very hard to keep fresh; likely to be exploitably wrong. Avoid |

---

## 6. Risks

1. **Data licensing (high, near-term):** ESPN (no license) and Sleeper (non-commercial only) power live scores,
   stats, NFL rosters and the live prop sweat. Any revenue, ads included, likely breaches these. Mitigation:
   Stage 1 swap; keep the provider abstraction.
2. **Credit exhaustion (medium):** a viral weekend on the free tier = "odds unavailable". The DB breaker
   already degrades safely. Mitigation: upgrade at beta start; alt-ladder generation; post-lock refresh stop.
3. **Vendor terms drift (medium):** The Odds API's commercial-display permission is the basis of our plan.
   Keep a dated copy of the ToS clause; re-check yearly.
4. **Sweepstakes/prize law (high if we go there):** dual-currency sweepstakes are banned or challenged in a growing
   list of states. California AB 831 (effective 2026-01-01; liability extends to suppliers and media affiliates)
   and New York (signed Dec 2025). Others reported include NJ, CT, MT, IN, ME and WA/TN; sources conflict, so verify
   per state. Cease-and-desist letters have gone out in AZ, LA, MD, MI, MS and NY. Fliff itself is restricted in
   several states. **Free play money with no prize of value lacks the "consideration + prize" elements of gambling
   in most states. Don't add either without counsel.**
5. **App store policy (medium):** simulated gambling apps face age ratings (17+/18+) and must not offer real-money
   gaming without licensing. Re-check the Apple 5.3 and Google Play "simulated gambling" policies before store
   submission. (A PWA avoids this for now.)
6. **Trademarks:** showing sportsbook *names* as a source ("via DraftKings") is nominative use and generally fine;
   **logos** and team/league **logos** need licenses. Keep to text.
7. **Pricing errors (low impact for play money):** stale or misnormalized props can be exploited by one friend.
   `ODDS_CHANGED`, freshness and per-player book merging already cover this; consensus pricing reduces it further.
8. **ESPN endpoint breakage (medium):** undocumented endpoints change without notice. That breaks the live sweat
   mid-game. Another reason to move to a contracted feed.

---

## 7. Sources (all accessed 2026-11-09)

**Providers and pricing**
- The Odds API pricing and coverage: https://the-odds-api.com/
- The Odds API v4 docs (credit cost = markets × regions; scores 1–2 credits): https://the-odds-api.com/liveapi/guides/v4/
- The Odds API update intervals: https://the-odds-api.com/sports-odds-data/update-intervals.html
- The Odds API terms (commercial display allowed; no redistribution): https://the-odds-api.com/terms-and-conditions.html
- SportsGameOdds pricing: https://sportsgameodds.com/pricing
- SportsGameOdds provider comparisons (vendor-authored): https://sportsgameodds.com/blog/comparing-odds-api-providers , https://sportsgameodds.com/compare/the-odds-api , https://sportsgameodds.com/blog/optic-odds-vs-sports-game-odds
- BALLDONTLIE: https://www.balldontlie.io/ · docs https://docs.balldontlie.io/ · review https://sportsapis.dev/apis/balldontlie
- OpticOdds: https://opticodds.com/sportsbook-operators-traders · competitor estimates https://odds-api.io/blog/odds-api-vs-opticodds , https://oddspapi.io/blog/?p=2863
- OddsBlaze / Unabated (third-party): https://sportsapis.dev/apis/oddsblaze , https://sharpapi.io/compare/oddsblaze-alternative , https://sportsapis.dev/apis/unabated , https://sportsgameodds.com/compare/unabated
- SportsDataIO developers: https://sportsdata.io/developers/getting-started · data rights FAQ https://sportsdata.io/help/data-rights-and-licensing-questions
- API-Sports: https://api-sports.io/sports/nba · RapidAPI https://rapidapi.com/it/api-sports/api/api-basketball/pricing · NFL guide https://www.api-football.com/news/post/how-to-get-started-with-api-nfl-the-complete-beginners-guide
- Goalserve NFL/US sports: https://www.goalserve.com/sport-data-feeds/nfl-api/prices , https://www.goalserve.com/sport-data-feeds/ussports-api/prices
- MySportsFeeds (third-party summary): https://sportsapi.com/blog/posts/affordable-sports-apis-for-developers
- Sleeper API (non-commercial; commercial needs license): https://docs.sleeper.com/
- ESPN hidden API (third-party guides; no official ToS found): https://zuplo.com/blog/2024/10/01/espn-hidden-api-guide , https://sportsapis.dev/espn-api

**Industry / sourcing**
- NFL–Genius Sports exclusive data deal: https://www.nbcwashington.com/news/business/money-report/national-football-league-agrees-to-data-rights-deal-with-genius-sports/2627481/ , https://sports.yahoo.com/amphtml/nfl-genius-sports-strike-data-201540433.html
- NBA–Sportradar/Genius data deals: https://www.legalsportsreport.com/26353/nba-announces-betting-deals/ , https://news.yahoo.com/nba-extends-betting-data-deals-120046913.html
- Sportradar trading: https://www.gamblinginsider.com/news/7428/behind-the-scenes-of-sportradars-trading
- Kambi AI pricing share: https://casinobeats.com/2026/01/20/ai-prices-manages-nearly-half-sports-bets-kambi/
- Kambi pricing inputs (2019 investor commentary): https://moiglobal.com/investment-commentary-kambi-201910/?pdf=65451
- Platform vendor map: https://track360.io/blog/sportsbook-platform-providers-vendor-comparison-kambi-altenar-betby-2026

**Display / UX**
- https://altenar.com/en-us/blog/how-to-design-a-sportsbook-user-experience-ux-that-wins-in-live-play/
- https://altenar.com/blog/sportsbook-ux-trends-to-watch/
- https://symphony-solutions.com/insights/sportsbook-ux
- https://www.flatstudio.co/blog/why-your-betslip-is-wrong-ux-of-a-trading-terminal
- https://www.flatstudio.co/work/oddsjam-ios

**Legal / sweepstakes**
- California AB 831: https://casinobeats.com/2025/10/13/california-sweepstakes-casino-ban-ab-831/ , https://www.sweepsy.com/news/newsom-signs-ab831-sweeps-casinos-jan-1-2026/
- 2025 sweepstakes year in review: https://igamingbusiness.com/legal-compliance/2025-sweepstakes-casinos-year-in-review/
- State tracker (verify per state): https://track360.io/blog/states-banning-sweepstakes-casinos-2026-legislative-tracker-operator-playbook
- Fliff model and availability: https://www.stokastic.com/articles/dfs-strategy/what-is-fliff , https://www.legalsportsreport.com/sports-betting/social/ , https://sbcamericas.com/2026/01/08/fliff-dfs-superstars-launch-licenses/

*Not legal advice. Pricing marked unverified came from third-party or competitor pages and should be confirmed with the vendor.*
