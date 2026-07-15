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
});
