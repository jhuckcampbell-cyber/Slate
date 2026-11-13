# Design & UI landscape: social betting, pick'em and group-play apps (2025–2026)

Researched 2026-11-09 for Slate (current wordmark: "slate"). Scope: what comparable products and design writing
say is working right now, and how it maps onto our "Ticket stub" system (`docs/DESIGN.md`). Recommendations are
patterns to adopt in spirit, not branding to copy.

Caveat on sources: most public material on these apps is App Store copy, affiliate reviews and agency blogs. Where a
claim comes from marketing copy it is labeled as such. Primary sources (company help centers, design-team posts,
press releases) are preferred where they exist. No apps were installed for this report; per-app notes combine those
sources with widely known, publicly visible UI patterns.

---

## 1. Executive summary: top takeaways

1. **The link is the product.** Partiful's growth (Google's Best App of 2024, ~500k MAU by Q1 2025 per Nogood) comes
   from an invite link that is a full, beautiful landing page and works without installing anything. Our
   `/join/CODE` + anonymous auth is exactly this model. Invest in the link preview and the first 10 seconds after tap
   more than in any install prompt.
2. **Chat and reactions are the retention layer, not a feature.** Sleeper's edge, according to reviewers and
   TechCrunch, is chat embedded on almost every screen ("talk trash, react to plays, sweat games together").
   Splash added in-contest chat with GIFs and animated emoji. We have none. The cheapest high-impact version is
   **reactions on revealed picks** (backlog #4), not full chat.
3. **Copy-a-friend's-slip is the 2025 social mechanic.** Underdog's "Shared Picks / Squad Boost" rewards friends
   for copying (tailing) your entry; Sleeper lets friends copy contests; Pikkit is built around following and tailing.
   For blind picks, the post-lock version is "Ride with Dave next time" or a reaction, and the pre-lock version is
   sharing your *intent* without the picks.
4. **Spoiler-free sharing travels.** Wordle's emoji grid spread because it bragged without spoiling. BeReal's
   "post to see" gate made participation the price of looking. Our blind-until-lock rule is a BeReal gate already;
   we should make the share artifacts lean into it (e.g. "6 of 8 slips in · locks in 2h" teaser cards with ghost stubs).
5. **Percent chance is now mainstream.** Kalshi and Polymarket put "72% chance" in front of tens of millions of
   people and on CNN/CNBC/Google Finance. Our "odds as %" setting is on-trend; it should arguably be the **default**
   for new players, with American odds as the opt-in for bettors.
6. **Show the money logic in plain words at the point of decision.** Prediction-market UX ("You pay $0.30. If
   correct, you get $1.00") and the critique of PrizePicks' misleading totals both point the same way: show stake →
   return and net result honestly. We already do `$stake → $return`; extend it to net profit on the final screen.
7. **Bold outlines are in, but as positioning, not decoration.** Neo-brutalism / "tactile brutalism" is listed in most
   2026 trend roundups (Gumroad is the canonical example). Our 2px ink outlines sit in the calm end of that trend. The
   risk the sources flag (buried primary action, too much novelty) is the one to watch, not the outlines themselves.
8. **Share cards are 9:16 and one tap.** Spotify Wrapped's cards ship pre-formatted for Stories, with the share button
   on every story. A "Slip Receipt" (backlog #3) should export as 9:16 for Stories and 1.91:1 for iMessage link
   previews, both from next/og.
9. **Live sweat belongs on the lock screen, but a PWA cannot do Live Activities.** ESPN and Apple Sports put live
   scores in the Dynamic Island. We cannot, so web push at the moments that matter (lock, reveal, "one play away",
   final) is our equivalent. Keep it few and specific.
10. **Haptics on iOS web are a progressive-enhancement hack.** Safari still lacks `navigator.vibrate`; libraries use a
    hidden `<input type="checkbox" switch>` (Safari 17.4+). Fine for one or two moments (odds tap, reveal), never
    as a required signal.

---

## 2. Per-app notes

### Sleeper (fantasy + Sleeper Picks)
- **What it is:** season-long fantasy, pick'em ("more or less" on 2+ players), now prediction markets, all in one app.
- **Patterns worth stealing:**
  - Chat everywhere: league chat sits next to every screen, so trash talk happens in-product instead of iMessage.
  - Context integration: picks live inside the league you already care about. Reviewers call this its best UX
    advantage, while the same integration makes it feel cluttered.
  - Friends can copy each other's contests (store listing), which turns a good slip into an invite.
  - Playful, dark, character-driven brand with mascots and stickers; it reads as "for friends", not "for sharps".
- **Watch out:** reviewers call it cluttered, and its 2025 NFL kickoff outages show that social features depend on
  reliability. For us: never add a tab without removing one.

### Underdog (pick'em, Champions, sportsbook, prediction markets)
- **Patterns worth stealing:**
  - **Shared Picks / Squad Boost** (help center): share any 2+ pick entry with the invite button; each friend who
    copies it raises everyone's boost (20% at one friend, 30% at two; tiers replace each other and do not stack). It is
    a social loop where the *share* is the bet.
  - Bright, sporty, slightly cartoonish brand (the dog mascot, yellow accents) that keeps a money app feeling
    playful. Reviewers say the layout is easy to understand but scroll-heavy.
- **For us:** no money boost, but "N friends rode this slip" is a strong post-lock badge, and a "Run it back with this
  squad" button after a final is the same loop in our model.

### PrizePicks
- **Patterns worth stealing:**
  - One card = one player, one projected number, two giant buttons (More / Less). It is the simplest bet-construction
    UI in the category and reviewers repeatedly call it "the cleanest app in the industry".
  - Power vs Flex is explained as a small payout table right in the slip.
- **Patterns to avoid (Focus State critique):** payouts hidden until submit, "goblin/demon" labels that imply a pick
  is safe, profile totals that show winnings rather than net. We already avoid most of these; keep it that way and
  keep the "No Safe/Sweating/Danger words" rule in DESIGN.md.

### Splash Sports (Survivor, Pick'em, QuickPicks; merged with RunYourPool / OfficeFootballPool)
- **Patterns worth stealing:**
  - Host-first flow: pick format → set scoring and payouts → invite friends; the host is the growth channel.
  - In-contest chat with GIFs and animated emoji (store copy: "Talk smack, drop GIFs").
  - Pick reminders and **weekly recaps** as notifications. A recap is a re-engagement moment we do not have.
- **For us:** an end-of-tournament recap ("Dave's 4-leg parlay hit; Sam went 0-for-5") that the host can text out,
  with a one-tap "Same squad, next game" restart.

### Pikkit (bet tracker + social feed)
- **Patterns worth stealing:** the feed of friends' *settled* bets, following, tailing, and bragging rights based on
  verified results. It treats bets as social posts.
- **For us:** after reveal, every pick is effectively a post. A reaction row and a "tail next time" affordance on each
  revealed pick is the Pikkit idea scoped to one tournament.

### Fliff (social/sweepstakes sportsbook)
- **Patterns worth stealing:** leaderboards, badges and rankings drive the social side (reviews); a winning pick gets a
  celebration with a breakdown of what each leg earned; a prominent two-currency toggle at the top.
- **Watch out:** visually it is a classic dark sportsbook. This is the look we deliberately reject.

### DraftKings Pools / ESPN app
- **DraftKings Pools** (inside the Sportsbook app): framed by DraftKings itself as bringing "the office or friends
  pool" into the app, built for "casual" and "easier". Validates the friends-pool category; the big books see it too.
- **ESPN (Aug 2025 relaunch):** betting and fantasy tiles sit beside live video and stats; Live Activities on the lock
  screen and Dynamic Island; "SC For You" personalized highlights. Lesson: the live score and your stake belong in one
  glance. Our leaderboard dropdown with a mini scoreboard per game already does this.

### Apple Sports
- Deliberately minimal (Eddy Cue: the simplicity is intentional): scoreboards first, follow teams, Live Activities,
  game pages with box score and play-by-play, and since 2025 a home-screen widget.
- **For us:** the Games tab should feel like Apple Sports: big score, clock, last play, nothing else. Design critics
  (Lickability) note it is mostly stock components remixed well; restraint is the feature.

### Kalshi / Polymarket (prediction markets)
- Probability is the headline number on every card; multi-outcome markets use proportional bars; changes animate
  smoothly with small "+2%" badges; a simple probability line over time instead of trading charts; "Updated 3s ago"
  liveness cues; "explore before committing" onboarding (browse without an account).
- **For us:** chance bars and % are already our language. Add the liveness cue and the "+3% since lock" delta on
  chance bars during the sweat.

### Group-chat-native betting startups (Chalk, Real Ballers, BetMeNow, Torch, Slips, Rebet, Parlay)
- 2025 Product Hunt / App Store launches are converging on one pitch: "turn your group chat into a sportsbook".
  Torch uses group-chat-style feeds and lets users loan points to friends; Chalk lets groups invent their own bets.
- **Signal:** the category is crowded on the *chat* axis and thin on *design quality*. Our differentiators are the
  blind-reveal moment, the plain-English explanations and a calm, non-casino look.

### Non-betting group-play references
- **Partiful:** the invite page *is* the app for guests (no install, no account); hosts see RSVPs live; invites are
  themed, screenshot-worthy, and get shared beyond the guest list. Its look is playful, slightly chaotic and
  personal. Steal: themed, screenshot-worthy join pages and a live "who's in" list on the invite.
- **BeReal:** you cannot see friends' posts until you post (blurred before). Steal: show other players' stubs as
  blurred/ghost stubs before lock with "post your slip to see theirs at lock" framing; it makes blind picks feel like a
  game mechanic instead of a restriction.
- **Wordle:** spoiler-free, plain-text share that works everywhere; one daily moment shared by everyone. Steal: an
  emoji/text result line that pastes into any group chat (e.g. `slate · Celtics vs Knicks · 2nd of 7 · 🟩🟩🟥⬜`).
- **Strava:** one low-effort reaction (Kudos) instead of a menu, chosen partly to keep the space encouraging.
  Strava's own research: kudos are "virtual high fives", comments are rare and short. Steal: a tiny fixed reaction
  set, no free text at first.
- **Spotify Wrapped:** 9:16 cards, a share button on every story, identity framing ("your listening personality").
  Steal: auto-titled slip personalities ("Chalk Heavy", "4-leg Hail Mary") on the receipt card.

---

## 3. Trend analysis and where Ticket stub fits

| Trend (2025–2026) | Evidence | Fit with Ticket stub |
|---|---|---|
| Neo-/"tactile" brutalism: thick black borders, flat fills, big plain type, hard offset shadows | Setproduct 2026, DesignRush, daisyUI trends, UX Studio "bold, experimental design is back, with intent" | **Strong fit.** 2px ink outlines and paper/ink palette are a calm brutalism. We skip hard offset shadows (DESIGN.md: "no shadows"); a 2px offset shadow on the *one* primary CTA or the selected stub would be the on-trend accent if wanted. |
| Retro / analog metaphors (tickets, receipts, stamps, OS chrome) | Setproduct: retro as "deliberate positioning", Teenage Engineering, Poolsuite | **Strong fit.** The stub with perforation and punched notches is exactly this. Extend the metaphor to share cards (a receipt) and the reveal (a stamp). Avoid turning it into a costume. |
| Percent-first probability display | Kalshi, Polymarket, Google Finance integrations | **Fit.** Matches our plain-English rule. Consider % as the default. |
| Dark, neon sportsbook look | Fliff, DK, FanDuel, most pick'em apps | **Deliberate conflict, and that is good.** Our light, calm look differentiates in a sea of dark apps and signals "game night, not casino". |
| Liquid Glass / translucent chrome (iOS 26) | Apple's iOS 26 redesign; Safari 26 applies glass to web chrome and PWA icons | **Mild conflict.** Glass blur and refraction fight with paper and ink. Do not chase it; just make sure the maskable PWA icon still reads after iOS adds glass effects, and that the status bar / top bar color is set (some iOS 26 PWAs reported a white top bar). |
| Mascots and characters | Underdog, Sleeper, Duolingo-style personality | **Neutral.** We have no mascot; the coral slash is our "character". A tiny set of illustrated stamps (Bad Beat, Survived, Cooked) could give personality without a mascot. |
| Expressive motion, Rive/Lottie micro-animations | Spotify Wrapped built with Rive; prediction-market animated deltas | **Fit if rare.** We already have Ticker, FLIP glide, odds fly-to-slip. One more signature moment (stamp at reveal, tear-off at final) is enough. |
| Chat-native everything | Sleeper, Splash, Torch, Chalk | **Gap.** We rely on the group's existing SMS thread. That is fine for v1; reactions close most of the gap. |
| Accessibility as baseline | Setproduct warns brutalist UIs often drop focus states; 4.5:1 text contrast | **Mostly aligned.** We already require 4.5:1 and 44px targets. Check: visible focus rings on outlined elements (2px ink outline can hide the focus ring), win/loss not by color alone (keep ▲/▼ and Won/Lost words), reduced motion. |

**Overall:** Ticket stub is well-positioned. It matches the most credible 2026 visual trends (bold outlines, analog
metaphor, plain type) and avoids the most dated one in the category (dark neon sportsbook). The biggest gaps are not
visual. They are **social surfaces** (reactions, recaps, copy/run-it-back) and **share artifacts**.

---

## 4. Prioritized recommendations for Slate

Effort: S = under a day, M = a few days, L = a week or more / needs migration + pgTAP.

| # | What | Why | Effort | Screen |
|---|---|---|---|---|
| 1 | **Reactions on revealed picks**: a fixed set of 4–5 (🔥 😬 🫡 🤡 💀), one per user per pick, counts shown on the pick row; signal-only Realtime like today | Strava/Sleeper/Splash: low-effort reactions are the core social loop; already backlog #4. Needs a table + RLS + pgTAP proving no access before lock. | M | Leaderboard → PlayerBets dropdown |
| 2 | **Join link preview and join page polish**: OG image shows host name, game, "6 in · locks 7:10 PM", ghost stubs; join page shows live "who's in" avatars above the name field | Partiful: the invite page is the product; the SMS preview is the first impression. We already have `join/[code]/opengraph-image.tsx`; enrich it. | S–M | `/join/[code]` + OG |
| 3 | **BeReal-style ghost stubs before lock**: other players appear as dashed `ghost` stubs ("Sam · slip in ✓") with "Picks unlock at 7:10" | Turns the blind-picks constraint into suspense; reuses `stub("ghost")`. Must show only submitted/not, never pick counts if those are hidden by RLS. | S | Lobby / squad list |
| 4 | **Slip Receipt share card** (backlog #3): 9:16 for Stories and 1.91:1 for link preview, auto-titled ("4-leg Hail Mary"), receipt styling with perforation, logo mark | Wrapped: identity + one-tap share; Wordle: spoiler-free. Before lock, a receipt shows only "slip in, 5 picks, $100 at risk"; after reveal, the picks. | M | Post-reveal, final |
| 5 | **Plain-text result line** copy button: `slate · NYK@BOS · 2nd/7 · +$84 · 🟩🟩🟥⬜` | Wordle: pastes into any group chat without images; zero infra. | S | Final standings |
| 6 | **Make % chance the default for new phones**, American odds opt-in in Settings; first time odds appear, a one-line "60% = wins 6 times in 10" hint | Kalshi/Polymarket normalized %; our audience includes non-bettors. | S | Settings, game page, slip |
| 7 | **Net result line on finals**: "Started $1,000 → finished $1,084 (+$84)" per player | Focus State critique: show net, not just wins. Builds trust and fits plain-English rule. | S | Final leaderboard, receipt |
| 8 | **Run it back**: after final, host gets "Same squad, next game" that pre-fills create with the same rules and texts the same group | Splash recaps + Underdog copy loops; repeat rate is our beta metric (`npm run metrics`). | M | Final screen, host tools |
| 9 | **Moment badges** (backlog #4): Bad Beat (leg was 80%+ and missed), Survived, Cooked, shown as small ink stamps on the stub tear | Fliff/Underdog badges, Strava achievements; stamps extend the ticket metaphor. | M | Leaderboard rows, receipt |
| 10 | **Chance deltas during the sweat**: "+12% since lock" chip beside each chance bar, animated like prediction markets; "updated 20s ago" liveness line | Prediction-market liveness cues; makes the sweat feel live without more color. | S | PlayerBets dropdown |
| 11 | **Web push at 4 moments only**: 15 min to lock (if no slip), reveal, "one play away" (backlog #5), final | Our substitute for Live Activities; iOS PWAs support push once installed. Keep the list short to avoid notification fatigue. | M–L | Global |
| 12 | **Haptics as progressive enhancement**: odds tap, slip submit, reveal; `navigator.vibrate` on Android, switch-input trick on iOS, off under reduced motion | Tactile feedback is expected in 2025 apps; must never be the only signal. | S | Slip, reveal |
| 13 | **Reveal stamp moment**: keep the one-time full-screen "Picks are in!", add a single stamp/tear animation on each stub in sequence | Matches retro-analog trend; gives the reveal a signature motion without confetti overuse. | S | `reveal/picks-in-moment.tsx` |
| 14 | **Focus-visible audit**: ensure keyboard/AT focus is distinct from the 2px ink outline (e.g. 2px offset ring in `tab` blue) | Setproduct: brutalist UIs commonly lose focus states. | S | All outlined controls |
| 15 | **Lightweight in-tournament chat** (text + the same reactions), only if reactions show usage | Sleeper/Splash prove value, but it adds moderation and RLS scope. Do after #1 validates. | L | New tab or sheet |
| 16 | **iOS 26 install check**: verify maskable icon under Liquid Glass, theme-color / status bar, and update `install-hint.tsx` copy for the new Add to Home Screen path | iOS 26 changed web-app install steps and icon rendering. | S | Install hint, manifest |

Suggested order: 2, 3, 6, 7, 5 (all S, ship together as a "share and clarity" pass), then 1 and 4 (the social core),
then 8, 9, 10, then 11–16.

---

## 5. Sources

Comparable products
- Sleeper review (Saturday Down South): https://www.saturdaydownsouth.com/dfs/sleeper-fantasy/review
- Sleeper Picks rating/UX note (MobileGameRadar): https://mobilegameradar.pages.dev/games/sleeper-picks
- Sleeper on Google Play: https://play.google.com/store/apps/details?id=com.sleeperbot
- Sleeper on the App Store: https://apps.apple.com/us/app/sleeper-fantasy-sports/id987367543
- PrizePicks vs Underdog vs Sleeper (Stokastic, 2026): https://www.stokastic.com/articles/dfs-strategy/prizepicks-vs-underdog-vs-sleeper
- Sleeper 2025 kickoff outages (Pro Football Network): https://www.profootballnetwork.com/?p=1090219
- Sleeper "upcoming redesign" post: https://blog.sleeper.com/upcoming-redesign/
- Underdog Shared Picks / Squad Boost (help center): https://help.underdogsports.com/en/articles/13591258-shared-picks-squad-boost
- Underdog UI review (Stokastic): https://www.stokastic.com/learn-dfs/underdog-fantasy-app-user-interface-is-good-ac11
- Underdog business context (Sacra): https://sacra.com/c/underdog-fantasy/
- PrizePicks ways to pick: https://www.prizepicks.com/ways-to-pick
- PrizePicks 2-pick Flex: https://www.prizepicks.com/playbook-article/2-pick-flex-plays-on-prizepicks-hit-one-pick-get-paid
- "Winning by design: deceptive UX patterns and sports betting apps" (Focus State): https://focusstate.substack.com/p/winning-by-design-deceptive-ux-patterns
- Splash Sports on the App Store: https://apps.apple.com/us/app/splash-sports/id6451190245
- Splash acquires RunYourPool & OfficeFootballPool: https://splashsports.com/blog/splash-inc-acquires-runyourpool-officefootball-pool
- Splash Sports review (gambling.com): https://www.gambling.com/us/daily-fantasy/reviews/splash-sports
- Pikkit on the App Store: https://apps.apple.com/app/id1586567110
- Pikkit AI (Uncrate): https://uncrate.com/pikkit-bet-tracker-app/
- Fliff on the App Store: https://apps.apple.com/app/id1489145500
- Fliff review (TheLines): https://www.thelines.com/betting/social-sportsbooks/fliff/
- DraftKings Sportsbook Pools launch (Legal Sports Report): https://www.legalsportsreport.com/25720/draftkings-sportsbook-pools-launch/
- DraftKings Predictions app (SBC Americas): https://sbcamericas.com/2025/12/19/draftkings-official-prediction-markets/
- ESPN enhanced app guide (ESPN Front Row): https://www.espnfrontrow.com/2025/08/dtc-launch-week-a-sports-fans-guide-to-the-enhanced-espn-app/
- ESPN DTC app features (SVG): https://www.sportsvideo.org/2025/08/20/espns-revamped-dtc-app-delivers-multiview-live-game-stats-highlight-replays-and-much-more
- ESPN betting integration (Front Office Sports): https://frontofficesports.com/new-espn-app-to-feature-heavy-betting-integration/
- Apple Sports simplicity (MacRumors): https://www.macrumors.com/2024/02/21/apple-sports-app-simplicity/
- Apple Sports widget update (MacRumors, 2025): https://www.macrumors.com/2025/09/16/apple-sports-home-screen-widget/
- Apple Sports Live Activities update (9to5Mac, 2026): https://9to5mac.com/2026/10/15/apple-sports-update-improves-live-activity-support-adds-soccer-leagues-
- Apple Sports design critique (Lickability): https://lickability.com/blog/apple-sports/
- Apple Sports data design (Creative Boom): https://www.creativeboom.com/inspiration/this-new-app-from-apple-has-something-important-to-teach-us-about-designing-data/
- Chalk on Product Hunt: https://www.producthunt.com/products/chalk-waitlist/launches/chalk-4
- Real Ballers on the App Store: https://apps.apple.com/us/app/-/id6743679639
- Rebet launch (Business Wire): https://www.businesswire.com/news/home/20240318336969/en/Rebet-Launches-Free-to-Play-Social-Sportsbook
- Slips AI prediction markets (Webull news): https://www.webull.com/news/13498310044963840

Prediction markets and odds explanation
- Prediction market design patterns (Avark, May 2026): https://avark.agency/learn/prediction-market-design-patterns
- Prediction markets vs sports betting (SI): https://www.si.com/betting/prediction-market/prediction-markets-101/prediction-markets-vs-sports-betting
- Kalshi vs Polymarket (Action Network): https://www.actionnetwork.com/online-sports-betting/reviews/kalshi-vs-polymarket
- Prediction market odds explained (WSN): https://www.wsn.com/betting-guide/prediction-market-odds/

Group play and share loops
- Partiful marketing strategy (Nogood): https://nogood.io/blog/partiful-marketing-strategy/
- Partiful research (Sacra): https://sacra.com/research/partiful
- BeReal dissected (Bothrs): https://www.bothrs.com/story/dissecting-the-app-bereal
- The case for BeReal (UX Planet): https://uxplanet.org/the-case-for-bereal-3ec81224a37
- BeReal friends-of-friends (TechCrunch): https://techcrunch.com/2023/08/21/bereal-gets-more-social-with-friends-of-friends-feature
- Why Wordle went viral (Smithsonian): https://www.smithsonianmag.com/smart-news/heres-why-the-word-game-wordle-went-viral-180979439/
- Lessons PMs can learn from Wordle (Pendo): https://www.pendo.io/pendo-blog/3-lessons-product-managers-can-learn-from-wordle
- Understanding how athletes use the feed (Strava Design): https://medium.com/strava-design/understanding-how-athletes-use-the-feed-aae986eaa818
- Why athletes are hooked on Strava (UX Collective): https://uxdesign.cc/why-over-100-million-athletes-are-hooked-on-strava-545708e17552
- Spotify 2025 Wrapped (Spotify Newsroom): https://newsroom.spotify.com/?p=37817
- Spotify used Rive for Wrapped 2025: https://rive.app/blog/spotify-used-rive-for-spotify-wrapped-2025
- Spotify Wrapped viral loop playbook: https://brandperformance.substack.com/p/spotify-wrapped-the-viral-loop-playbook

Visual and platform trends
- Retro, brutalist and Y2K UI trends that work in 2026 (Setproduct): https://setproduct.com/blog/retro-brutalist-ui-design-2026
- 18 UI design trends for 2026 (daisyUI): https://trends.daisyui.com/ui-design-trends-2026/
- Neubrutalism overview (daisyUI): https://trends.daisyui.com/trend/neubrutalism/
- Web design trends (DesignRush): https://www.designrush.com/agency/website-design-development/trends/web-design-trends
- App design trends (Lyssna, June 2025): https://lyssna.com/blog/app-design-trends
- UI/UX trends 2026 (Apiko): https://apiko.com/blog/ux-design-trends/
- Safari changes on iOS 26 (MacRumors): https://www.macrumors.com/2025/06/18/safari-changes-on-ios-26/
- iOS 26 Safari features incl. web apps (iGeeksBlog): https://www.igeeksblog.com/safari-ios-26-macos-tahoe-features/
- PWA Liquid Glass icons (Progressier): https://intercom.help/progressier/en/articles/11579419-can-your-pwa-have-a-liquid-glass-icon
- Apple forum on PWA support in iOS 26: https://developer.apple.com/forums/thread/801602
- Haptic feedback on the web (Software Mansion): https://swmansion.com/blog/haptic-feedback-on-the-web-why-the-web-deliberately-refuses-to-be-as-tactile-as-native-apps
- WebHaptics browser support: https://www.mintlify.com/lochie/web-haptics/advanced/browser-support
