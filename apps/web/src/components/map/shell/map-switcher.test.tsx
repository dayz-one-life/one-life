import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapSwitcher } from "./map-switcher";

const servers = [
  { slug: "chernarus", name: "Chernarus", map: "chernarusplus", friendCount: 2 },
  { slug: "livonia", name: "Livonia", map: "enoch", friendCount: 0 },
];

describe("MapSwitcher", () => {
  it("names the current map and links to the others", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    expect(screen.getByRole("button", { name: /chernarus/i })).toBeInTheDocument();
  });

  it("carries NO count — this menu switches maps, it does not report on them", async () => {
    // It used to render friendCount (friends sharing a position there) as a bare number.
    // Once the ☰ button started counting players online, the same bar showed two different
    // counts about the same server, one unlabelled: "LIVONIA … 0" beside "ONLINE 12".
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    screen.getByRole("button", { name: /chernarus/i }).click();
    expect(await screen.findByRole("menuitem", { name: /chernarus/i })).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows a loading state rather than a fabricated zero while fetching", () => {
    render(<MapSwitcher slug="chernarus" servers={undefined} loading />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /loading|chernarus/i })).toBeInTheDocument();
  });

  // ⚠️ INVERTED BY SUB-PROJECT D3. This asserted DARK tokens until the map's own dark top bar
  // was deleted; the switcher now sits in the ordinary light page header. It shipped once with
  // its old `text-paper` and rendered as an EMPTY BOX — paper on paper: present, functional and
  // invisible, with the whole suite green. RTL asserts the DOM, not contrast, so this test is
  // the only automated guard; the failure was found in a browser.
  it("is written in LIGHT-surface tokens — the page header is paper", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    const btn = screen.getByRole("button", { name: /chernarus/i });
    // Anchored to the BASE token: `hover:text-paper` is a legitimate inverted hover on an ink
    // background (the board tabs do the same), so a bare /\btext-paper\b/ would reject it.
    expect(btn.className).toMatch(/(^|\s)text-ink\b/);
    expect(btn.className).not.toMatch(/(^|\s)text-paper\b/);
    expect(btn.className).not.toMatch(/(^|\s)border-dark-edge\b/);
  });

  it("the open menu is light too, not just the trigger", async () => {
    // The trigger and the panel are separately styled; fixing one and not the other is exactly
    // how half a component ends up invisible.
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    screen.getByRole("button", { name: /chernarus/i }).click();
    const menu = await screen.findByRole("menu");
    expect(menu.className).not.toMatch(/\bbg-dark-well\b/);
    expect(menu.className).toMatch(/\bbg-white\b/);
    const item = screen.getAllByRole("menuitem")[0]!;
    expect(item.className).not.toMatch(/\btext-cream/);
  });
});
