import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorControls } from "./survivor-controls";

describe("SurvivorControls", () => {
  test("sort chip links reset page and mark active", () => {
    render(
      <SurvivorControls
        slug="chernarus"
        sort="kills"
        tabs={[
          { slug: null, label: "All maps" },
          { slug: "chernarus", label: "Chernarus" },
          { slug: "sakhal", label: "Sakhal" },
        ]}
      />
    );
    const longest = screen.getByRole("link", { name: /longest kill/i });
    expect(longest).toHaveAttribute("href", "/survivors/chernarus/longest");
    const chern = screen.getByRole("link", { name: "Chernarus" });
    expect(chern).toHaveAttribute("aria-current", "page");
  });

  test("kills sort chip is active by default and other tabs are not aria-current", () => {
    render(
      <SurvivorControls
        slug={null}
        sort="kills"
        tabs={[
          { slug: null, label: "All maps" },
          { slug: "chernarus", label: "Chernarus" },
        ]}
      />
    );
    const kills = screen.getByRole("link", { name: /^kills$/i });
    expect(kills).toHaveAttribute("aria-current", "page");
    const all = screen.getByRole("link", { name: "All maps" });
    expect(all).toHaveAttribute("aria-current", "page");
    const chern = screen.getByRole("link", { name: "Chernarus" });
    expect(chern).not.toHaveAttribute("aria-current");
  });

  test("sort chips render in order: time alive, kills, longest kill", () => {
    render(
      <SurvivorControls
        slug={null}
        sort="time"
        tabs={[{ slug: null, label: "All maps" }]}
      />
    );
    const chipLabels = ["Time alive", "Kills", "Longest kill"];
    const rendered = screen
      .getAllByRole("link")
      .map((l) => l.textContent)
      .filter((t) => chipLabels.includes(t ?? ""));
    expect(rendered).toEqual(["Time alive", "Kills", "Longest kill"]);
  });

  test("time alive chip link points at sort=time and resets page", () => {
    render(
      <SurvivorControls
        slug={null}
        sort="longest"
        tabs={[{ slug: null, label: "All maps" }]}
      />
    );
    const time = screen.getByRole("link", { name: /time alive/i });
    expect(time).toHaveAttribute("href", "/survivors");
  });

  test("active map tab is solid ink; inactive is outlined", () => {
    render(
      <SurvivorControls
        slug={null}
        sort="time"
        tabs={[
          { slug: null, label: "All maps" },
          { slug: "chernarus", label: "Chernarus" },
        ]}
      />
    );
    const all = screen.getByRole("link", { name: "All maps" });
    expect(all).toHaveAttribute("aria-current", "page");
    expect(all.className).toContain("bg-ink");
    const cherno = screen.getByRole("link", { name: "Chernarus" });
    expect(cherno.className).toContain("border-ink");
    expect(cherno.className).not.toContain(" bg-ink");
  });

  test("active sort is red with a red underline; inactive is muted", () => {
    render(
      <SurvivorControls
        slug={null}
        sort="kills"
        tabs={[{ slug: null, label: "All maps" }]}
      />
    );
    const kills = screen.getByRole("link", { name: "Kills" });
    expect(kills).toHaveAttribute("aria-current", "page");
    expect(kills.className).toContain("text-red-deep");
    expect(kills.className).toContain("border-red");
    expect(screen.getByRole("link", { name: "Time alive" }).className).toContain("text-ink-muted");
  });
});
