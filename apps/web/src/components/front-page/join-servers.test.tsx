import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { JoinServers } from "./join-servers";

// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

describe("JoinServers", () => {
  it("renders the section heading and the three step tickets with red-deep ordinals and dashed borders", () => {
    render(<JoinServers />);
    expect(screen.getByRole("heading", { level: 2, name: "Join the servers" })).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "How to join" });
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toMatch(/First/);
    expect(items[0]!.textContent).toMatch(/Search "One Life"/);
    expect(items[1]!.textContent).toMatch(/Second/);
    expect(items[1]!.textContent).toMatch(/Pick your map/);
    expect(items[2]!.textContent).toMatch(/Third/);
    expect(items[2]!.textContent).toMatch(/★ Favorite them/);
    for (const item of items) {
      expect(item.className).toContain("border-dashed");
      expect(item.querySelector(".text-red-deep")).not.toBeNull();
    }
  });

  it("replica: host rows verbatim, A–Z, players column static, servers-found footer", () => {
    render(<JoinServers />);
    expect(screen.getByText(/One Life Chernarus \| dayzonelife\.com/)).toBeInTheDocument();
    expect(screen.getByText(/One Life Livonia \| dayzonelife\.com/)).toBeInTheDocument();
    expect(screen.getByText(/One Life Sakhal \| dayzonelife\.com/)).toBeInTheDocument();
    // Host A–Z: Chernarus before Livonia before Sakhal (DOM order).
    const chernarus = screen.getByText(/One Life Chernarus/);
    const livonia = screen.getByText(/One Life Livonia/);
    const sakhal = screen.getByText(/One Life Sakhal/);
    expect(chernarus.compareDocumentPosition(livonia) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(livonia.compareDocumentPosition(sakhal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Servers found: 3")).toBeInTheDocument();
    // The illustration caption is what frames the static numbers as honest.
    expect(screen.getByText(/What you.ll see on your screen/i)).toBeInTheDocument();
  });

  it("carries no controller chrome — no LB/RB chips, no button glyphs", () => {
    const { container } = render(<JoinServers />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bLB\b|\bRB\b|Ⓐ|Ⓧ|Ⓨ|Ⓑ/);
  });

  it("closing line defaults to the play-first promise and accepts an override", () => {
    const { rerender } = render(<JoinServers />);
    expect(
      screen.getByText("Play first, claim later — your life is tracked from your first spawn."),
    ).toBeInTheDocument();
    rerender(<JoinServers closing="Any server counts for your emotes." />);
    expect(screen.getByText("Any server counts for your emotes.")).toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/)).not.toBeInTheDocument();
  });

  it("no copy claims live or instant updates", () => {
    const { container } = render(<JoinServers />);
    expect(container.textContent ?? "").not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });

  it("is the yellow slab and never uses red-deep on a dark child", () => {
    const { container } = render(<JoinServers />);
    const section = container.querySelector("section")!;
    expect(section.className).toContain("bg-yellow");
    // red-deep may only appear inside the paper tickets, never inside the dark replica.
    const replica = container.querySelector("[data-testid='browser-replica']")!;
    expect(replica.className).toContain("bg-dark");
    expect(replica.innerHTML).not.toContain("red-deep");
  });
});
