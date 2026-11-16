# Slate design system: "Ticket stub"

Light-only, mobile-first (design at 375px). Sleek and calm: warm white paper, black ink, and one coral spark. Every
tournament and every player row is a ticket stub with a tear-off side holding the result. It should feel like a
friends' game night, not a sportsbook.
(Changed 2026-11-08 from the dark violet "Game night" look, which felt heavy. See CHANGELOG.md.)

Words: say what it means. "Winner" not "Moneyline", "Celtics to win" not "Celtics ML", "Games" not "Board".
Every tournament explains itself in plain English (`src/lib/plain-english.ts`), and odds can show as a % chance.

Tokens live in `src/app/globals.css`. Brand primitives live in `src/components/brand.tsx`. Run the
visual tour after any UI change:
`SCREENS=./screens npx playwright test e2e/screens.spec.ts` (includes a 375px team-mark gallery).

## Color: semantic tokens only
Never use raw palette classes (`emerald-400`, `amber-300`, `text-black`). Use these:

| Token | Use |
|---|---|
| `background` | warm paper page (flat, no glow) |
| `card` | white: cards, stubs, inputs' container |
| `surface-2` | faint warm gray: raised chips inside cards, odds buttons, the back of a stub |
| `muted-foreground` | secondary text, labels |
| `brand` / `brand-foreground` | **ink**: the one action and money color. Primary buttons, bankroll, selected odds. White text on it. |
| `tab` | **light blue**: only the selected tab of a segmented control (with an ink outline, bold text and underline). |
| `hype` / `hype-foreground` | **coral**: the single spark. Logo slash, 1st place, live dot, reveal, celebrations. |
| `win` / `loss` | outcome colors (price moved up/down, graded legs, ▲/▼ on the leaderboard). |
| `warn` | lock state, odds-changed prompts, host tools accent. |
| `chart-1…5` | ordered series (consensus sides, future charts). |
| `destructive` | removing/cancelling. |

Rules:
- **Bold, black and white.** Everything you can tap has a 2px ink outline (`border-2 border-foreground`): odds,
  outline/secondary buttons, inputs, stubs, tabs, sheet rows. Selected = solid ink. Static info keeps hairlines.
  No colored buttons; color is for meaning (win/loss/warn), team names (`readableTeamColor`), and the selected tab.
- Only one brand (black) button per view. Second actions use `secondary` or `outline`; dangerous ones use a
  `warn` ring or `destructive`.
- Tints are token/alpha: `bg-hype/12 ring-hype/30`. Brand tints now read as gray washes, which is intended.
- **Contrast:** text must pass 4.5:1 on white. Coral is too light for small text: use it for fills, icons, dots and
  large numbers (1st place), and keep small labels ink on a coral tint.

## Type
- **Display** (`font-display`, Barlow Condensed 600–800) is for page titles (`<DisplayTitle>`), section
  headlines, team names on the board, and slip/reveal headings. Titles are sentence case (calmer); small
  section heads may stay uppercase.
  - Set size and leading together (`text-[2.4rem]/[1]`). The class merger drops a separate
    `leading-*` after a size.
- **Numerals** (`num` utility: display face + tabular figures) is for odds, money, counts and
  countdowns. Exception: letters that look like digits in that face (the O/U on totals) use the body font.
- **Body** (Geist) is for everything else, including player names on the leaderboard. Labels use `<Eyebrow>`
  (xs, semibold, wide tracking, uppercase).

## Shape and depth
- Cards: `rounded-2xl bg-card` with a 1px `border-border` hairline. No shadows, no glow.
- **Stubs** (`stub(variant)` + `<StubTear>` in brand.tsx): a card split by a dashed perforation with two punched
  notches (the `.stub` mask). The tear-off side (`--tear`, 5.5rem; wider for money) holds the result: a place, money,
  or a status. Variants: `you` (ink outline), `ghost` (dashed, see-through: placeholders and teasers);
  `<StubTear winner>` is coral for 1st. Expanded content slides out under the stub on `surface-2`.
- Pills and chips: `rounded-full`. Tap targets ≥ 44px. Primary CTAs are `h-14`; odds buttons are `h-13`.
- Segmented controls (`<TabSwitch>`): selected = `bg-foreground text-background` pill.
- Bottom sheets (Drawer) for every secondary flow: slip, edit rules, confirmations.

## Picks dropdown (leaderboard rows)
A white box per game (matchup header in team colors, picks, then a mini scoreboard); each parlay gets its own box.
Every open pick: label (team name in its color), `$stake → $return`, a black chance bar + % + an (i) that explains
the % (`chanceExplainer`). Totals: the bar fills with points toward the line (tick at the end) + "120 points · needs
99 more"; finals show "Final: 239 points" and Won/Lost. No Safe/Sweating/Danger words, no "down by" lines.

## Motion
- `tw-animate-css` entrances (`animate-in fade-in slide-in-from-bottom-2`), staggered ~60–70ms, always
  behind `motion-safe:`. The home catchphrase underline draws in once (`.swash`); the live dot pulses (`.live-dot`).
- Buttons squish on press (`motion-safe:active:scale-[0.96]`, built into `buttonVariants`).
- Money counts to its new value (`<Ticker>`, ~0.6s). Leaderboard rows glide to new places on rank changes (FLIP in
  `useRowGlide`) and climbers get a "▲2" chip for 4s.
- Tapping odds tosses a small ink chip straight into the slip's count bubble, which bumps (`src/lib/fly.ts`).
- Home only: the logo slash wiggles once (`<AppBar wiggle>`); the example join code types itself out.
- Odds flash `win`/`loss` on Realtime moves. The reveal and the champion (final) each get one full-screen moment
  per device; confetti is hidden for reduced motion.

## Brand
- Wordmark: lowercase "slate" in the display face plus a forward-leaning coral slash (a tally mark), no tile
  (`<Wordmark>`). Mark for icons and share cards: ink "s" + coral slash (`<LogoMark>`, paths `LOGO_S` / `LOGO_SLASH`).
  Regenerate app icons with `node scripts/make-icons.mjs` after changing the mark.
- No league or team logos (trademarks). Use names, abbreviations, and emoji sport markers.

## Team marks

Generic gear identifies the sport without league or team logos: NFL helmet, NBA tank jersey,
NHL sweater, MLB cap. Gear follows the sport, not the level: college football gets the helmet
(cartoon side profile: crown stripe and one-bar facemask in the second color, tan when that color is
near-white or near-black), college basketball the jersey. Unknown teams or sports use an
ink-gray shield; never generate random team colors. College coverage follows local seed/events
(currently no college teams), with unknown college teams using the same neutral shield.

`src/lib/teams/registry.ts` is the single identity source. Resolve normalized names, aliases and
abbreviations within the event's sport key. Inline registry team colors are an intentional exception
to semantic color tokens. Primary fills the gear, secondary supplies trim, and the silhouette has a
1.7px ink outline. Swap fill and trim when primary contrast against white is below 1.5:1; nearly
identical colors use ink trim. Team-name text still requires 4.5:1 contrast. No gradients or shadows.

These are generic silhouettes, never team logos. Before monetizing, have a trademark attorney
review the use of team names and colors. Compare colors manually with the development-only
`scripts/verify-team-colors.mjs`; ESPN alternate colors are not automatically authoritative.

## Token slip

Token tournaments use felt (oklch(0.33 0.06 165)) for the sheet, felt-deep (oklch(0.28 0.05 165)) for rows, felt-foreground (oklch(0.97 0.02 90)) for cream text and chip faces, and felt-muted (oklch(0.86 0.03 150)) for secondary text. These are distinct from win. The sheet is at most 70dvh with a scrolling list. Cream selected pills and CTA are the exception to ink selected fills and blue tabs. Chips are 54px with an ink outline, dashed inner ring and 3px ink lip; slots and controls are at least 44px. Assigned chips remain ghosted across mode switches in a shared pool. Partial submissions leave unchipped picks on the slip. Chip motion uses motion-safe; focus rings stay visible.
