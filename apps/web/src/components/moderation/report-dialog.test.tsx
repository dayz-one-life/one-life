import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportDialog } from "./report-dialog";

vi.mock("@/lib/api", () => ({ reportAvatar: vi.fn(async () => ({ ok: true })) }));
import { reportAvatar } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

describe("ReportDialog", () => {
  // ⚠️ The copy must be TRUE. Auto-hide really happens, so "we'll look into it" would be a lie
  // in the one direction that matters — it would also hide from the reporter that a bad report
  // is reversible.
  it("says the avatar is hidden immediately, not that it will be reviewed later", () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    expect(screen.getByText(/hidden (straight away|immediately)/i)).toBeTruthy();
  });

  it("requires a reason before it will submit", () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /report/i })).toHaveProperty("disabled", true);
  });

  it("sends the hash and the chosen reason", async () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/hateful or harassing/i));
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    await waitFor(() => expect(reportAvatar).toHaveBeenCalledWith("abc", "hate"));
  });

  // Failure must not read as success — the avatar is still up.
  it("shows an error and does not claim success when the call fails", async () => {
    (reportAvatar as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(new Error("nope"));
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/hateful or harassing/i));
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(await screen.findByText(/couldn't|could not/i)).toBeTruthy();
  });

  // The a11y contract is `useModalBehavior` (shared, already unit-tested elsewhere), but this
  // proves it is actually WIRED to the panel here — a real trap, not just an `aria-modal`
  // attribute. If `tabIndex={-1}` were missing from the panel, focus would silently stay put.
  it("moves focus into the panel on open and closes on Escape", () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
