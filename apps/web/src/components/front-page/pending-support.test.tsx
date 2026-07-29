import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PendingSupport } from "./pending-support";
import type { ObituaryCard } from "@/lib/types";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

const obit: ObituaryCard = {
  slug: "x-dies", headline: "X Dies", lede: "He did.", gamertag: "X",
  map: "chernarusplus", timeAliveSeconds: 3600,
} as ObituaryCard;

describe("PendingSupport", () => {
  it("pending: Rules → Join the servers → obituary wall, in that order", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport obits={[obit]} />);
    const rules = screen.getByText("Death is real");
    const join = screen.getByRole("heading", { level: 2, name: "Join the servers" });
    const fallen = screen.getByRole("region", { name: "Recent obituaries" });
    expect(rules.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(join.compareDocumentPosition(fallen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pending: the closing line is the emote variant, not the cold promise", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport obits={[obit]} />);
    expect(screen.getByText("Any server counts for your emotes.")).toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/)).not.toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "unlinked", "verified"] as const)(
    "renders NOTHING for %s — no flash, no duplicate landmarks",
    (kind) => {
      mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
      const { container } = render(<PendingSupport obits={[obit]} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
