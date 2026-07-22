import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FriendsMapLegend, positionAge } from "./friends-map";

vi.mock("./map-canvas", () => ({ default: () => <div data-testid="canvas" /> }));

const NOW = new Date("2026-07-22T12:00:00Z");

describe("positionAge", () => {
  it("reads as just now under a minute", () => {
    expect(positionAge("2026-07-22T11:59:30Z", NOW)).toBe("just now");
  });
  it("counts whole minutes", () => {
    expect(positionAge("2026-07-22T11:55:00Z", NOW)).toBe("5m ago");
    expect(positionAge("2026-07-22T11:59:00Z", NOW)).toBe("1m ago");
  });
});

describe("FriendsMapLegend", () => {
  const you = { gamertag: "You", x: 1, y: 2, recordedAt: "2026-07-22T11:59:00Z", self: true };
  const mate = { gamertag: "Mate", x: 3, y: 4, recordedAt: "2026-07-22T11:50:00Z", self: false };

  it("lists every dot with its own age", () => {
    render(<FriendsMapLegend positions={[you, mate]} now={NOW} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("You");
    expect(items[0]).toHaveTextContent("1m ago");
    expect(items[1]).toHaveTextContent("Mate");
    expect(items[1]).toHaveTextContent("10m ago");
  });

  it("marks which dot is you", () => {
    render(<FriendsMapLegend positions={[you, mate]} now={NOW} />);
    expect(screen.getByText(/you/i)).toBeInTheDocument();
  });

  it("says plainly when nobody is sharing right now", () => {
    render(<FriendsMapLegend positions={[]} now={NOW} />);
    expect(screen.getByText(/nobody is sharing/i)).toBeInTheDocument();
  });
});
