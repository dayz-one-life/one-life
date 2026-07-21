import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import Home from "./page";

// live-data honesty spec §5: a feed-fetch failure must not render identically to "the desk
// hasn't published yet." Home() is an async server component; we call and await it directly
// (it is just a function that returns JSX) rather than going through Next.js' render pipeline.
const getNewsFeed = vi.fn();
const getSurvivors = vi.fn();
const getObituariesFeed = vi.fn();
const getBirthNoticesFeed = vi.fn();
vi.mock("@/lib/api", () => ({
  getNewsFeed: (...a: unknown[]) => getNewsFeed(...a),
  getSurvivors: (...a: unknown[]) => getSurvivors(...a),
  getObituariesFeed: (...a: unknown[]) => getObituariesFeed(...a),
  getBirthNoticesFeed: (...a: unknown[]) => getBirthNoticesFeed(...a),
}));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => ({ kind: "loading" }) }));

const emptyFeed = { rows: [], page: 1, pageSize: 3, total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  getSurvivors.mockResolvedValue({ rows: [], page: 1, pageSize: 5, total: 0 });
  getObituariesFeed.mockResolvedValue(emptyFeed);
  getBirthNoticesFeed.mockResolvedValue(emptyFeed);
});

describe("Home page: a feed-fetch error is not the same as genuine emptiness", () => {
  test("a genuinely empty (resolved) news feed renders the manifesto/empty-newsroom fallback, no error banner", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. Then the obituary." })).toBeInTheDocument();
    expect(screen.queryByText(/temporarily unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED news feed still shows the fallback (never a broken page) but distinguishably from genuine emptiness", async () => {
    getNewsFeed.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "One life. Then the obituary." })).toBeInTheDocument();
    expect(screen.getByText(/temporarily unreachable/i)).toBeInTheDocument();
  });
});
