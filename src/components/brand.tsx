import Link from "next/link";
import { cn } from "@/lib/utils";

/** The Slate mark: a violet-to-coral tile with a bold white S (and a spark: the live sweat). */
export const LOGO_S = "M21.6 10.6c-1-1.8-3-2.8-5.5-2.8-3.1 0-5.4 1.7-5.4 4 0 5.7 11.4 3.1 11.4 8.7 0 2.5-2.4 4.2-5.8 4.2-2.6 0-4.7-1.1-5.8-3";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <defs>
        <linearGradient id="slate-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--hype)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#slate-mark)" />
      <path d={LOGO_S} fill="none" stroke="white" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="24.8" cy="7.4" r="1.7" fill="white" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-[1.4rem] font-extrabold tracking-tight">
        slate<span className="text-hype">.</span>
      </span>
    </span>
  );
}

/** Top row on every screen: home link + an optional right slot (account, code…). */
export function AppBar({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-11 items-center justify-between gap-3", className)}>
      <Link href="/" aria-label="Slate home" className="-ml-1 rounded-lg px-1 py-1">
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
    <Tag className={cn("font-display text-[2.4rem]/[1] font-extrabold tracking-tight text-balance", className)}>
      {children}
    </Tag>
  );
}
