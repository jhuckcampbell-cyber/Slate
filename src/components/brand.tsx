import Link from "next/link";
import { cn } from "@/lib/utils";

/** Ticket-stub mark: a bet slip with two notches and three pick lines. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <path
        fill="var(--brand)"
        d="M7 3h18a3 3 0 0 1 3 3v6.5a3.5 3.5 0 0 0 0 7V26a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6.5a3.5 3.5 0 0 0 0-7V6a3 3 0 0 1 3-3Z"
      />
      <path
        stroke="var(--brand-foreground)"
        strokeWidth="2.6"
        strokeLinecap="round"
        d="M10 10.5h12M10 16h8M10 21.5h10"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-xl font-extrabold tracking-wide uppercase italic">
        Squad<span className="text-brand">Bets</span>
      </span>
    </span>
  );
}

/** Top row on every screen: home link + an optional right slot (account, code…). */
export function AppBar({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-11 items-center justify-between gap-3", className)}>
      <Link href="/" aria-label="SquadBets home" className="-ml-1 rounded-lg px-1 py-1">
        <Wordmark />
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
    <Tag className={cn("font-display text-[2.6rem]/[0.95] font-extrabold tracking-tight text-balance uppercase", className)}>
      {children}
    </Tag>
  );
}
