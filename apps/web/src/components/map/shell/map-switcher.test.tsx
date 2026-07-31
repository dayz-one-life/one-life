import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapSwitcher } from "./map-switcher";

const servers = [
  { slug: "chernarus", name: "Chernarus", map: "chernarusplus" },
  { slug: "livonia", name: "Livonia", map: "enoch" },
];

describe("MapSwitcher", () => {
  it("names the current map and links to the others", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    expect(screen.getByRole("button", { name: /chernarus/i })).toBeInTheDocument();
  });

  it("carries NO count — this menu switches maps, it does not report on them", async () => {
    // It used to render a per-server share count as a bare number. Once the ☰ button started
    // counting players online, the same bar showed two different counts about the same server,
    // one unlabelled: "LIVONIA … 0" beside "ONLINE 12".
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

  // ⚠️ INVERTED AGAIN — the component's third surface. Dark on the old map top bar; light when
  // D3 first parked it in a paper page header (the un-swapped dark tokens rendered an EMPTY
  // BOX, suite green throughout); dark once more now that it lives in the MASTHEAD right
  // cluster, per the map-in-shell mock. RTL asserts the DOM, not contrast, so this test is the
  // only automated guard against the fourth flip shipping half-swapped.
  it("is written in DARK-surface tokens — it sits in the masthead", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    const btn = screen.getByRole("button", { name: /chernarus/i });
    expect(btn.className).toMatch(/(^|\s)text-paper\b/);
    expect(btn.className).not.toMatch(/(^|\s)text-ink\b/);
    expect(btn.className).toMatch(/(^|\s)border-dark-edge\b/);
  });

  it("the open menu is dark too, not just the trigger", async () => {
    // The trigger and the panel are separately styled; fixing one and not the other is exactly
    // how half a component ends up invisible.
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    screen.getByRole("button", { name: /chernarus/i }).click();
    const menu = await screen.findByRole("menu");
    expect(menu.className).toMatch(/\bbg-dark-well\b/);
    expect(menu.className).not.toMatch(/\bbg-white\b/);
    const item = screen.getAllByRole("menuitem")[0]!;
    expect(item.className).toMatch(/\btext-cream/);
    expect(item.className).not.toMatch(/\btext-ink/);
  });
});
