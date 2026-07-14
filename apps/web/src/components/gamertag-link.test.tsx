import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GamertagLink } from "./gamertag-link";

describe("GamertagLink", () => {
  it("links to the player's canonical page by slug", () => {
    render(<GamertagLink gamertag="xSgt Hartman" />);
    const link = screen.getByRole("link", { name: "xSgt Hartman" });
    expect(link).toHaveAttribute("href", "/players/xsgt-hartman");
  });
  it("uses the hand font utility", () => {
    render(<GamertagLink gamertag="Twhizzle4life" />);
    expect(screen.getByRole("link").className).toContain("font-hand");
  });
});
