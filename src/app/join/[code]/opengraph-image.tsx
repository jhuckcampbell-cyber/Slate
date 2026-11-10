import { LOGO_S, LOGO_SLASH } from "@/components/brand";
import { ImageResponse } from "next/og";
import { normalizeCode } from "@/lib/core/codes";
import { formatCents, sportEmoji, sportLabel } from "@/lib/format";
import { whosIn } from "@/lib/plain-english";
import { getTournamentPreview } from "@/lib/supabase/public";

export const alt = "Slate tournament invite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#fbfaf7";
const INK = "#181a21";
const MUTED = "#6b6e78";
const TEAR = 330;

// Rich SMS/iMessage preview, drawn as a ticket stub: the invite on the left, the lock time on the black tear-off.
// Viewer TZ is unknown server-side, so times are shown in ET.
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const t = await getTournamentPreview(code);

  const title = t?.title ?? "Slate";
  const events = t?.events.slice(0, 3) ?? [];
  const more = (t?.events.length ?? 0) - events.length;
  const lock = t ? lockParts(t.lock_time) : null;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PAPER, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 60, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34 }}>
            <svg width="52" height="52" viewBox="0 0 32 32">
              <path d={LOGO_S} fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
              <path d={LOGO_SLASH} fill="none" stroke="#e2553a" strokeWidth="3.6" strokeLinecap="round" />
            </svg>
            <span style={{ fontWeight: 800 }}>slate</span>
            {t && <span style={{ color: MUTED }}>· {sportLabel(t.sport_key)}</span>}
          </div>

          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, marginTop: 26, lineHeight: 1.05 }}>
            {t ? `${sportEmoji(t.sport_key)} ${title}` : "Tournament not found"}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 22, gap: 6, fontSize: 30, color: "#3f424b" }}>
            {events.map((e) => (
              <div key={e.id} style={{ display: "flex" }}>
                {e.away_team} @ {e.home_team}
              </div>
            ))}
            {more > 0 && <div style={{ display: "flex", color: MUTED }}>+{more} more</div>}
          </div>

          {t && (
            <div style={{ display: "flex", marginTop: "auto", fontSize: 32, color: "#3f424b" }}>
              <span style={{ fontWeight: 800, color: INK }}>{whosIn(t.host_name, t.participant_count)}</span>
              <span>&nbsp;· {formatCents(t.starting_bankroll_cents)} play money each</span>
            </div>
          )}
        </div>

        {t && lock && (
          <div
            style={{
              width: TEAR,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: INK,
              color: PAPER,
              borderLeft: `6px dashed ${PAPER}`,
              padding: "0 24px",
              textAlign: "center",
              position: "relative",
            }}
          >
            <span style={{ fontSize: 24, letterSpacing: 4, opacity: 0.75 }}>PICKS LOCK</span>
            <span style={{ fontSize: 30, fontWeight: 700, marginTop: 14 }}>{lock.day}</span>
            <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 1 }}>{lock.time}</span>
            <span style={{ fontSize: 28, opacity: 0.75, marginTop: 8 }}>{lock.zone}</span>
            {/* punched notches on the perforation */}
            <div style={{ position: "absolute", left: -38, top: -36, width: 72, height: 72, borderRadius: 999, background: PAPER }} />
            <div style={{ position: "absolute", left: -38, bottom: -36, width: 72, height: 72, borderRadius: 999, background: PAPER }} />
          </div>
        )}
      </div>
    ),
    size,
  );
}

/** Lock time in US Eastern, split for the tear-off: { day: "Tue", time: "7:10", zone: "PM EST" }. */
function lockParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("weekday"), time: `${get("hour")}:${get("minute")}`, zone: `${get("dayPeriod")} ${get("timeZoneName")}` };
}
