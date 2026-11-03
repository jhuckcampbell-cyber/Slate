import { describe, expect, it } from "vitest";
import { applyOddsChange, indexBoard, movementFor, toBoardRow, type BoardRow } from "./board";

const base: BoardRow = toBoardRow({
  id: 1,
  event_id: "e1",
  market_key: "spreads",
  outcome_name: "Boston Celtics",
  participant_name: "",
  point: -7,
  price_american: -110,
  updated_at: "2026-11-03T12:00:00Z",
  is_stale: false,
});

function update(patch: Partial<{ point: number | string | null; price_american: number | string }>) {
  return {
    eventType: "UPDATE" as const,
    new: {
      id: "1",
      event_id: "e1",
      market_key: "spreads",
      outcome_name: "Boston Celtics",
      participant_name: "",
      point: -7,
      price_american: -110,
      updated_at: "2026-11-03T12:10:00Z",
      is_live: false,
      ...patch,
    },
  };
}

describe("applyOddsChange", () => {
  it("updates a moved price and flags the direction", () => {
    const [row] = applyOddsChange([base], update({ price_american: "-105" }));
    expect(row).toMatchObject({ priceAmerican: -105, movement: "up", isStale: false });
  });

  it("flags a worse line as down", () => {
    const [row] = applyOddsChange([base], update({ point: "-7.50" }));
    expect(row).toMatchObject({ point: -7.5, movement: "down" });
  });

  it("returns the same array when nothing changed", () => {
    const rows = [base];
    expect(applyOddsChange(rows, update({}))).toBe(rows);
  });

  it("adds new outcomes and removes deleted ones", () => {
    const added = applyOddsChange([base], { ...update({}), eventType: "INSERT", new: { ...update({}).new, id: 2 } });
    expect(added.map((r) => r.id)).toEqual([1, 2]);
    expect(applyOddsChange(added, { eventType: "DELETE", old: { id: 1 } }).map((r) => r.id)).toEqual([2]);
  });

  it("ignores live rows (pregame board only)", () => {
    const rows = [base];
    expect(applyOddsChange(rows, { ...update({ price_american: 200 }), new: { ...update({}).new, is_live: true } })).toBe(rows);
  });
});

describe("movementFor totals", () => {
  const prev = { priceAmerican: -110, point: 230 };
  it("lower total is better for the Over, worse for the Under", () => {
    expect(movementFor(prev, { priceAmerican: -110, point: 229.5, marketKey: "totals", outcomeName: "Over" })).toBe("up");
    expect(movementFor(prev, { priceAmerican: -110, point: 229.5, marketKey: "totals", outcomeName: "Under" })).toBe("down");
  });
});

describe("indexBoard", () => {
  it("groups by event then market", () => {
    const idx = indexBoard([base, { ...base, id: 2, marketKey: "h2h", point: null }]);
    expect([...idx.get("e1")!.keys()]).toEqual(["spreads", "h2h"]);
  });
});
