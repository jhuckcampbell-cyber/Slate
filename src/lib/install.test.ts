import { describe, expect, it } from "vitest";
import { installMode } from "./install";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const base = { standalone: false, canPrompt: false, dismissed: false };

describe("installMode", () => {
  it("iPhone Safari gets the Share → Add to Home Screen tip", () => {
    expect(installMode({ ...base, userAgent: IPHONE_SAFARI })).toBe("ios");
  });
  it("other iPhone browsers can't install, so no tip", () => {
    expect(installMode({ ...base, userAgent: IPHONE_CHROME })).toBe("none");
  });
  it("Android/Chrome gets an install button once the browser offers one", () => {
    expect(installMode({ ...base, userAgent: ANDROID_CHROME, canPrompt: true })).toBe("prompt");
    expect(installMode({ ...base, userAgent: ANDROID_CHROME })).toBe("none");
  });
  it("desktop stays quiet unless the browser offers install", () => {
    expect(installMode({ ...base, userAgent: DESKTOP })).toBe("none");
  });
  it("never nags once installed or dismissed", () => {
    expect(installMode({ ...base, userAgent: IPHONE_SAFARI, standalone: true })).toBe("none");
    expect(installMode({ ...base, userAgent: IPHONE_SAFARI, dismissed: true })).toBe("none");
    expect(installMode({ ...base, userAgent: ANDROID_CHROME, canPrompt: true, dismissed: true })).toBe("none");
  });
});
