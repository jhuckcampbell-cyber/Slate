import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorCode, messageFor } from "./errors";

describe("SQL error messages", () => {
  it("maps every UPPER_SNAKE exception raised by a migration", () => {
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    const codes = new Set<string>();
    for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(new URL(file, migrations), "utf8");
      for (const match of sql.matchAll(/raise\s+exception\s+'([A-Z][A-Z0-9_]*)'/gi)) {
        codes.add(match[1]);
      }
    }
    expect(codes.size).toBeGreaterThan(0);
    for (const code of codes) {
      expect(errorCode({ message: code }), code).toBe(code);
      expect(messageFor(code), code).not.toBe(code);
    }
  });
});

