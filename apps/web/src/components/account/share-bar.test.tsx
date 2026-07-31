import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareBar } from "./share-bar";

const LINK = "https://dayzonelife.com/i/manicdote";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ShareBar />", () => {
  it("renders no social share targets", () => {
    render(<ShareBar link={LINK} />);
    expect(screen.queryByLabelText(/share on/i)).toBeNull();
    expect(screen.queryByLabelText(/discord/i)).toBeNull();
    expect(screen.queryByText("More…")).toBeNull();
  });

  /* ⚠️ These three pin a LAYOUT constraint through the only proxy jsdom can honestly offer:
   * the number of in-flow children in the note column. The invite half must be exactly as tall
   * as the tokens half's send row, because ControlsSlab bottom-aligns them with mt-auto inside
   * equal-height grid cells — any extra in-flow child here reappears as stray white space above
   * the SEND FIELD in the other column. `sr-only` is position:absolute, so the live region is
   * not a flex item and does not count; the visible note does. Asserting the child count (not
   * just "no visible text") is what rejects an always-mounted but currently-empty node — which
   * is exactly the shape of the bug this replaced. */
  const noteColumn = () => screen.getByRole("status").parentElement!;

  it("keeps the idle bar to one in-flow row — the live region is sr-only", () => {
    render(<ShareBar link={LINK} />);
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(noteColumn().children).toHaveLength(2); // the field row + the out-of-flow live region
    expect(screen.queryByText(/link copied/i)).toBeNull();
  });

  it("announces the copy confirmation in a live region and shows the visible note", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareBar link={LINK} />);
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole("status")).toHaveTextContent(/link copied/i);
    const notes = screen.getAllByText(/link copied/i);
    expect(notes).toHaveLength(2); // the live region + exactly one visible note
    expect(notes.some((n) => !n.closest(".sr-only"))).toBe(true);
    expect(noteColumn().children).toHaveLength(3);
  });

  it("expires the visible note so the halves do not stay uneven after a copy", async () => {
    vi.useFakeTimers();
    try {
      // An earlier test's userEvent run leaves navigator.clipboard defined as a getter, so it
      // has to be redefined rather than assigned.
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
      });
      // fireEvent, not userEvent: userEvent's clipboard plumbing awaits real promises and
      // deadlocks against fake timers. The click itself is all this test needs.
      render(<ShareBar link={LINK} />);
      fireEvent.click(screen.getByRole("button", { name: /copy link/i }));
      expect(noteColumn().children).toHaveLength(3);
      // ⚠️ A note that never cleared put the reported white-space band back permanently on the
      // first copy. The column must return to its one-row idle height on its own.
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText(/link copied/i)).toBeNull();
      expect(noteColumn().children).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
