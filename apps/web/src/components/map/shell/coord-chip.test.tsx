import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoordChip } from "./coord-chip";

/** `navigator.clipboard` is a getter-only property, AND userEvent.setup() installs its own
 *  stub — so the double must be defined (not assigned) and must go on AFTER setup, or the
 *  test silently exercises userEvent's clipboard instead of ours. */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("CoordChip", () => {
  it("reads out the grid square under the crosshair", () => {
    render(<CoordChip world={{ x: 6780, y: 2320 }} />);
    expect(screen.getByText("067 023")).toBeInTheDocument();
  });

  it("renders nothing until the map has reported a centre", () => {
    const { container } = render(<CoordChip world={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is not a live region — announcing every frame of a pan is unusable", () => {
    render(<CoordChip world={{ x: 100, y: 100 }} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("copies the pair, and says so in the button's accessible name", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CoordChip world={{ x: 6780, y: 2320 }} />);
    const button = screen.getByRole("button", { name: /copy .*067 023/i });
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith("067 023");
  });

  it("keeps the reading on screen when the clipboard is denied", async () => {
    // A rejected permission is the common case in an insecure context or a locked-down
    // browser; the readout is still useful to a person who can read it off the screen.
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);
    render(<CoordChip world={{ x: 6780, y: 2320 }} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("067 023")).toBeInTheDocument();
  });
});
