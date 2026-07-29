import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PendingSupport } from "./pending-support";
import type { ServersView } from "@/components/servers/how-to-connect";
import type { ObituaryCard } from "@/lib/types";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const obit: ObituaryCard = {
  slug: "x-dies", headline: "X Dies", lede: "He did.", gamertag: "X",
  map: "chernarusplus", timeAliveSeconds: 3600,
} as ObituaryCard;

const props = {
  obits: [obit],
  servers: { kind: "ready", names: ["Chernarus"] } satisfies ServersView,
};

describe("PendingSupport", () => {
  it("pending: renders How to connect then the obituary wall, in that order", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport {...props} />);
    const connect = screen.getByRole("region", { name: "How to connect" });
    const fallen = screen.getByRole("region", { name: "Recent obituaries" });
    // DOM order: connect precedes obituaries (Node.compareDocumentPosition is jsdom-safe).
    expect(connect.compareDocumentPosition(fallen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pending with no obituaries: connect renders, the wall renders nothing", () => {
    mockStatus.mockReturnValue({ kind: "pending", link: { gamertag: "X" } });
    render(<PendingSupport {...props} obits={[]} />);
    expect(screen.getByRole("region", { name: "How to connect" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent obituaries" })).not.toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "unlinked", "verified"] as const)(
    "renders NOTHING for %s — no flash, no duplicate landmarks",
    (kind) => {
      mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
      const { container } = render(<PendingSupport {...props} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
