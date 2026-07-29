import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CtaSlab } from "./cta-slab";
import type { ServersView } from "@/components/servers/how-to-connect";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));

const servers: ServersView = { kind: "ready", names: ["Chernarus", "Sakhal", "Livonia"] };

describe("CtaSlab", () => {
  it("renders the ask, the CTA and the dark connect panel for signed-out visitors", () => {
    mockStatus.mockReturnValue({ kind: "signedOut" });
    render(<CtaSlab servers={servers} />);
    expect(screen.getByText(/You get one life\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claim your life →" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(/Sign in · Link your gamertag · Your life shows up here/i)).toBeInTheDocument();
    // The slab no longer carries the connect box — that content moved to ConnectSection.
    expect(screen.queryByText("One Life")).not.toBeInTheDocument();
    expect(screen.queryByText(/Play first, claim later/i)).not.toBeInTheDocument();
  });

  it("unverified audience renders without the signedOut gate, with the linked-in copy", () => {
    mockStatus.mockReturnValue({ kind: "unlinked" });
    render(<CtaSlab servers={servers} audience="unverified" />);
    expect(screen.getByText(/You're signed in · Link your gamertag · Your life shows up here/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Link your gamertag →" })).toHaveAttribute("href", "#claim");
  });

  it.each(["loading", "unlinked", "pending", "verified"] as const)(
    "renders nothing for %s",
    (kind) => {
      mockStatus.mockReturnValue(kind === "verified" ? { kind, link: { gamertag: "X" } } : { kind });
      const { container } = render(<CtaSlab servers={servers} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
