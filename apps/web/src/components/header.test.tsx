import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Masthead } from "./header";

describe("Masthead", () => {
  it("shows the logo with alt text and an account link", () => {
    render(<Masthead />);
    expect(screen.getByAltText(/one life/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });
});
