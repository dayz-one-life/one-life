import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { UnverifiedPitch } from "./unverified-pitch";
import type { ServersView } from "@/components/servers/how-to-connect";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));

const props = {
  stats: { deaths: 99, alive: 3 },
  obits: [],
  servers: { kind: "ready", names: ["Chernarus"] } satisfies ServersView,
};

describe("UnverifiedPitch", () => {
  it.each(["unlinked", "pending"] as const)("renders the pitch for %s", (kind) => {
    mockStatus.mockReturnValue(kind === "pending" ? { kind, link: { gamertag: "X" } } : { kind });
    render(<UnverifiedPitch {...props} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(); // the ledger h1
    expect(screen.getAllByRole("link", { name: "Link your gamertag →" }).length).toBeGreaterThan(0);
  });

  // dedupe: `unlinked`'s claim-ladder empty state (AccountPanels, not rendered by this component)
  // already carries HowToConnect, so this component must not render ConnectSection for it — that
  // would be a second identically-labelled "How to connect" landmark on one page.
  it("unlinked: does NOT render ConnectSection's copy — the claim ladder's empty state owns it", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<UnverifiedPitch {...props} />);
    expect(screen.queryByText(/Play first, claim later/i)).not.toBeInTheDocument();
  });

  it("pending: DOES render ConnectSection's copy — its ladder step has no connect content of its own", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<UnverifiedPitch {...props} />);
    expect(screen.getByText(/Play first, claim later/i)).toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "verified"] as const)("renders NOTHING for %s — no flash", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = render(<UnverifiedPitch {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
