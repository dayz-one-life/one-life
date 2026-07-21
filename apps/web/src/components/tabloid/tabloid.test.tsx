import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Kicker } from "./kicker";
import { SectionHeader } from "./section-header";
import { SkewCta } from "./skew-cta";

describe("Kicker", () => {
  it("renders red by default", () => {
    render(<Kicker>About the paper</Kicker>);
    const el = screen.getByText("About the paper");
    expect(el.className).toContain("text-red-deep");
    expect(el.className).toContain("uppercase");
  });
  it("supports semantic colors", () => {
    render(<Kicker color="blue">Birth notices</Kicker>);
    expect(screen.getByText("Birth notices").className).toContain("text-blue");
  });
});

describe("SectionHeader", () => {
  it("renders an h2 and optional action", () => {
    render(<SectionHeader title="Still breathing" action={<a href="/survivors">ALL →</a>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Still breathing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ALL →" })).toBeInTheDocument();
  });
});

describe("SkewCta", () => {
  it("renders a link when href is given", () => {
    render(<SkewCta href="/login">Sign in →</SkewCta>);
    const link = screen.getByRole("link", { name: "Sign in →" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link.className).toContain("bg-red");
  });
  it("renders a button with tone + disabled", () => {
    render(<SkewCta tone="dark" disabled onClick={() => {}}>Send</SkewCta>);
    const btn = screen.getByRole("button", { name: "Send" });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("bg-dark");
  });
});
