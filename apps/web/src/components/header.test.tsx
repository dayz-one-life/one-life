// apps/web/src/components/header.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Masthead } from "./header";
import { MastheadSlot } from "./masthead-slot";
import type { GamertagLink } from "@/lib/types";

function renderMasthead() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Masthead />
    </QueryClientProvider>,
  );
}

describe("Masthead", () => {
  it("shows the logo and a Survivors nav link", async () => {
    renderMasthead();
    expect(screen.getByAltText(/one life/i)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /survivors/i })).toHaveAttribute("href", "/survivors");
  });
});

const link = (over: Partial<GamertagLink>): GamertagLink => ({
  id: 1, serverId: 1, gamertag: "GHOST_ACTOR", status: "verified",
  verifiedAt: "2026-07-14T00:00:00Z", challenge: null, ...over,
});

describe("MastheadSlot", () => {
  it("renders nothing when signed out", () => {
    const { container } = render(<MastheadSlot status={{ kind: "signedOut" }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows a loading placeholder", () => {
    render(<MastheadSlot status={{ kind: "loading" }} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
  it("shows a quiet Account link when unlinked or pending", () => {
    render(<MastheadSlot status={{ kind: "unlinked" }} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });
  it("shows the pending user a quiet Account link", () => {
    render(<MastheadSlot status={{ kind: "pending", link: link({ status: "pending", verifiedAt: null }) }} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });
  it("shows the amber gamertag CTA when verified", () => {
    render(<MastheadSlot status={{ kind: "verified", link: link({}) }} />);
    const cta = screen.getByRole("link", { name: "GHOST_ACTOR" });
    expect(cta).toHaveAttribute("href", "/players/ghost-actor");
    expect(cta.className).toContain("bg-amber");
  });
});
