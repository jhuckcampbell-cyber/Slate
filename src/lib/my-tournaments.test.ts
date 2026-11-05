import { describe, expect, it } from "vitest";
import { orderMyTournaments, tournamentStatusLabel, type MyTournament } from "./my-tournaments";

const t = (code: string, status: string, lockTime: string): MyTournament => ({
  code,
  title: code,
  sportKey: "americanfootball_nfl",
  status,
  lockTime,
  isHost: false,
});

describe("orderMyTournaments", () => {
  it("puts tournaments still in play first (soonest lock first), finished ones last (newest first)", () => {
    const list = [
      t("OLD", "settled", "2026-11-01T00:00:00Z"),
      t("LATER", "open", "2026-11-09T00:00:00Z"),
      t("LIVE", "live", "2026-11-05T00:00:00Z"),
      t("NEWER", "settled", "2026-11-03T00:00:00Z"),
      t("SOON", "open", "2026-11-06T01:15:00Z"),
    ];
    expect(orderMyTournaments(list).map((x) => x.code)).toEqual(["LIVE", "SOON", "LATER", "NEWER", "OLD"]);
  });
});

describe("tournamentStatusLabel", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("says where each one stands", () => {
    expect(tournamentStatusLabel(t("A", "open", "2026-11-06T01:15:00Z"), now)).toBe("Open");
    expect(tournamentStatusLabel(t("A", "open", "2026-11-05T11:00:00Z"), now)).toBe("Locked"); // past lock, cron not run yet
    expect(tournamentStatusLabel(t("A", "locked", "2026-11-05T11:00:00Z"), now)).toBe("Locked");
    expect(tournamentStatusLabel(t("A", "live", "2026-11-05T11:00:00Z"), now)).toBe("Live");
    expect(tournamentStatusLabel(t("A", "settled", "2026-11-05T11:00:00Z"), now)).toBe("Final");
  });
});
