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

  // Fix round 1 (§5 coherence gap): obituaries/fresh-spawns/survivors already flowed through
  // settleFeed (from the ebb63b5 pass) but `.failed` went unused — a REJECTED fetch rendered
  // identically to the desk's own genuinely-empty copy. Extends the same banner treatment news
  // already got to the other three feeds.
  test("a genuinely empty (resolved) obituaries feed shows the morgue's own empty copy, no banner", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    render(await Home());
    expect(screen.getByText("THE MORGUE DESK IS QUIET. NOTHING FILED YET.")).toBeInTheDocument();
    expect(screen.queryByText(/morgue.*unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED obituaries feed shows a distinguishing banner (still renders the empty copy underneath, never a broken page)", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    getObituariesFeed.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByText(/morgue.*unreachable/i)).toBeInTheDocument();
    expect(screen.getByText("THE MORGUE DESK IS QUIET. NOTHING FILED YET.")).toBeInTheDocument();
  });

  test("a genuinely empty (resolved) fresh-spawns feed shows the nursery's own empty copy, no banner", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    render(await Home());
    expect(screen.getByText("THE NURSERY IS EMPTY. NO FOOL HAS WASHED ASHORE YET.")).toBeInTheDocument();
    expect(screen.queryByText(/nursery.*unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED fresh-spawns feed shows a distinguishing banner (still renders the empty copy underneath)", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    getBirthNoticesFeed.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByText(/nursery.*unreachable/i)).toBeInTheDocument();
    expect(screen.getByText("THE NURSERY IS EMPTY. NO FOOL HAS WASHED ASHORE YET.")).toBeInTheDocument();
  });

  test("a genuinely empty (resolved) survivors board shows its own quiet-coast copy, no banner", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    render(await Home());
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
    expect(screen.queryByText(/survivors.*unreachable/i)).not.toBeInTheDocument();
  });

  test("a REJECTED survivors fetch shows a distinguishing banner (still renders the quiet-coast copy underneath)", async () => {
    getNewsFeed.mockResolvedValue(emptyFeed);
    getSurvivors.mockRejectedValue(new Error("503"));
    render(await Home());
    expect(screen.getByText(/survivors.*unreachable/i)).toBeInTheDocument();
    expect(screen.getByText("THE COAST IS QUIET. NO QUALIFIED SURVIVORS ON RECORD.")).toBeInTheDocument();
  });
});
