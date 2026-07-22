import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnlineList } from "./online-list";

const players = [
  { gamertag: "You", friend: false, sharing: true, self: true },
  { gamertag: "Mate", friend: true, sharing: true, self: false },
  { gamertag: "Stranger", friend: false, sharing: false, self: false },
];

describe("OnlineList", () => {
  it("lists everyone online, in the order the server sent", () => {
    render(<OnlineList players={players} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/you/i);
    expect(items[2]).toHaveTextContent(/stranger/i);
  });

  it("marks a sharer with more than colour", () => {
    // Colour alone fails WCAG 1.4.1 — the same rule the in-prose gamertag links follow.
    // Two fixture players share (You and Mate), so this asserts at least one marker exists
    // rather than a single unique match.
    render(<OnlineList players={players} />);
    expect(screen.getAllByText(/on the map/i).length).toBeGreaterThan(0);
  });

  it("says plainly when nobody is online", () => {
    render(<OnlineList players={[]} />);
    expect(screen.getByText(/nobody is on this server/i)).toBeInTheDocument();
  });

  it("is written in dark-surface tokens", () => {
    render(<OnlineList players={players} />);
    for (const li of screen.getAllByRole("listitem")) {
      expect(li.className).not.toMatch(/\btext-ink/);
      expect(li.className).toMatch(/\btext-cream|\btext-paper/);
    }
  });
});
