import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationToggle, MasterLocationSwitch, reciprocityLabel } from "./location-toggles";

describe("reciprocityLabel", () => {
  // ⚠️ Undifferentiated on purpose: "master off" and "hidden from you specifically" MUST
  // produce the same string. Differentiating tells one player a named friend singled them
  // out, which makes the per-friend hide switch a visible act and therefore unusable.
  it("says the same thing however their sharing is off", () => {
    expect(reciprocityLabel(false)).toBe("Not sharing with you");
    expect(reciprocityLabel(true)).toBe("Sharing with you");
  });
});

describe("LocationToggle", () => {
  it("reflects the flag and reports a change", async () => {
    const onChange = vi.fn();
    render(<LocationToggle friendshipId={1} share={false} masterOn theyShare={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: /share my location/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("disables and explains when the master switch is off", () => {
    render(<LocationToggle friendshipId={1} share masterOn={false} theyShare={false} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /share my location/i })).toBeDisabled();
    expect(screen.getByText(/location sharing is off/i)).toBeInTheDocument();
  });

  it("shows the reciprocity line", () => {
    render(<LocationToggle friendshipId={1} share masterOn theyShare={false} onChange={() => {}} />);
    expect(screen.getByText("Not sharing with you")).toBeInTheDocument();
  });

  // Two rows rendered together must not collide on one DOM id — the bug that broke the
  // presence note's aria association for every row after the first.
  it("gives each row its own note id", () => {
    render(
      <>
        <LocationToggle friendshipId={1} share masterOn={false} theyShare={false} onChange={() => {}} />
        <LocationToggle friendshipId={2} share masterOn={false} theyShare={false} onChange={() => {}} />
      </>,
    );
    const boxes = screen.getAllByRole("checkbox", { name: /share my location/i });
    const a = boxes[0]!.getAttribute("aria-describedby");
    const b = boxes[1]!.getAttribute("aria-describedby");
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(document.getElementById(a!)).not.toBeNull();
    expect(document.getElementById(b!)).not.toBeNull();
  });
});

describe("MasterLocationSwitch", () => {
  it("reflects its state and reports a change", async () => {
    const onChange = vi.fn();
    render(<MasterLocationSwitch on={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: /share my location with friends/i });
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
