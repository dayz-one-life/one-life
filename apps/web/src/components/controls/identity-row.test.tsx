import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { IdentityRow } from "./identity-row";
import { SignInPanel } from "./signin-panel";

describe("IdentityRow", () => {
  test("verified: name, provider line, stamp", () => {
    render(<IdentityRow name="BootsColdwater" provider="discord" verified />);
    expect(screen.getByText("BootsColdwater")).toBeInTheDocument();
    expect(screen.getByText("Via discord")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });
  test("unlinked: tag line joins the provider, no stamp", () => {
    render(<IdentityRow name="boots" provider="discord" tagLine="No gamertag" />);
    expect(screen.getByText("Via discord · No gamertag")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
  test("avatar disc is decorative", () => {
    const { container } = render(<IdentityRow name="Boots" provider={null} />);
    const disc = container.querySelector('[aria-hidden="true"]');
    expect(disc?.textContent).toBe("B");
  });
});

describe("SignInPanel", () => {
  test("renders the CTA headline and login link", () => {
    render(<SignInPanel />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });
});
