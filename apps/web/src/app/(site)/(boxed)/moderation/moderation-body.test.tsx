import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModerationBody } from "./moderation-body";

vi.mock("@/lib/api", () => ({
  getModerationQueue: vi.fn(),
  restoreAvatarHash: vi.fn(async () => ({ ok: true })),
  confirmAvatarHash: vi.fn(async () => ({ ok: true })),
  moderationImageSrc: (h: string) => `/api/moderation/hashes/${h}/image`,
  getMe: vi.fn(async () => ({ isModerator: true })),
}));
import { getModerationQueue, restoreAvatarHash, confirmAvatarHash, getMe } from "@/lib/api";

const q = getModerationQueue as unknown as { mockResolvedValue: (v: unknown) => void; mockRejectedValue: (e: Error) => void };
const me = getMe as unknown as { mockResolvedValue: (v: unknown) => void };
const ENTRY = { hash: "abc123", state: "auto", blockedAt: "2026-08-18T00:00:00.000Z", reportCount: 2, reasons: ["hate", "sexual"] };

beforeEach(() => { vi.clearAllMocks(); me.mockResolvedValue({ isModerator: true }); });

describe("ModerationBody", () => {
  // ⚠️ Click-to-reveal. This page is BY CONSTRUCTION a list of things someone reported as
  // objectionable; opening it must not ambush the moderator with a wall of it.
  it("renders no image until one is revealed", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    expect(await screen.findByText(/abc123/)).toBeTruthy();
    expect(document.querySelectorAll("img")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /show image/i }));
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute("src")).toContain("abc123");
  });

  it("shows the report count and de-duplicated reasons", async () => {
    q.mockResolvedValue({ entries: [{ ...ENTRY, reasons: ["hate", "hate", "sexual"] }] });
    render(<ModerationBody />);
    expect(await screen.findByText(/2 reports/i)).toBeTruthy();
    expect(screen.getAllByText(/hate/i)).toHaveLength(1);
  });

  // ⚠️ Empty vs failed. A broken queue that reads as a clean one means nothing gets reviewed
  // for days — the one failure the auto-hide design cannot absorb.
  it("distinguishes an empty queue from a failed load", async () => {
    q.mockResolvedValue({ entries: [] });
    const { unmount } = render(<ModerationBody />);
    expect(await screen.findByText(/nothing waiting/i)).toBeTruthy();
    unmount();

    q.mockRejectedValue(new Error("nope"));
    render(<ModerationBody />);
    expect(await screen.findByText(/couldn't load|could not load/i)).toBeTruthy();
    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
  });

  it("restores an entry and drops it from the list", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    await screen.findByText(/abc123/);
    q.mockResolvedValue({ entries: [] });
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(restoreAvatarHash).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText(/nothing waiting/i)).toBeTruthy();
  });

  // ⚠️ Confirm DESTROYS the bytes and cannot be undone. One stray click must not do that.
  it("requires a second click before confirming a takedown", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    await screen.findByText(/abc123/);

    fireEvent.click(screen.getByRole("button", { name: /^confirm removal$/i }));
    expect(confirmAvatarHash).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));
    await waitFor(() => expect(confirmAvatarHash).toHaveBeenCalledWith("abc123"));
  });

  it("renders a plain refusal, not the queue, when the viewer is not a moderator", async () => {
    me.mockResolvedValue({ isModerator: false });
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    expect(await screen.findByText(/don't have access|do not have access/i)).toBeTruthy();
    expect(screen.queryByText(/abc123/)).toBeNull();
  });

  it("shows the loading state on initial mount", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
    // Let the pending getMe/getModerationQueue promises settle inside `act` before the test
    // ends, so their state updates don't land un-wrapped after teardown.
    await screen.findByText(/abc123/);
  });

  // ⚠️ A "confirmed" row already had its bytes destroyed. Offering Show image / Restore /
  // Confirm removal on it can only mislead — Show image 404s, and Restore "succeeds" while
  // restoring nothing because the bytes are gone. There is no action left to take.
  it("renders an already-removed label for a confirmed row, with none of the three action buttons", async () => {
    q.mockResolvedValue({ entries: [{ ...ENTRY, state: "confirmed" }] });
    render(<ModerationBody />);
    expect(await screen.findByText(/abc123/)).toBeTruthy();
    expect(screen.getByText(/already removed|permanently removed|removed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show image/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm removal/i })).toBeNull();
  });

  it("still offers Show image / Restore / Confirm removal on an auto row", async () => {
    q.mockResolvedValue({ entries: [{ ...ENTRY, state: "auto" }] });
    render(<ModerationBody />);
    await screen.findByText(/abc123/);
    expect(screen.getByRole("button", { name: /show image/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /confirm removal/i })).toBeTruthy();
  });
});
