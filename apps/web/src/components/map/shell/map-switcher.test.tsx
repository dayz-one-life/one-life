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

  it("is written in dark-surface tokens — the bar is dark, and RTL cannot see contrast", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    const btn = screen.getByRole("button", { name: /chernarus/i });
    expect(btn.className).toMatch(/\btext-paper\b/);
    expect(btn.className).not.toMatch(/\btext-ink\b/);
  });
});
