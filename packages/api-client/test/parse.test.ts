import { describe, it, expect } from "vitest";
import { parse } from "../src/parse.js";
import { ApiError } from "../src/error.js";

function res(body: string, init: { status?: number } = {}): Response {
  return new Response(body, { status: init.status ?? 200 });
}

describe("parse", () => {
  it("returns parsed JSON on a 2xx", async () => {
    await expect(parse<{ a: number }>(res(JSON.stringify({ a: 1 })))).resolves.toEqual({ a: 1 });
  });

  it("returns null for an empty 2xx body", async () => {
    await expect(parse(res(""))).resolves.toBeNull();
  });

  it("throws ApiError carrying status and code on a non-2xx JSON body", async () => {
    const err = await parse(res(JSON.stringify({ error: "nope", message: "no" }), { status: 403 }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe("nope");
    expect((err as ApiError).message).toBe("no");
  });

  it("throws an ApiError (not a SyntaxError) on a non-JSON error body", async () => {
    const err = await parse(res("<html>502</html>", { status: 502 })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("http_error");
  });

  it("throws invalid_response on a non-JSON 2xx body", async () => {
    const err = await parse(res("not json")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("invalid_response");
  });

  it("defaults the code to http_error when the error body has no error field", async () => {
    const err = await parse(res(JSON.stringify({ nope: 1 }), { status: 500 })).catch((e) => e);
    expect((err as ApiError).code).toBe("http_error");
  });
});
