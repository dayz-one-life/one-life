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

  // live-data honesty §5 fix round 2: the pill's "N tok" chip did its own unguarded
  // `balance ?? 0`, fabricating "0 tok" while the tokens query is still loading/errored — right
  // next to the sheet's TokensPanel correctly showing "Checking your tokens…".
  test("verified pill: balance loading shows a loading placeholder, not a fabricated 0", () => {
    render(
      <ControlsPillView
        name="Boots"
        line={line}
        dots={["alive"]}
        balance={null}
        balanceLoading
        verified
        open={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("tok")).not.toBeInTheDocument();
    expect(screen.getByText(/checking your tokens/i)).toBeInTheDocument();
  });

  test("verified pill: a genuinely-resolved zero balance still shows '0 tok' (resolved-zero control)", () => {
    render(
      <ControlsPillView
        name="Boots"
        line={line}
        dots={["alive"]}
        balance={0}
        balanceLoading={false}
        verified
        open={false}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("tok")).toBeInTheDocument();
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
