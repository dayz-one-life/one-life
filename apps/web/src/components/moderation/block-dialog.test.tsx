import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BlockDialog } from "./block-dialog";

vi.mock("@/lib/api", () => ({ blockPlayer: vi.fn(async () => ({ ok: true })) }));
import { blockPlayer } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

describe("BlockDialog", () => {
  // ⚠️ A block that only half-explains itself is worse than none: the player believes they are
  // fully protected. Both consequences must be named, and the "not told" sentence matters too —
  // a block that notifies is a block that invites retaliation.
  it("names both effects: their avatar is hidden from you, and location sharing stops both ways", () => {
    render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/avatar/i);
    expect(text).toMatch(/location/i);
  });

  it("says the blocked player is never told", () => {
    render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
    expect(screen.getByText(/not told/i)).toBeTruthy();
  });

  it("sends the gamertag on confirm", async () => {
    render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^block player$/i }));
    await waitFor(() => expect(blockPlayer).toHaveBeenCalledWith("Ripper"));
  });

  it("confirms once blocking succeeds", async () => {
    render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^block player$/i }));
    expect(await screen.findByText(/^blocked$/i)).toBeTruthy();
  });

  // Failure must not read as success — nothing was blocked. Kept last: it permanently overrides
  // the mock's resolved value for the rest of the file.
  it("shows an error and does not claim success when the call fails", async () => {
    (blockPlayer as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(new Error("nope"));
    render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^block player$/i }));
    expect(await screen.findByText(/couldn't|could not/i)).toBeTruthy();
    expect(screen.queryByText(/^blocked$/i)).toBeNull();
  });

  // Same real-trap proof as `report-dialog.test.tsx`: focus must actually land on the panel
  // (requires the panel's `tabIndex={-1}`), and Escape must actually close it.
  it("moves focus into the panel on open", () => {
    render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<BlockDialog open gamertag="Ripper" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ⚠️ THE BUG THIS GUARDS: `ReportBlockMenu` mounts this dialog ONCE and toggles it purely via
  // `open` — it is never unmounted between uses. Reopening after a successful block must not
  // land straight on "Blocked" from the LAST confirm; that would show the block-happened copy
  // before this attempt has done anything.
  it("reopening after a successful block shows the confirm screen again, not the stale success", async () => {
    (blockPlayer as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ ok: true });
    const onClose = vi.fn();
    const { rerender } = render(<BlockDialog open gamertag="Ripper" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^block player$/i }));
    await screen.findByText(/^blocked$/i);

    rerender(<BlockDialog open={false} gamertag="Ripper" onClose={onClose} />);
    rerender(<BlockDialog open gamertag="Ripper" onClose={onClose} />);

    expect(screen.queryByText(/^blocked$/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^block player$/i })).toBeTruthy();
  });

  // Same failure mode, the error-banner half.
  it("reopening after a failed block does not show the stale error banner", async () => {
    (blockPlayer as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error("nope"),
    );
    const onClose = vi.fn();
    const { rerender } = render(<BlockDialog open gamertag="Ripper" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^block player$/i }));
    await screen.findByText(/couldn't|could not/i);

    rerender(<BlockDialog open={false} gamertag="Ripper" onClose={onClose} />);
    rerender(<BlockDialog open gamertag="Ripper" onClose={onClose} />);

    expect(screen.queryByText(/couldn't|could not/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^block player$/i })).toBeTruthy();
  });
});
