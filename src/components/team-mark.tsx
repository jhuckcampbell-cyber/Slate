import { markColors, teamLook, type Gear } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

const SHAPES: Record<Gear, { body: string; trim: string }> = {
  helmet: { body: "M3 14C3 8 7 4 12 4c5 0 9 4 9 9h-6v4h5v3H9c-4 0-6-3-6-6Z", trim: "M8 6c3-1 6-1 9 1M16 14h6v5h-6M10 12v3" },
  jersey: { body: "M7 3h3c0 3 4 3 4 0h3l1 5h2v13H4V8h2Z", trim: "M8 4c0 5 8 5 8 0M5 19h14M6 8l1 3M18 8l-1 3" },
  sweater: { body: "M8 4h8l3 3 3 9-4 2-2-5v8H8v-8l-2 5-4-2 3-9Z", trim: "M9 5l3 3 3-3M8 18h8M3 14l4 2M17 16l4-2" },
  cap: { body: "M3 15v-3a8 8 0 0 1 16 0v3l3 3c-6 3-14 2-19-3Z", trim: "M4 15h14M12 5c-3 2-4 5-4 9M18 15l3 3" },
  pennant: { body: "M4 22V3l17 4-17 9Z", trim: "M6 6l9 2-9 5" },
  shield: { body: "M4 3h16v9c0 5-5 8-8 10-3-2-8-5-8-10Z", trim: "M8 7h8M8 11h8" },
};
/** Generic gear, never logos. Registry colors are the inline semantic-token exception. */
export function TeamMark({ team, sportKey, className }: { team: string; sportKey?: string; className?: string }) {
  const look = teamLook(team, sportKey);
  const { fill, trim } = markColors(look);
  const shape = SHAPES[look.kind];
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6 shrink-0", className)} data-team={team} data-gear={look.kind}>
      <path d={shape.body} fill={fill} stroke="#181a21" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <path d={shape.trim} fill="none" stroke={trim} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
