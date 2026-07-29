import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PendingHeroView } from "./pending-hero";
import type { Challenge } from "@/lib/types";

// FitLine observes its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const NOW = new Date("2026-07-16T12:00:00Z").getTime();

const challenge = (over: Partial<Challenge>): Challenge => ({
  sequence: ["point at self", "clap", "thumbs down"], progressIndex: 1,
  expiresAt: "2026-07-17T10:10:00Z", expired: false, ...over,
});

const view = (over: Partial<Parameters<typeof PendingHeroView>[0]> = {}) => (
  <PendingHeroView
    gamertag="BootsColdwater"
    challenge={challenge({})}
    now={NOW}
    onCancel={() => {}}
    onReclaim={() => {}}
    {...over}
  />
);

describe("PendingHeroView — live challenge", () => {
  test("h1, kicker, and the deck sentence", () => {
    render(view());
    expect(
      screen.getByRole("heading", { level: 1, name: "Prove it's you BootsColdwater" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText(/one step left/i)).toBeInTheDocument();
    expect(screen.getByText(/Join any One Life server and perform these three emotes/)).toBeInTheDocument();
  });

  test("three tickets with ordinals; confirmed ticket is stamped, unconfirmed are dashed", () => {
    render(view());
    const list = screen.getByRole("list", { name: "Emote sequence" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toMatch(/First/);
    expect(items[0]!.textContent).toMatch(/point at self/i);
    expect(items[0]!.textContent).toMatch(/Confirmed/);
    expect(items[0]!.className).toContain("bg-paper");
    expect(items[1]!.textContent).toMatch(/Second/);
    expect(items[1]!.className).toContain("border-dashed");
    expect(items[2]!.textContent).toMatch(/Third/);
    expect(items[2]!.className).toContain("border-dashed");
  });

  // ⚠️ THE HONESTY FIX (spec §2): the sequence must never render a live-tracker affordance.
  test("no current-step pointer exists — no arrow, no 'current' highlight", () => {
    const { container } = render(view());
    expect(container.textContent ?? "").not.toContain("←");
    expect(container.innerHTML).not.toContain("data-current");
  });

  test("ticket confirmation state reaches a screen reader in words", () => {
    render(view());
    expect(screen.getByText("— confirmed by the server")).toBeInTheDocument();
    expect(screen.getAllByText("— not yet confirmed")).toHaveLength(2);
  });

  test("progress announces via a role=status region separate from the list", () => {
    const { rerender } = render(view({ challenge: challenge({ progressIndex: 1 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3 confirmed");
    rerender(view({ challenge: challenge({ progressIndex: 2 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3 confirmed");
    expect(screen.getByRole("status").tagName).not.toBe("OL");
  });

  // The batching expectation, in the status paragraph — VERBATIM (spec §2). Without it a player
  // performing the sequence and watching nothing move concludes it is broken and cancels.
  test("status paragraph: confirmed count lead + verbatim batching copy", () => {
    render(view());
    expect(screen.getByText("The server has confirmed 1 of 3.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /DayZ reports emotes in batches — confirmations land up to 15 minutes behind, and this page does not update in real time\. Perform all three and you can log off; the stamp catches up on its own\./,
      ),
    ).toBeInTheDocument();
  });

  test("no copy claims live or instant updates", () => {
    const { container } = render(view());
    expect(container.textContent ?? "").not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });

  test("the old walkthrough list is gone — only the emote list remains", () => {
    render(view());
    expect(screen.queryByRole("list", { name: "How this works" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  test("footer: expiry countdown and a 44pt cancel that fires", () => {
    const onCancel = vi.fn();
    render(view({ onCancel }));
    expect(screen.getByText(/expires in 22h/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Cancel claim" });
    expect(btn.className).toContain("min-h-[44px]");
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalled();
  });

  test("red-deep never appears on the dark hero", () => {
    const { container } = render(view());
    expect(container.innerHTML).not.toContain("red-deep");
  });
});

describe("PendingHeroView — expired", () => {
  test("same frame, kicker still renders, reclaim CTA replaces the tickets", () => {
    const onReclaim = vi.fn();
    const { container } = render(view({ challenge: challenge({ expired: true }), onReclaim }));
    expect(container.querySelector("section")!.className).toContain("bg-dark");
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Your verification for BootsColdwater expired" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new challenge →" }));
    expect(onReclaim).toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("a null challenge renders the expired state", () => {
    render(view({ challenge: null }));
    expect(screen.getByRole("button", { name: "Start a new challenge →" })).toBeInTheDocument();
  });
});
