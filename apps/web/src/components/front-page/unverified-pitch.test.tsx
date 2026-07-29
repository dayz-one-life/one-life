import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { UnverifiedPitch } from "./unverified-pitch";
import type { ObituaryCard } from "@/lib/types";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
vi.stubGlobal("ResizeObserver", vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })));

const obit: ObituaryCard = {
  slug: "x-dies", headline: "X Dies", lede: "He did.", gamertag: "X",
  map: "chernarusplus", timeAliveSeconds: 3600,
} as ObituaryCard;

const props = {
  stats: { deaths: 99, alive: 3 },
  obits: [],
};

describe("UnverifiedPitch", () => {
  it("unlinked: renders the pitch beats", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<UnverifiedPitch {...props} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument(); // the ledger h1
    expect(screen.getAllByRole("link", { name: "Link your gamertag →" }).length).toBeGreaterThan(0);
  });

  it("unlinked: Rules → Join → CTA slab → Fallen, in that order; no 'How to connect' landmark", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<UnverifiedPitch {...props} obits={[obit]} />);
    const rules = screen.getByText("Death is real");
    const join = screen.getByRole("heading", { level: 2, name: "Join the servers" });
    const cta = screen.getByRole("heading", { name: /Claim it/i });
    const fallen = screen.getByRole("region", { name: "Recent obituaries" });
    expect(rules.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(join.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cta.compareDocumentPosition(fallen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("region", { name: "How to connect" })).not.toBeInTheDocument();
  });

  // ⚠️ Pending is NOT a pitch audience anymore (pending-verification spec §2): they already
  // claimed, so any "Link your gamertag" CTA here would demand a step they have done. Rendering
  // nothing floats the #claim challenge section to the top of their page.
  it("pending: renders NOTHING — the challenge leads the page instead", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    const { container } = render(<UnverifiedPitch {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["loading", "signedOut", "verified"] as const)("renders NOTHING for %s — no flash", (kind) => {
    mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
    const { container } = render(<UnverifiedPitch {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
