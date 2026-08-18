import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BlockedUsers } from "./blocked-users";

vi.mock("@/lib/api", () => ({ getBlocks: vi.fn(), unblockPlayer: vi.fn(async () => ({ ok: true })) }));
import { getBlocks, unblockPlayer } from "@/lib/api";

const mockGet = getBlocks as unknown as { mockResolvedValue: (v: unknown) => void; mockRejectedValue: (e: Error) => void };

beforeEach(() => vi.clearAllMocks());

describe("BlockedUsers", () => {
  it("shows a loading affordance and no list while the fetch is in flight", () => {
    mockGet.mockResolvedValue(new Promise(() => {}));
    render(<BlockedUsers />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  // ⚠️ THE test. If a failed fetch renders as "you haven't blocked anyone", someone believes
  // their blocks are gone — or that they are protected when the list never loaded.
  it("distinguishes an empty list from a failed fetch", async () => {
    mockGet.mockResolvedValue({ blocks: [] });
    const { unmount } = render(<BlockedUsers />);
    expect(await screen.findByText(/haven't blocked anyone/i)).toBeTruthy();
    unmount();

    mockGet.mockRejectedValue(new Error("nope"));
    render(<BlockedUsers />);
    expect(await screen.findByText(/couldn't load|could not load/i)).toBeTruthy();
    expect(screen.queryByText(/haven't blocked anyone/i)).toBeNull();
  });

  it("lists blocked gamertags and unblocks one", async () => {
    mockGet.mockResolvedValue({ blocks: [{ gamertag: "Ripper", createdAt: "2026-08-18T00:00:00.000Z" }] });
    render(<BlockedUsers />);
    expect(await screen.findByText("Ripper")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));
    await waitFor(() => expect(unblockPlayer).toHaveBeenCalledWith("Ripper"));
  });

  // The gamertag is snapshotted server-side at block time (Task 2), so it is present even after
  // the blocked account unlinks — which is exactly what keeps the row removable.
  it("renders and can unblock a player who has since unlinked", async () => {
    mockGet.mockResolvedValue({ blocks: [{ gamertag: "GoneTag", createdAt: "2026-08-18T00:00:00.000Z" }] });
    render(<BlockedUsers />);
    expect(await screen.findByText("GoneTag")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));
    await waitFor(() => expect(unblockPlayer).toHaveBeenCalledWith("GoneTag"));
  });

  // A failed unblock must not silently drop the row — that would make it look like it worked
  // when the player is still blocked (or, worse, unblocked server-side but presumed still blocked).
  it("keeps the row and surfaces an error if unblocking fails", async () => {
    mockGet.mockResolvedValue({ blocks: [{ gamertag: "Ripper", createdAt: "2026-08-18T00:00:00.000Z" }] });
    (unblockPlayer as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error("nope"),
    );
    render(<BlockedUsers />);
    expect(await screen.findByText("Ripper")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));
    expect(await screen.findByText(/couldn't unblock|could not unblock/i)).toBeTruthy();
    expect(screen.getByText("Ripper")).toBeTruthy();
  });

  // A double-click before the first request resolves must not fire a second `unblockPlayer` call
  // for the same row — the second would land on an already-removed block, fail, and show a FALSE
  // "couldn't unblock" error for an unblock that actually succeeded.
  it("ignores a second click on the same row while the first unblock is in flight", async () => {
    mockGet.mockResolvedValue({ blocks: [{ gamertag: "Ripper", createdAt: "2026-08-18T00:00:00.000Z" }] });
    render(<BlockedUsers />);
    expect(await screen.findByText("Ripper")).toBeTruthy();

    const button = screen.getByRole("button", { name: /unblock/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(unblockPlayer).toHaveBeenCalledTimes(1));
    expect(unblockPlayer).toHaveBeenCalledWith("Ripper");
    expect(screen.queryByText(/couldn't unblock|could not unblock/i)).toBeNull();
  });

  // A successful unblock revalidates the list, but must not flash the whole section back to the
  // `loading` render — that would wipe out every untouched row, not just the one being unblocked.
  it("does not show the loading affordance while revalidating after a successful unblock", async () => {
    mockGet.mockResolvedValue({
      blocks: [
        { gamertag: "Ripper", createdAt: "2026-08-18T00:00:00.000Z" },
        { gamertag: "Scout", createdAt: "2026-08-18T00:00:00.000Z" },
      ],
    });
    render(<BlockedUsers />);
    expect(await screen.findByText("Ripper")).toBeTruthy();
    expect(await screen.findByText("Scout")).toBeTruthy();

    const buttons = screen.getAllByRole("button", { name: /unblock/i });
    fireEvent.click(buttons[0]!);

    // The untouched row must stay visible throughout — if the component flashed to `loading`,
    // "Scout" (and the loading text) would race this assertion instead of staying put.
    expect(screen.queryByText(/^loading/i)).toBeNull();
    expect(screen.getByText("Scout")).toBeTruthy();

    await waitFor(() => expect(unblockPlayer).toHaveBeenCalledWith("Ripper"));
  });
});
