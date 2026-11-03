"use client";

import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: React.ReactNode };

/** Segmented control (ARIA tablist) used for the sportsbook and reveal views. */
export function TabSwitch<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("grid rounded-xl bg-card p-1 text-sm ring-1 ring-border", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-10 rounded-lg font-semibold transition-colors",
            value === o.value ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
