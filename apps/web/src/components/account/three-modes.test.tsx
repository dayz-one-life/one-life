import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TokensSummary } from "./tokens-summary";
import { LadderFrame } from "./ladder-frame";
import type { ServersView } from "@/components/servers/how-to-connect";

const status = vi.hoisted(() => ({ kind: "signedOut" as string }));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => status }));

// Imported after the mock so ColdFork picks it up.
const { ColdFork } = await import("@/components/front-page/cold-fork");

describe("TokensSummary", () => {
  test("a resolved zero renders as a real zero", () => {
    render(<TokensSummary balance={0} loading={false} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  test("renders the resolved balance", () => {
    render(<TokensSummary balance={3} loading={false} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  // ⚠️ Loading must not fabricate a numeral. A "0" here reads as "you have no tokens" — and
  // transitively "you cannot buy your way out of this ban" — from an unknown state.
  // The balance is the only STANDALONE numeric text node — the "+1 every 1st" sub-line has
  // digits of its own, so the assertion is scoped to a bare-number node rather than all text.
  test("loading renders no balance numeral", () => {
    render(<TokensSummary balance={null} loading={true} />);
    expect(screen.getByText(/Checking your balance/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  test("a null balance renders no numeral even when the loading flag is false", () => {
    // Defence in depth: the two must not disagree. `balance === null` is itself unresolved.
    render(<TokensSummary balance={null} loading={false} />);
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  // The summary is not the panel: sending and the referrer live on /you, spending on the ban row.
  test("carries no send form, no referrer field and no spend control", () => {
    render(<TokensSummary balance={2} loading={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // `/tokens` does not exist until sub-project F — a link to a 404 is worse than no link.
  test("has no Earn / buy link yet", () => {
    render(<TokensSummary balance={2} loading={false} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("LadderFrame", () => {
  test("shows all three steps whichever one is current", () => {
    render(<LadderFrame kind="unlinked"><p>panel</p></LadderFrame>);
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getByText("Claim your gamertag")).toBeInTheDocument();
    expect(screen.getByText("Prove it's you")).toBeInTheDocument();
  });

  test("renders the panel exactly once, not once per step", () => {
    render(<LadderFrame kind="pending"><p>panel</p></LadderFrame>);
    expect(screen.getAllByText("panel")).toHaveLength(1);
  });

  test("the step states reach a screen reader, not only the decorative pips", () => {
    // The marks are aria-hidden, so without the sr-only text all three steps sound identical.
    render(<LadderFrame kind="unlinked"><p>panel</p></LadderFrame>);
    expect(screen.getByText(/— current step/)).toBeInTheDocument();
    expect(screen.getAllByText(/— done/).length).toBeGreaterThan(0);
    expect(screen.getByText(/— not yet/)).toBeInTheDocument();
  });

  test("is a real ordered list, so the sequence is exposed", () => {
    render(<LadderFrame kind="unlinked"><p>panel</p></LadderFrame>);
    expect(screen.getByRole("list", { name: "Getting set up" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("ColdFork", () => {
  const view: ServersView = { kind: "ready", names: ["Chernarus"] };

  test("shows both branches to a signed-out visitor", () => {
    status.kind = "signedOut";
    render(<ColdFork servers={view} />);
    expect(screen.getByText("Already playing?")).toBeInTheDocument();
    expect(screen.getByText("New here?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Claim your life/ })).toHaveAttribute("href", "/login");
  });

  test("carries the How to connect panel in the new-here branch", () => {
    status.kind = "signedOut";
    render(<ColdFork servers={view} />);
    expect(screen.getByRole("region", { name: "How to connect" })).toBeInTheDocument();
  });

  // ⚠️ A signed-in player must never see a sign-in pitch — including during the identity flicker.
  test.each(["loading", "unlinked", "pending", "verified"])("renders nothing when %s", (kind) => {
    status.kind = kind;
    const { container } = render(<ColdFork servers={view} />);
    expect(container).toBeEmptyDOMElement();
  });
});
