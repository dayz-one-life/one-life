import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServerPickerView } from "./server-picker";

const servers = [
  { slug: "chernarus", name: "Chernarus", map: "chernarusplus", friendCount: 2 },
  { slug: "sakhal", name: "Sakhal", map: "sakhal", friendCount: 0 },
];

describe("ServerPickerView", () => {
  it("prompts a signed-out visitor to sign in, never a blank list", () => {
    render(<ServerPickerView signedOut />);
    expect(screen.getByRole("status")).toHaveTextContent(/sign in/i);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("explains to a signed-in but unverified visitor", () => {
    render(<ServerPickerView unverified />);
    expect(screen.getByRole("status")).toHaveTextContent(/verify/i);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a skeleton while loading, not an empty list", () => {
    const { container } = render(<ServerPickerView loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("distinguishes a failed fetch from an empty list", () => {
    render(<ServerPickerView error />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders a resolved-empty list distinctly from a failed fetch", () => {
    render(<ServerPickerView servers={[]} />);
    expect(screen.getByText(/no active servers/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists servers linking to /maps/{slug} with friend counts", () => {
    render(<ServerPickerView servers={servers} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/maps/chernarus");
    expect(links[0]).toHaveTextContent("Chernarus");
    expect(links[0]).toHaveTextContent("2 sharing");
    expect(links[1]).toHaveAttribute("href", "/maps/sakhal");
    expect(links[1]).toHaveTextContent("No friends sharing");
  });
});
