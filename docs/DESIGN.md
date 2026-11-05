# Slate design system: "Game night"

Dark-only, mobile-first (design at 375px). It should feel like watching the game with friends, not like a sportsbook:
an ink-navy base, a soft violet-and-coral glow, one action color, plain words, and scoreboard type for numbers.
(Changed 2026-11-05 from the volt-lime "Night game" look, which read like DraftKings. See CHANGELOG.md.)

Words: say what it means. "Winner" not "Moneyline", "Celtics to win" not "Celtics ML", "Games" not "Board".
Every tournament explains itself in plain English (`src/lib/plain-english.ts`), and odds can show as a % chance.

Tokens live in `src/app/globals.css`. Brand primitives live in `src/components/brand.tsx`. Run the
visual tour after any UI change:
`SCREENS=./screens npx playwright test e2e/screens.spec.ts` (writes 13 iPhone 15 screenshots).

## Color: semantic tokens only
Never use raw palette classes (`emerald-400`, `amber-300`, `text-black`). Use these:

| Token | Use |
|---|---|
| `background` | page (with the fixed glow on `body`) |
| `card` | cards, tiles, inputs' container |
| `surface-2` | raised elements inside cards (odds buttons, kickoff chips), disabled buttons |
| `muted-foreground` | secondary text, labels |
| `brand` / `brand-foreground` | **electric violet**: the one action and money color. Primary buttons, bankroll, potential returns, selected odds. White text on it. |
| `hype` / `hype-foreground` | **coral**: social moments that aren't money. The reveal, inviter avatars, celebrations. |
| `win` / `loss` | outcome colors (price moved up/down, graded legs). |
| `warn` | lock state, odds-changed prompts, host tools accent. |
| `chart-1…5` | ordered series (consensus sides, future charts). |
| `destructive` | removing/cancelling. |

Rules:
- Only one brand button per view. Second actions use `secondary` or `outline`; dangerous ones use a
  `warn` ring or `destructive`.
- Tints are token/alpha: `bg-brand/10 ring-brand/30`, `from-hype/25`.

## Type
- **Display** (`font-display`, Barlow Condensed 600–800) is for page titles (`<DisplayTitle>`), section
  headlines, team names on the board, and slip/reveal headings. Page titles are sentence case (calmer); small
  section heads may stay uppercase.
  - Set size and leading together (`text-[2.4rem]/[1]`). The class merger drops a separate
    `leading-*` after a size.
- **Numerals** (`num` utility: display face + tabular figures) is for odds, money, counts and
  countdowns. Exception: letters that look like digits in that face (the O/U on totals) use the body font.
- **Body** (Geist) is for everything else. Labels use `<Eyebrow>` (xs, semibold, wide tracking, uppercase).

## Shape and depth
- Cards: `rounded-2xl bg-card ring-1 ring-border` (ring, not border). Pills and chips: `rounded-full`.
- Tap targets ≥ 44px. Primary CTAs are `h-14`; odds buttons are `h-13`.
- Segmented controls (`<TabSwitch>`): selected = `bg-foreground text-background` pill.
- Bottom sheets (Drawer) for every secondary flow: slip, edit rules, confirmations.

## Motion
- `tw-animate-css` entrances (`animate-in fade-in slide-in-from-bottom-3`), staggered ~70ms, always
  behind `motion-safe:`.
- Odds flash `win`/`loss` on Realtime moves. The reveal and the champion (final) each get one full-screen moment
  per device; confetti is hidden for reduced motion.

## Brand
- Mark: a violet-to-coral rounded tile with a bold white S and a spark (`<LogoMark>`, path `LOGO_S`). Wordmark:
  lowercase "slate" + coral dot. Regenerate app icons with `node scripts/make-icons.mjs` after changing the mark.
- No league or team logos (trademarks). Use names, abbreviations, and emoji sport markers.
