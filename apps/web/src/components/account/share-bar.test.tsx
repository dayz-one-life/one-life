import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

  it("reserves no visible note space while idle — the live region is sr-only", () => {
    render(<ShareBar link={LINK} />);
    // ⚠️ The note used to be an always-mounted visible <span> in the gap-3 column, which made
    // the invite half taller than the tokens half and opened extra white space above the send
    // row next door (the halves bottom-align via mt-auto). The pre-mounted live region must be
    // visually hidden; the visible note only exists once there is something to say.
    expect(screen.getByRole("status")).toHaveClass("sr-only");
    expect(screen.queryByText(/link copied/i)).toBeNull();
  });

  it("announces the copy confirmation in a live region and shows the visible note", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareBar link={LINK} />);
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole("status")).toHaveTextContent(/link copied/i);
    const notes = await screen.findAllByText(/link copied/i);
    expect(notes.some((n) => !n.closest(".sr-only"))).toBe(true);
  });
});
