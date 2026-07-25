import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { OnlineFriendsPanel } from "./online-friends";

describe("OnlineFriendsPanel", () => {
  test("lists online friends with their map and the inbound sharing state", () => {
    render(
      <OnlineFriendsPanel
        view={{ kind: "ready", friends: [
          { gamertag: "hartman", slug: "chernarus", map: "chernarusplus", sharing: true },
          { gamertag: "sasha", slug: "sakhal", map: "sakhal", sharing: false },
        ] }}
      />,
    );
    expect(screen.getByText("Friends online · 2")).toBeInTheDocument();
    expect(screen.getByText("Chernarus · shares with you")).toBeInTheDocument();
    expect(screen.getByText("Sakhal · not sharing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /map/i })).toHaveAttribute("href", "/maps");
    expect(screen.getByRole("link", { name: /roster/i })).toHaveAttribute("href", "/friends");
  });

  // Amendment 1 + sub-project E: no mini-map strip, and no share control — sharing lives
  // exclusively on the map's online list. A toggle here would be a control this panel must
  // never grow back.
  test("renders no share control of any kind", () => {
    render(
      <OnlineFriendsPanel
        view={{ kind: "ready", friends: [{ gamertag: "hartman", slug: "chernarus", map: "chernarusplus", sharing: true }] }}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/share my location/i)).toBeNull();
  });

  test("loading, failed and genuinely-empty are three distinct renders", () => {
    const { rerender } = render(<OnlineFriendsPanel view={{ kind: "loading" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/checking/i);
    expect(screen.queryByText(/nobody is on/i)).toBeNull();
    rerender(<OnlineFriendsPanel view={{ kind: "failed" }} />);
    expect(screen.getByText(/couldn.t load friends/i)).toBeInTheDocument();
    expect(screen.queryByText(/nobody is on/i)).toBeNull();
    rerender(<OnlineFriendsPanel view={{ kind: "ready", friends: [] }} />);
    expect(screen.getByText(/nobody is on right now/i)).toBeInTheDocument();
  });

  test("no count is asserted while the list is unresolved", () => {
    render(<OnlineFriendsPanel view={{ kind: "loading" }} />);
    expect(screen.queryByText(/·\s*\d/)).toBeNull();
  });
});
