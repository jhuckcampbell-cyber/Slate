import { helmetMaskColor, markColors, teamLook, type Gear } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

const INK = "#181a21";

/**
 * Cartoon side-profile football helmet (NFL + college football) on a 50-unit grid:
 * shell in the team color, crown stripe + one-bar facemask in the second color (tan when that would vanish),
 * ear hole and a white shine. Strokes are sized so they render ~1.7px at the default 24px.
 */
const HELMET = {
  shell: "M8.6 38.6C3.6 33.6 2.4 24.6 5.4 17.2 8.6 9.4 16.4 4.4 25.4 4.8 32.6 5.2 38 9.6 39.6 16L39.8 18.4 34.6 20.4C32.4 21.4 31.2 23.6 31.4 26.4L32.2 31C34.2 32 35.4 33.6 35.4 35.6 31 39.2 23.4 39.8 18.2 38.2 14.8 37.2 12 39 8.6 38.6Z",
  stripe: "M13.4 15.6C16.8 11.6 21 9.8 26 10 31 10.2 34.6 12.4 36.6 15.6",
  mask: "M39.6 18.2C43.4 18 46.4 20 46.8 23.8 47.2 28 45.4 32.6 42.2 35.2 40 36.8 37.4 36.6 35.2 35.6M32.8 27.4C37.6 27.4 42.4 27.4 47 26.8",
  shine: "M8.4 27C8.4 23 9.6 19.6 11.6 17",
};
const line = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Helmet({ fill, trim }: { fill: string; trim: string }) {
  const mask = helmetMaskColor(trim);
  return (
    <>
      <path d={HELMET.shell} fill={fill} />
      <path d={HELMET.stripe} {...line} stroke={INK} strokeWidth="9" />
      <path d={HELMET.stripe} {...line} stroke={trim} strokeWidth="4" />
      <path d={HELMET.shell} fill="none" stroke={INK} strokeWidth="3.6" strokeLinejoin="round" />
      <path d={HELMET.shine} {...line} stroke="white" strokeWidth="2.9" opacity="0.9" />
      <circle cx="10.4" cy="30.4" r="1.6" fill="white" opacity="0.9" />
      <ellipse cx="24.4" cy="29" rx="2.9" ry="2.1" transform="rotate(-15 24.4 29)" fill="#f7f1de" stroke={INK} strokeWidth="2.9" />
      <path d={HELMET.mask} {...line} stroke={INK} strokeWidth="7.3" />
      <path d={HELMET.mask} {...line} stroke={mask} strokeWidth="2.6" data-mask={mask} />
    </>
  );
}

/** body = team color, trim = second color. The helmet has its own drawing (above). */
const SHAPES: Record<Exclude<Gear, "helmet">, { body: string; trim: string }> = {
  jersey: { body: "M7 3h3c0 3 4 3 4 0h3l1 5h2v13H4V8h2Z", trim: "M8 4c0 5 8 5 8 0M5 19h14M6 8l1 3M18 8l-1 3" },
  sweater: { body: "M8 4h8l3 3 3 9-4 2-2-5v8H8v-8l-2 5-4-2 3-9Z", trim: "M9 5l3 3 3-3M8 18h8M3 14l4 2M17 16l4-2" },
  cap: { body: "M3 15v-3a8 8 0 0 1 16 0v3l3 3c-6 3-14 2-19-3Z", trim: "M4 15h14M12 5c-3 2-4 5-4 9M18 15l3 3" },
  shield: { body: "M4 3h16v9c0 5-5 8-8 10-3-2-8-5-8-10Z", trim: "M8 7h8M8 11h8" },
};
/** Generic gear, never logos. Registry colors are the inline semantic-token exception. */
export function TeamMark({ team, sportKey, className }: { team: string; sportKey?: string; className?: string }) {
  const look = teamLook(team, sportKey);
  const { fill, trim } = markColors(look);
  const props = { "aria-hidden": true, className: cn("size-6 shrink-0", className), "data-team": team, "data-gear": look.kind };
  if (look.kind === "helmet") {
    return <svg viewBox="0 -1 50 50" {...props}><Helmet fill={fill} trim={trim} /></svg>;
  }
  const shape = SHAPES[look.kind];
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path d={shape.body} fill={fill} stroke={INK} strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <path d={shape.trim} fill="none" stroke={trim} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
