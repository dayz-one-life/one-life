import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaceSearch } from "./place-search";

describe("PlaceSearch", () => {
  it("offers matching places and focuses the one picked", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={onPick} />);

    await user.type(screen.getByRole("combobox"), "stary sobor");
    const option = await screen.findByRole("option", { name: /stary sobor/i });
    await user.click(option);

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const focus = onPick.mock.calls[0]![0];
    expect(focus.lat).toBeLessThan(0); // CRS.Simple latitude is negative on this pyramid
    expect(focus.lng).toBeGreaterThan(0);
    expect(focus.zoom).toBeGreaterThanOrEqual(4); // close enough that its own tier renders
    expect(typeof focus.nonce).toBe("number");
  });

  it("gives a new nonce each time, so picking the same place twice still flies", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={onPick} />);
    for (let i = 0; i < 2; i++) {
      await user.clear(screen.getByRole("combobox"));
      await user.type(screen.getByRole("combobox"), "vybor");
      await user.click(await screen.findByRole("option", { name: /^vybor$/i }));
    }
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick.mock.calls[0]![0].nonce).not.toBe(onPick.mock.calls[1]![0].nonce);
  });

  it("flies once when the typed name and the clicked option are the same place", async () => {
    // A click arrives as an onChange carrying the option's text — identical to the text that
    // just resolved by typing. Firing on both flew the map twice for one intent.
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={onPick} />);
    await user.type(screen.getByRole("combobox"), "vybor");
    await user.click(await screen.findByRole("option", { name: /^vybor$/i }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("is written in dark-surface tokens — the bar is dark", () => {
    // RTL asserts the DOM, not contrast: an ink-on-dark search box is present, functional and
    // invisible, and every other test in this file stays green while it is.
    render(<PlaceSearch mapCodename="chernarusplus" onPick={vi.fn()} />);
    const input = screen.getByRole("combobox");
    expect(input.className).toMatch(/\btext-paper\b/);
    expect(input.className).not.toMatch(/\btext-ink/);
  });
});
