import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ControlsPillView, SignInPill } from "./pill";

const line = { text: "Sakhal ban lifts in 13h 58m", tone: "red" as const };

describe("ControlsPillView", () => {
  test("verified pill: label, status line, dots, token count, opens on click", () => {
    const onOpen = vi.fn();
    render(
      <ControlsPillView name="Boots" line={line} dots={["alive", "idle", "banned"]} balance={3} verified open={false} onOpen={onOpen} />,
    );
    const pill = screen.getByRole("button");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Player controls")).toBeInTheDocument();
    expect(screen.getByText("Sakhal ban lifts in 13h 58m")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalled();
  });

  test("unverified pill: no dots, no token count", () => {
    render(
      <ControlsPillView name="Boots" line={{ text: "Link your gamertag →", tone: "dim" }} dots={[]} balance={null} verified={false} open={false} onOpen={() => {}} />,
    );
    expect(screen.getByText("Link your gamertag →")).toBeInTheDocument();
    expect(screen.queryByText("tok")).not.toBeInTheDocument();
  });
});

describe("SignInPill", () => {
  test("links to /login with the sign-in CTA", () => {
    render(<SignInPill />);
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.getByText("Sign in →")).toBeInTheDocument();
  });
});
