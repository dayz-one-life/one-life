import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchProviderImage } from "../src/lib/avatar-store.js";

// A local stub server standing in for both a compliant provider host and an attacker-controlled
// redirect target. fetchProviderImage's host allowlist is checked against the URL string, not
// against DNS/network reachability, so a plain loopback stub is enough to exercise every guard
// branch without any real network access.
let stubServer: http.Server;
let stubOrigin: string;

beforeAll(async () => {
  stubServer = http.createServer((req, res) => {
    if (req.url === "/redirect-to-self") {
      res.writeHead(302, { location: `${stubOrigin}/redirect-to-self` });
      res.end();
      return;
    }
    if (req.url === "/redirect-to-non-loopback") {
      // Redirects to a non-allowlisted https host — the "leaves the allowlist mid-chain" case.
      res.writeHead(302, { location: "https://example.com/evil" });
      res.end();
      return;
    }
    if (req.url === "/redirect-downgrade") {
      // Redirects from (simulated) https down to plain http on a non-loopback host.
      res.writeHead(302, { location: "http://example.com/evil" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.from("fake-image-bytes"));
  });
  await new Promise<void>((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
  const port = (stubServer.address() as AddressInfo).port;
  stubOrigin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => stubServer.close(() => resolve()));
});

describe("fetchProviderImage guards", () => {
  it("rejects a non-https URL when allowTestHosts is not set", async () => {
    await expect(fetchProviderImage(`${stubOrigin}/avatar.png`)).rejects.toThrow("insecure_url");
  });

  it("rejects a non-https URL even against an allowlisted-looking host", async () => {
    await expect(
      fetchProviderImage("http://cdn.discordapp.com/avatar.png"),
    ).rejects.toThrow("insecure_url");
  });

  it("rejects an https URL whose host is not on the provider allowlist", async () => {
    await expect(
      fetchProviderImage("https://example.com/avatar.png"),
    ).rejects.toThrow("host_not_allowed");
  });

  it("rejects a redirect chain longer than the cap", async () => {
    await expect(
      fetchProviderImage(`${stubOrigin}/redirect-to-self`, { allowTestHosts: true }),
    ).rejects.toThrow("too_many_redirects");
  });

  it("rejects a redirect hop that leaves the allowlist (https target, not allowlisted)", async () => {
    await expect(
      fetchProviderImage(`${stubOrigin}/redirect-to-non-loopback`, { allowTestHosts: true }),
    ).rejects.toThrow("host_not_allowed");
  });

  it("rejects a redirect hop that downgrades to http on a non-loopback host", async () => {
    await expect(
      fetchProviderImage(`${stubOrigin}/redirect-downgrade`, { allowTestHosts: true }),
    ).rejects.toThrow("insecure_url");
  });

  it("allows loopback http ONLY with the test flag set", async () => {
    const buf = await fetchProviderImage(`${stubOrigin}/avatar.png`, { allowTestHosts: true });
    expect(buf.toString()).toBe("fake-image-bytes");
  });
});
