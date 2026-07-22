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
});

describe("PresenceToggles", () => {
  const noop = () => {};

  it("renders both switches reflecting their flags", () => {
    render(<PresenceToggles share={true} notify={false} masterOn onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /notify me/i })).not.toBeChecked();
  });

  it("reports which flag changed", async () => {
    const onChange = vi.fn();
    render(<PresenceToggles share notify masterOn onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /notify me/i }));
    expect(onChange).toHaveBeenCalledWith({ notify: false });
  });

  // The two levels must be visible, not mysterious: with the master switch off, the
  // per-friend share control is disabled AND says why.
  it("disables the share switch and explains when the master switch is off", () => {
    render(<PresenceToggles share notify masterOn={false} onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeDisabled();
    expect(screen.getByText(/sharing is off/i)).toBeInTheDocument();
  });

  it("leaves the notify switch usable when the master switch is off", () => {
    render(<PresenceToggles share notify masterOn={false} onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /notify me/i })).toBeEnabled();
  });

  it("disables both while a write is in flight", () => {
    render(<PresenceToggles share notify masterOn disabled onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /notify me/i })).toBeDisabled();
  });
});
