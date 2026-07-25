import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import Home from "./page";

// live-data honesty spec §5: a feed-fetch failure must not render identically to "the desk
// hasn't published yet." Home() is an async server component; we call and await it directly
// (it is just a function that returns JSX) rather than going through Next.js' render pipeline.
const getSurvivors = vi.fn();
vi.mock("@/lib/api", () => ({
  getSurvivors: (...a: unknown[]) => getSurvivors(...a),
}));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => ({ kind: "loading" }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Home page: a feed-fetch error is not the same as genuine emptiness", () => {
  test("a genuinely empty (resolved) survivors board shows its own quiet-coast copy, no banner", async () => {
    getSurvivors.mockResolvedValue({ rows: [], page: 1, pageSize: 5, total: 0 });
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED survivors fetch shows a distinguishing banner (still renders the quiet-coast copy underneath)", async () => {
    getSurvivors.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
    expect(screen.getByText(/survivors board is temporarily unreachable/i)).toBeInTheDocument();
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
  });
});
