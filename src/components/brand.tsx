import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Slate mark: an ink "s" and a coral slash (a tally mark: one more for the group) on a white tile.
 * The tile only exists for app icons, the install tip and share cards; in the app bar the wordmark stands alone.
 * Keep both paths in sync with scripts/make-icons.mjs.
 */
export const LOGO_S = "M18.6 10.6c-1-1.8-3-2.8-5.5-2.8-3.1 0-5.4 1.7-5.4 4 0 5.7 11.4 3.1 11.4 8.7 0 2.5-2.4 4.2-5.8 4.2-2.6 0-4.7-1.1-5.8-3";
export const LOGO_SLASH = "M21.8 25.2 26.4 7.6";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="white" stroke="var(--border)" strokeWidth="1" />
      <path d={LOGO_S} fill="none" stroke="var(--foreground)" strokeWidth="3.4" strokeLinecap="round" />
      <path d={LOGO_SLASH} fill="none" stroke="var(--hype)" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  );
}

/** "slate/": lowercase wordmark in the display face, then a forward-leaning coral slash, heavier than the letters. */
export function Wordmark({ className, wiggle = false }: { className?: string; wiggle?: boolean }) {
  return (
    <span className={cn("inline-flex items-baseline font-display text-[1.6rem]/none font-extrabold tracking-tight", className)}>
      slate
      <svg
        viewBox="0 0 10 24"
        aria-hidden
        className={cn("ml-[0.06em] h-[0.95em] w-[0.4em] translate-y-[0.12em] self-end", wiggle && "slash-wiggle")}
      >
        <path d="M2.4 21.6 7.6 2.4" fill="none" stroke="var(--hype)" strokeWidth="3.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Top row on every screen: home link + an optional right slot (account, code…). */
export function AppBar({
  children,
  className,
  wiggle = false,
}: {
  children?: React.ReactNode;
  className?: string;
  /** Home only: the logo slash wiggles once on open. */
  wiggle?: boolean;
}) {
  return (
    <div className={cn("flex h-11 items-center justify-between gap-3", className)}>
      <Link href="/" aria-label="Slate home" className="-ml-1 rounded-lg px-1 py-1">
        <Wordmark wiggle={wiggle} />
      </Link>
      {children && <div className="flex min-w-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** Small uppercase label above titles and sections. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase", className)}>
      {children}
    </p>
  );
}

/** Page headline in the scoreboard face. */
export function DisplayTitle({
  children,
  className,
  as: Tag = "h1",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <Tag className={cn("font-display text-[2.4rem]/[1] font-extrabold tracking-tight text-balance", className)}>
      {children}
    </Tag>
  );
}

/**
 * Ticket stub: a white card with a tear-off side on the right, split by a dashed perforation with two punched
 * notches (the `.stub` mask in globals.css). Compose it on any element (Link, summary, div):
 *   <Link className={stub()}> <div className="min-w-0 flex-1">…</div> <StubTear>1st</StubTear> </Link>
 * Variants: `you` (ink outline), `ghost` (dashed, see-through: placeholders and teasers).
 */
export type StubVariant = "default" | "you" | "ghost";

export function stub(variant: StubVariant = "default", className?: string) {
  return cn(
    "stub relative flex min-h-16 items-stretch rounded-2xl",
    variant === "default" && "border-2 border-foreground bg-card",
    variant === "you" && "border-[3px] border-foreground bg-card",
    variant === "ghost" && "border-2 border-dashed border-foreground/40 bg-transparent",
    className,
  );
}

/** The tear-off side of a stub: the result (a place, money, a status), behind the perforation. */
export function StubTear({
  children,
  winner = false,
  className,
}: {
  children: React.ReactNode;
  /** Coral side with white text: 1st place. */
  winner?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-(--tear) shrink-0 flex-col items-center justify-center border-l-2 border-dashed border-foreground/35 px-1.5 text-center",
        winner && "rounded-r-[calc(var(--radius-2xl)-2px)] border-l-hype bg-hype text-hype-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Result mark with an ink outline; coral labels keep readable ink text. */
export function Stamp({ children, tone = "ink", className }: {
  children: React.ReactNode;
  tone?: "ink" | "hype" | "win" | "loss";
  className?: string;
}) {
  return <span className={cn(
    "inline-block -rotate-6 rounded-sm border-2 border-foreground px-2 py-0.5 font-display text-xl/none font-extrabold tracking-wider uppercase",
    tone === "ink" && "text-foreground",
    tone === "hype" && "bg-hype/15 text-foreground",
    tone === "win" && "text-win",
    tone === "loss" && "text-loss",
    className,
  )}>{children}</span>;
}

/** Preserve the code verbatim, including leading zeroes. */
export function TicketSerial({ code, className }: { code: string; className?: string }) {
  return <span className={cn("num text-xs tracking-widest text-muted-foreground", className)}>No. {code}</span>;
}
