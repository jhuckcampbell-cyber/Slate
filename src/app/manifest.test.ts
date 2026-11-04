import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest (installable SquadBets)", () => {
  const m = manifest();

  it("opens full-screen like an app, at the home screen", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.name).toBe("SquadBets");
    expect(m.short_name).toBe("SquadBets");
  });

  it("matches the app's dark theme so launch has no white flash", () => {
    expect(m.background_color).toBe("#0e1220");
    expect(m.theme_color).toBe("#0e1220");
  });

  it("ships the icons install prompts require (192, 512, and a maskable one)", () => {
    const icons = m.icons ?? [];
    expect(icons.find((i) => i.sizes === "192x192" && i.purpose !== "maskable")?.src).toBe("/icons/icon-192.png");
    expect(icons.find((i) => i.sizes === "512x512" && i.purpose !== "maskable")?.src).toBe("/icons/icon-512.png");
    expect(icons.find((i) => i.purpose === "maskable")?.src).toBe("/icons/maskable-512.png");
  });
});
