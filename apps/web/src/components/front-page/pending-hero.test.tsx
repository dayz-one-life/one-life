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
  sequence: ["facepalm", "salute", "clap"], progressIndex: 1,
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
  test("h1 carries the headline and the gamertag; the step kicker sits above it", () => {
    render(view());
    expect(
      screen.getByRole("heading", { level: 1, name: "Prove it's you BootsColdwater" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText(/one step left/i)).toBeInTheDocument();
  });

  test("is a full-bleed dark hero with the red frame — and red-deep never appears on it", () => {
    const { container } = render(view());
    const section = container.querySelector("section")!;
    expect(section.className).toContain("bg-dark");
    expect(section.className).toContain("border-red");
    expect(container.innerHTML).not.toContain("red-deep");
  });

  test("emote boxes render with done/current states and the expiry countdown", () => {
    render(view());
    expect(screen.getByText(/expires in 22h/i)).toBeInTheDocument();
    const emoteList = screen.getByRole("list", { name: "Emote sequence" });
    const items = within(emoteList).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("✓");
    expect(items[1]!.textContent).toContain("←");
    expect(items[0]).toHaveAttribute("data-done", "true");
    expect(screen.getByText(/Only whoever controls the tag can finish this/)).toBeInTheDocument();
  });

  test("progress is announced via a role=status region, separate from the list", () => {
    const { rerender } = render(view({ challenge: challenge({ progressIndex: 1 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3 confirmed");
    rerender(view({ challenge: challenge({ progressIndex: 2 }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3 confirmed");
    expect(screen.getByRole("status").tagName).not.toBe("OL");
  });

  test("walkthrough: three numbered how-this-works steps", () => {
    render(view());
    const how = screen.getByRole("list", { name: "How this works" });
    const steps = within(how).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0]!.textContent).toMatch(/Join any One Life server/);
    expect(steps[1]!.textContent).toMatch(/in order/);
    expect(steps[2]!.textContent).toMatch(/log off/i);
  });

  // ⚠️ ADM logs arrive in 5–15 minute batches. The hero must set that expectation, or a player
  // performing the sequence and watching nothing move concludes it is broken and cancels.
  test("batching expectation line is present and verbatim", () => {
    render(view());
    expect(
      screen.getByText(
        "DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here. It does not update in real time.",
      ),
    ).toBeInTheDocument();
  });

  test("no copy claims live or instant updates", () => {
    const { container } = render(view());
    expect(container.textContent ?? "").not.toMatch(/instantly|immediately|watch (this|it) update|updates? live/i);
  });

  test("cancel fires and is a 44pt target", () => {
    const onCancel = vi.fn();
    render(view({ onCancel }));
    const btn = screen.getByRole("button", { name: "Cancel claim" });
    expect(btn.className).toContain("min-h-[44px]");
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("PendingHeroView — expired", () => {
  test("same hero frame, expired headline as the h1, reclaim CTA replaces the boxes", () => {
    const onReclaim = vi.fn();
    const { container } = render(
      view({ challenge: challenge({ expired: true }), onReclaim }),
    );
    expect(container.querySelector("section")!.className).toContain("bg-dark");
    expect(
      screen.getByRole("heading", { level: 1, name: "Your verification for BootsColdwater expired" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new challenge →" }));
    expect(onReclaim).toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("a null challenge renders the expired state, never a crash or an empty live board", () => {
    render(view({ challenge: null }));
    expect(screen.getByRole("button", { name: "Start a new challenge →" })).toBeInTheDocument();
  });
});
