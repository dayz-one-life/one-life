import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PastLifeCard } from "./past-life-card";

const life: any = { lifeId: 1, serverId: 1, map: "sakhal", slug: "sakh", lifeNumber: 6, startedAt: "2026-07-12T00:00:00Z", endedAt: "2026-07-12T04:00:00Z", timeAliveSeconds: 14400, kills: 5, longestKillMeters: 340, character: null, death: { cause: "pvp", byGamertag: "BanditKing", weapon: "SVD", distanceMeters: 340 }, vitals: { energy: 3200, water: 2800, bleedSources: 2 }, sessions: 3, killList: [{ victimGamertag: "freshmeat", weapon: "Mosin", distanceMeters: 210, occurredAt: "2026-07-12T01:00:00Z" }] };

describe("PastLifeCard", () => {
  it("renders a details summary with map + kills", () => {
    render(<PastLifeCard life={life} />);
    expect(screen.getByText("Sakhal")).toBeInTheDocument();
    expect(screen.getByText(/killed by/i)).toHaveTextContent("BanditKing");
  });
  it("keeps detail in the DOM (SEO) via <details>", () => {
    const { container } = render(<PastLifeCard life={life} />);
    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.getByText("freshmeat")).toBeInTheDocument();
  });
});
