import { describe, expect, it } from "vitest";
import { finishLabel, orderMyTournaments, tournamentStatusLabel, type MyTournament } from "./my-tournaments";

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

describe("finishLabel: how you did, for past tournaments", () => {
  it("place out of the field", () => {
    expect(finishLabel(1, 5)).toBe("🏆 Won");
    expect(finishLabel(2, 5)).toBe("2nd of 5");
    expect(finishLabel(3, 3)).toBe("3rd of 3");
    expect(finishLabel(11, 12)).toBe("11th of 12");
    expect(finishLabel(22, 30)).toBe("22nd of 30");
  });
  it("unknown: nothing", () => {
    expect(finishLabel(null, 5)).toBeNull();
  });
});
