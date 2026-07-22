import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { useLifeTrack } from "./use-life-track";

const getLifeTrack = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getLifeTrack: (...a: unknown[]) => getLifeTrack(...a),
  };
});
import { ApiError } from "@/lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getLifeTrack.mockReset();
});

describe("useLifeTrack", () => {
  test("a 403 (signed-in non-owner) resolves to null data, not an error state", async () => {
    getLifeTrack.mockRejectedValue(new ApiError(403, "not_verified"));
    const { result } = renderHook(() => useLifeTrack("sakhal", 3, true, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  test("a non-403 ApiError still surfaces as an error, not swallowed", async () => {
    getLifeTrack.mockRejectedValue(new ApiError(500, "http_error"));
    const { result } = renderHook(() => useLifeTrack("sakhal", 3, true, true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  test("enabled: false means no fetch is attempted", async () => {
    renderHook(() => useLifeTrack("sakhal", 3, false, true), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(getLifeTrack).not.toHaveBeenCalled();
  });
});
