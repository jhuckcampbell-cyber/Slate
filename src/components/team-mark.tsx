import { teamLook } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

/**
 * A tiny helmet (football) or jersey (basketball) in a team's colors, next to players and teams so it's obvious who
 * plays for whom. Colors only, no logos. Decorative: the team's name is always in the text beside it.
 */
export function TeamMark({ team, sportKey, className }: { team: string; sportKey?: string; className?: string }) {
  const look = teamLook(team, sportKey);
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-6 shrink-0", className)}
      data-team={team}
    >
      {look.kind === "helmet" ? (
        <>
          {/* Shell, facing right, with a stripe, ear hole and face mask. */}
          <path
            d="M2.8 13.6C2.8 8.4 7 4.3 12.3 4.3c4.5 0 8.3 3.1 9 7.4l.2 1.5h-6.4c-.9 0-1.6.7-1.6 1.6v.6c0 .9.7 1.6 1.6 1.6h5.1v1.4c0 1-.8 1.8-1.8 1.8H9.3c-3.6 0-6.5-2.9-6.5-6.6Z"
            fill={look.primary}
            stroke="rgb(255 255 255 / 0.55)"
            strokeWidth="0.9"
            strokeLinejoin="round"
          />
          <path d="M6.6 6.4c2.7-1.6 6.6-1.8 9.5.1" fill="none" stroke={look.secondary} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="10" cy="13.3" r="1.4" fill={look.secondary} />
          <path d="M15.2 13.2H22M17.3 13.2v5M19.8 13.2v5" fill="none" stroke="#e5e7eb" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Tank-top jersey with trim and a number stripe. */}
          <path
            d="M7.6 3h2.6a1.8 1.8 0 0 0 3.6 0h2.6l.5 3c.1.7.7 1.2 1.4 1.2h.9V21H4.8V7.2h.9c.7 0 1.3-.5 1.4-1.2l.5-3Z"
            fill={look.primary}
            stroke={look.secondary}
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M8.5 12.5h7" stroke={look.secondary} strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
