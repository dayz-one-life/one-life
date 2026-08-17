import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://x/y",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("loadConfig", () => {
  // VAPID_PUBLIC_KEY used to be read straight off process.env at the call site, outside the
  // validated schema. The onelife-api unit has its own EnvironmentFile, so an unset key was a
  // live path: GET /push/vapid-key served "", subscribe() threw, and the toggle swallowed it.
  it("carries the vapid public key through the validated schema", () => {
    expect(loadConfig({ ...base, VAPID_PUBLIC_KEY: "BKxDeadBeef" }).vapidPublicKey).toBe("BKxDeadBeef");
  });

  // A warning, not a boot failure: push is optional, and refusing to start would take the
  // whole public site down over a feature nobody has to use. main.ts logs loudly instead.
  it("defaults the vapid public key to empty rather than throwing", () => {
    expect(loadConfig(base).vapidPublicKey).toBe("");
  });

  it("still rejects genuinely required config", () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: "" })).toThrow();
  });
});

describe("stripe config", () => {
  it("is null when unset", () => {
    expect(loadConfig(base).stripe).toBeNull();
  });
  it("is null when only partially set", () => {
    expect(loadConfig({ ...base, STRIPE_SECRET_KEY: "sk_test_x" }).stripe).toBeNull();
  });
  it("is populated when all three are set", () => {
    const cfg = loadConfig({
      ...base,
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_TOKEN_PRICE_ID: "price_x",
    });
    expect(cfg.stripe).toEqual({ secretKey: "sk_test_x", webhookSecret: "whsec_x", priceId: "price_x" });
  });
});

describe("minimum app version", () => {
  // ⚠️ The gate must fail OPEN. An unset floor locks nobody out; the opposite mistake walls
  // every user of a shipped app behind an update that does not exist, fixable only by a deploy.
  it("defaults both platforms to 0.0.0 — no version is below it, so the gate is off", () => {
    expect(loadConfig(base).minAppVersion).toEqual({ ios: "0.0.0", android: "0.0.0" });
  });

  it("carries a configured floor through per platform", () => {
    const cfg = loadConfig({ ...base, IOS_MIN_APP_VERSION: "1.2.0", ANDROID_MIN_APP_VERSION: "1.1.0" });
    expect(cfg.minAppVersion).toEqual({ ios: "1.2.0", android: "1.1.0" });
  });

  // The stores diverge in practice: a release can sit in App Store review while Android ships.
  it("lets one platform be raised without the other", () => {
    expect(loadConfig({ ...base, IOS_MIN_APP_VERSION: "2.0.0" }).minAppVersion)
      .toEqual({ ios: "2.0.0", android: "0.0.0" });
  });

  // Boot must survive a typo'd value. Refusing to start would take the public website down
  // over a mobile-only gate — the same reasoning as VAPID_PUBLIC_KEY above.
  it("falls back to 0.0.0 on an unparseable value rather than throwing", () => {
    expect(loadConfig({ ...base, IOS_MIN_APP_VERSION: "banana" }).minAppVersion.ios).toBe("0.0.0");
    expect(loadConfig({ ...base, ANDROID_MIN_APP_VERSION: "" }).minAppVersion.android).toBe("0.0.0");
  });
});
