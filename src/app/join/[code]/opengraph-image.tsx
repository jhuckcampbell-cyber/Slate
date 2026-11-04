import { ImageResponse } from "next/og";
import { normalizeCode } from "@/lib/core/codes";
import { formatCents, formatKickoff, sportEmoji, sportLabel } from "@/lib/format";
import { getTournamentPreview } from "@/lib/supabase/public";

export const alt = "Slate tournament invite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Rich SMS/iMessage preview card. Viewer TZ is unknown server-side, so times are shown in ET.
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const t = await getTournamentPreview(code);

  const title = t?.title ?? "Slate";
  const events = t?.events.slice(0, 3) ?? [];
  const more = (t?.events.length ?? 0) - events.length;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 64,
          background: "linear-gradient(135deg, #0a0a0a 0%, #052e1f 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: "#34d399" }}>
          <span style={{ fontWeight: 800, letterSpacing: 4 }}>SLATE</span>
          {t && <span style={{ color: "#a3a3a3" }}>· {sportLabel(t.sport_key)}</span>}
        </div>

        <div style={{ display: "flex", fontSize: 76, fontWeight: 800, marginTop: 28, lineHeight: 1.05 }}>
          {t ? `${sportEmoji(t.sport_key)} ${title}` : "Tournament not found"}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 28, gap: 8, fontSize: 32, color: "#d4d4d4" }}>
          {events.map((e) => (
            <div key={e.id} style={{ display: "flex" }}>
              {e.away_team} @ {e.home_team}
            </div>
          ))}
          {more > 0 && <div style={{ display: "flex", color: "#a3a3a3" }}>+{more} more</div>}
        </div>

        {t && (
          <div style={{ display: "flex", marginTop: "auto", gap: 24, fontSize: 30 }}>
            <Pill label={`${formatCents(t.starting_bankroll_cents)} play money`} />
            <Pill label={`${t.participant_count} in`} />
            <Pill label={`🔒 ${formatKickoff(t.lock_time, "America/New_York")}`} />
          </div>
        )}
      </div>
    ),
    size,
  );
}

function Pill({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: "12px 24px",
        borderRadius: 999,
        background: "rgba(52, 211, 153, 0.15)",
        border: "2px solid rgba(52, 211, 153, 0.5)",
      }}
    >
      {label}
    </div>
  );
}
