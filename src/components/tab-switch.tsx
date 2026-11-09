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
      className={cn("grid gap-1 rounded-full border-2 border-foreground bg-card p-1 text-sm", className)}
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
            "h-11 rounded-full border-2 transition-colors motion-safe:active:scale-[0.97]",
            value === o.value
              ? "border-foreground bg-tab font-bold text-foreground underline decoration-2 underline-offset-4"
              : "border-transparent font-semibold text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
