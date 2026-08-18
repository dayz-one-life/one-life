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

  // ⚠️ THE BUG THIS GUARDS: `ReportBlockMenu` mounts this dialog ONCE and toggles it purely via
  // `open` — it is never unmounted between uses. Reopening it after a successful report must not
  // land straight on the "Reported" confirmation from the LAST submission: that would show
  // "hidden straight away" copy before the user has submitted anything this time, which is
  // exactly the lie this feature exists to prevent.
  it("reopening after a successful report shows the form again, not the stale confirmation", async () => {
    (reportAvatar as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ ok: true });
    const onClose = vi.fn();
    const { rerender } = render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/hateful or harassing/i));
    fireEvent.click(screen.getByRole("button", { name: /report avatar/i }));
    await screen.findByText(/^reported$/i);

    rerender(<ReportDialog open={false} gamertag="Ripper" avatarHash="abc" onClose={onClose} />);
    rerender(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={onClose} />);

    expect(screen.queryByText(/^reported$/i)).toBeNull();
    expect(screen.getByText(/report this avatar/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /report avatar/i })).toHaveProperty("disabled", true);
  });

  // Same failure mode, the error-banner half: a stale error from the last attempt must not sit
  // on screen before this attempt has even started.
  it("reopening after a failed submit does not show the stale error banner", async () => {
    (reportAvatar as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(
      new Error("nope"),
    );
    const onClose = vi.fn();
    const { rerender } = render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/hateful or harassing/i));
    fireEvent.click(screen.getByRole("button", { name: /report avatar/i }));
    await screen.findByText(/couldn't|could not/i);

    rerender(<ReportDialog open={false} gamertag="Ripper" avatarHash="abc" onClose={onClose} />);
    rerender(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={onClose} />);

    expect(screen.queryByText(/couldn't|could not/i)).toBeNull();
    expect(screen.getByRole("button", { name: /report avatar/i })).toHaveProperty("disabled", true);
  });
});
