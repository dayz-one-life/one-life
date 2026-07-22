import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresenceToggles, MasterShareSwitch } from "./presence-toggles";

describe("MasterShareSwitch", () => {
  it("reflects its state and reports a change", async () => {
    const onChange = vi.fn();
    render(<MasterShareSwitch on={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: /share my status with friends/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  // jsdom cannot observe a computed cursor, so the token itself is pinned. A disabled control
  // must not advertise a pointer affordance it does not have.
  it("drops cursor-pointer when disabled", () => {
    const { rerender } = render(<MasterShareSwitch on={false} onChange={() => {}} />);
    const labelOf = () => screen.getByRole("checkbox").closest("label")!;
    expect(labelOf().className).toContain("cursor-pointer");
    rerender(<MasterShareSwitch on={false} disabled onChange={() => {}} />);
    expect(labelOf().className).not.toContain("cursor-pointer");
  });
});

describe("PresenceToggles", () => {
  const noop = () => {};

  it("renders both switches reflecting their flags", () => {
    render(<PresenceToggles friendshipId={1} share={true} notify={false} masterOn onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /notify me/i })).not.toBeChecked();
  });

  it("reports which flag changed", async () => {
    const onChange = vi.fn();
    render(<PresenceToggles friendshipId={1} share notify masterOn onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /notify me/i }));
    expect(onChange).toHaveBeenCalledWith({ notify: false });
  });

  // The two levels must be visible, not mysterious: with the master switch off, the
  // per-friend share control is disabled AND says why.
  it("disables the share switch and explains when the master switch is off", () => {
    render(<PresenceToggles friendshipId={1} share notify masterOn={false} onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeDisabled();
    expect(screen.getByText(/sharing is off/i)).toBeInTheDocument();
  });

  it("leaves the notify switch usable when the master switch is off", () => {
    render(<PresenceToggles friendshipId={1} share notify masterOn={false} onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /notify me/i })).toBeEnabled();
  });

  it("disables both while a write is in flight", () => {
    render(<PresenceToggles friendshipId={1} share notify masterOn disabled onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /notify me/i })).toBeDisabled();
  });

  it("associates the explanation with the share checkbox when the master switch is off", () => {
    render(<PresenceToggles friendshipId={7} share notify masterOn={false} onChange={noop} />);
    const shareBox = screen.getByRole("checkbox", { name: /share my status/i });
    expect(shareBox).toHaveAttribute("aria-describedby", "share-disabled-7");
  });

  it("does not associate the explanation when the master switch is on", () => {
    render(<PresenceToggles friendshipId={1} share notify masterOn onChange={noop} />);
    const shareBox = screen.getByRole("checkbox", { name: /share my status/i });
    expect(shareBox).not.toHaveAttribute("aria-describedby");
  });

  // Regression guard: with the master switch off (the default state, so the one most users
  // are in), N rows rendered together must not collide on one DOM id — each row's
  // aria-describedby must resolve to that row's OWN note, not always the first row's.
  it("gives two rows distinct disabled-note ids, each pointing at its own note", () => {
    render(
      <>
        <PresenceToggles friendshipId={11} share notify masterOn={false} onChange={noop} />
        <PresenceToggles friendshipId={22} share notify masterOn={false} onChange={noop} />
      </>,
    );
    const boxes = screen.getAllByRole("checkbox", { name: /share my status/i });
    const firstId = boxes[0]!.getAttribute("aria-describedby");
    const secondId = boxes[1]!.getAttribute("aria-describedby");
    expect(firstId).toBe("share-disabled-11");
    expect(secondId).toBe("share-disabled-22");
    expect(firstId).not.toBe(secondId);
    expect(document.getElementById(firstId!)).not.toBeNull();
    expect(document.getElementById(secondId!)).not.toBeNull();
    expect(document.getElementById(firstId!)).not.toBe(document.getElementById(secondId!));
  });
});
