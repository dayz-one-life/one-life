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

  it("does not hijack the map mid-typing for a name that is a prefix of a longer one", async () => {
    // Five such pairs exist in the Chernarus data (Bogat/Bogatyrka, Klen/Klenovyipereval,
    // Skalisty/Skalisty Proliv, ...). Typing "Skalisty Proliv" passes through "Skalisty",
    // itself a real place — inferring a pick from the text flew there at the 8th character
    // and again at the end: two flights and a disorienting jump for one intent.
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={onPick} />);
    await user.type(screen.getByRole("combobox"), "Skalisty Proliv");
    await screen.findByRole("option", { name: /skalisty proliv/i });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("gets out of the way once a place is chosen", async () => {
    // Below md the field covers the whole bar; leaving it up hides the map the pick just flew.
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Search places" }));
    expect(screen.getByRole("button", { name: "Search places" })).toHaveAttribute("aria-expanded", "true");
    await user.type(screen.getByRole("combobox"), "vybor");
    await user.click(await screen.findByRole("option", { name: /^vybor$/i }));
    expect(screen.getByRole("button", { name: "Search places" })).toHaveAttribute("aria-expanded", "false");
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
