import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TokensSummary } from "./tokens-summary";

const status = vi.hoisted(() => ({ kind: "signedOut" as string }));
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => status }));

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

  // The summary is not the panel: sending and the referrer live on the full tokens panel on
  // Home, spending on the ban row.
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
