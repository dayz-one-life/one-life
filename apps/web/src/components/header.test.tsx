import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Masthead } from "./header";

const mockPathname = vi.fn(() => "/survivors");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));
vi.mock("@/components/notifications/bell", () => ({ MastheadBell: () => null }));

describe("Masthead", () => {
  it("renders the wordmark home link and all five nav items", () => {
    render(<Masthead />);
    expect(screen.getByRole("link", { name: "One Life — home" })).toHaveAttribute("href", "/");
    for (const label of ["News", "Obituaries", "Fresh Spawns", "Survivors", "About"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
  });

  it("marks the active section with aria-current and red", () => {
    mockPathname.mockReturnValue("/survivors/sakhal");
    render(<Masthead />);
    const link = screen.getAllByRole("link", { name: "Survivors" })[0]!;
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("text-red");
  });

  it("opens and closes the mobile menu", async () => {
    render(<Masthead />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Close menu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("button", { name: "Close menu" })).not.toBeInTheDocument();
  });
});
