import { describe, it, expect, vi } from "vitest";
import { consoleMailer } from "../src/mailer.js";

describe("consoleMailer", () => {
  it("logs the magic-link url and resolves", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleMailer.send({ to: "a@b.com", subject: "s", body: "b", url: "http://x/verify?token=abc" });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("http://x/verify?token=abc"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a@b.com"));
    spy.mockRestore();
  });
});
