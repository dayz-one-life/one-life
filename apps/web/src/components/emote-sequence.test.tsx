import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmoteSequence } from "./emote-sequence";

describe("EmoteSequence", () => {
  const challenge = { sequence: ["Wave", "Salute", "Point"], progressIndex: 1, expiresAt: "2026-07-10T12:00:00.000Z", expired: false };

  it("lists every emote in order and marks completed ones", () => {
    render(<EmoteSequence challenge={challenge} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-done", "true");   // progressIndex 1 → first done
    expect(items[1]).toHaveAttribute("data-done", "false");
    expect(screen.getByText("Wave")).toBeInTheDocument();
    expect(screen.getByText("Salute")).toBeInTheDocument();
  });

  it("shows an expired notice when the challenge is expired", () => {
    render(<EmoteSequence challenge={{ ...challenge, expired: true }} />);
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });
});
