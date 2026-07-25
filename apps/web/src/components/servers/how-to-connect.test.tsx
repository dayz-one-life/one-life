import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Server } from "@/lib/types";
import { HowToConnect, SEARCH_TERM, serversView, type ServersView } from "./how-to-connect";

const server = (name: string): Server => ({
  id: 1, nitradoServiceId: 1, name, map: "chernarusplus", slug: "chernarus",
  active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z",
});

describe("HowToConnect", () => {
  test("names the site-wide search term, not a per-server name", () => {
    render(<HowToConnect servers={{ kind: "ready", names: ["Chernarus", "Sakhal"] }} />);
    // The whole point: one term finds every server. Searching "Chernarus" in the DayZ browser
    // returns thousands of unrelated servers.
    expect(screen.getByText(SEARCH_TERM)).toBeInTheDocument();
    expect(SEARCH_TERM).toBe("One Life");
  });

  test("lists every server it is given, in order", () => {
    render(<HowToConnect servers={{ kind: "ready", names: ["Chernarus", "Sakhal", "Livonia"] }} />);
    expect(screen.getByText("Chernarus, Sakhal, Livonia")).toBeInTheDocument();
  });

  test("scales past the current fleet without a hardcoded count", () => {
    render(<HowToConnect servers={{ kind: "ready", names: ["Chernarus", "Sakhal", "Livonia", "Badlands"] }} />);
    expect(screen.getByText(/Badlands/)).toBeInTheDocument();
  });

  test("there is no join button — a console server has no join URL", () => {
    render(<HowToConnect servers={{ kind: "ready", names: ["Chernarus"] }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // Loading / failed / resolved-empty are three distinct renders (live-data honesty §5).
  test("loading does not assert a list", () => {
    render(<HowToConnect servers={{ kind: "loading" }} />);
    expect(screen.getByText(/Loading the server list/)).toBeInTheDocument();
    expect(screen.queryByText(/No servers are currently listed/)).toBeNull();
  });

  test("a failed fetch says so and never claims there are no servers", () => {
    render(<HowToConnect servers={{ kind: "failed" }} />);
    expect(screen.getByText(/couldn’t load the list/)).toBeInTheDocument();
    // The distinguishing assertion: a failure is NOT evidence the fleet is empty.
    expect(screen.queryByText(/No servers are currently listed/)).toBeNull();
  });

  test("a resolved-empty fleet is its own message, distinct from a failure", () => {
    render(<HowToConnect servers={{ kind: "ready", names: [] }} />);
    expect(screen.getByText(/No servers are currently listed/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t load the list/)).toBeNull();
  });

  test("the search step survives every state — it does not depend on the list", () => {
    const views: ServersView[] = [{ kind: "loading" }, { kind: "failed" }, { kind: "ready", names: [] }];
    for (const view of views) {
      const { unmount } = render(<HowToConnect servers={view} />);
      expect(screen.getByText(SEARCH_TERM)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("serversView", () => {
  test("maps servers to their names", () => {
    expect(serversView([server("Chernarus"), server("Sakhal")])).toEqual({
      kind: "ready", names: ["Chernarus", "Sakhal"],
    });
  });

  test("loading wins over a stale list", () => {
    expect(serversView([server("Chernarus")], { loading: true })).toEqual({ kind: "loading" });
  });

  test("a null list is a failure, never a resolved-empty one", () => {
    // The distinguishing case: `null` must NOT become `{kind:"ready", names:[]}`, which would
    // render "No servers are currently listed" for what is actually an outage.
    expect(serversView(null)).toEqual({ kind: "failed" });
  });

  test("an explicit failure flag beats a present list", () => {
    expect(serversView([server("Chernarus")], { failed: true })).toEqual({ kind: "failed" });
  });

  test("a genuinely empty list stays ready", () => {
    expect(serversView([])).toEqual({ kind: "ready", names: [] });
  });
});
