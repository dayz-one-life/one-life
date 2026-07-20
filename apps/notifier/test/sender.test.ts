import { describe, it, expect } from "vitest";
import { buildSender } from "../src/sender.js";

const log = { error: () => {}, warn: () => {}, info: () => {} };

// A real VAPID keypair shape: 65-byte uncompressed P-256 point / 32-byte scalar, base64url.
const GOOD = {
  publicKey:
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSvpeZv57ykWFo3l8QCbEBLR8OhkGGjOEE",
  privateKey: "Vw3Vv7hVIC0-lTS2eyt6iWBGZ0-1G7oNHtBBhcnZ4Lw",
  subject: "mailto:ops@example.com",
};

describe("buildSender", () => {
  it("returns a sender for valid VAPID details", () => {
    expect(buildSender(GOOD, log)).toBeTypeOf("function");
  });

  // web-push validates synchronously; without a guard this throw escapes module scope in
  // main.ts and kills the process before the loop starts, taking generation down with push.
  it("returns null instead of throwing on a subject missing its mailto: prefix", () => {
    let sender: unknown;
    expect(() => {
      sender = buildSender({ ...GOOD, subject: "ops@example.com" }, log);
    }).not.toThrow();
    expect(sender).toBeNull();
  });

  it("returns null instead of throwing on a truncated key", () => {
    expect(buildSender({ ...GOOD, publicKey: "too-short" }, log)).toBeNull();
    expect(buildSender({ ...GOOD, privateKey: "nope" }, log)).toBeNull();
  });

  it("returns null when any VAPID field is blank", () => {
    expect(buildSender({ ...GOOD, subject: "" }, log)).toBeNull();
    expect(buildSender({ ...GOOD, publicKey: "" }, log)).toBeNull();
    expect(buildSender({ ...GOOD, privateKey: "" }, log)).toBeNull();
  });
});
