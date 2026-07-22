import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocateButton } from "./locate-button";

const self = { gamertag: "You", x: 6780, y: 2320, recordedAt: "2026-07-22T12:00:00Z", self: true };
const props = { mapCodename: "chernarusplus" };

describe("LocateButton", () => {
  it("flies to your own dot, in the projection the canvas draws in", async () => {
    const onLocate = vi.fn();
    render(<LocateButton {...props} self={self} loading={false} onLocate={onLocate} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onLocate).toHaveBeenCalledTimes(1);
    const focus = onLocate.mock.calls[0]![0];
    expect(focus.zoom).toBeGreaterThanOrEqual(4);
    // The same point map-places.json puts Chernogorsk at — if these drift, "locate" lands
    // somewhere the labels and the dots are not.
    expect(focus.lat).toBeCloseTo(-217.3, 1);
    expect(focus.lng).toBeCloseTo(112.98, 1);
  });

  it("is disabled WITH A REASON when you have no live position", () => {
    render(<LocateButton {...props} self={undefined} loading={false} onLocate={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    // Never a control that silently does nothing.
    expect(button).toHaveAccessibleDescription(/offline|not seen|no position/i);
  });

  it("does not claim you are offline while the position is still loading", () => {
    render(<LocateButton {...props} self={undefined} loading onLocate={() => {}} />);
    expect(screen.getByRole("button")).toHaveAccessibleDescription(/loading/i);
  });

  it("gives a new nonce per press, so locating twice still flies twice", async () => {
    const onLocate = vi.fn();
    const user = userEvent.setup();
    render(<LocateButton {...props} self={self} loading={false} onLocate={onLocate} />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("button"));
    expect(onLocate.mock.calls[0]![0].nonce).not.toBe(onLocate.mock.calls[1]![0].nonce);
  });

  it("is dead rather than wrong on a map we have no world size for", () => {
    render(<LocateButton mapCodename="banov" self={self} loading={false} onLocate={() => {}} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
