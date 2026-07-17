import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import type { Challenge } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  searchClaimableGamertags: vi.fn(async () => ["BOOTSCOLDWATER", "BOOTSNCATS99"]),
}));

const NOW = new Date("2026-07-16T12:00:00Z").getTime();

describe("LinkTagPanel", () => {
  test("renders headline, strapline, and the 1-token footnote", () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    expect(screen.getByText("Link your gamertag.")).toBeInTheDocument();
    expect(screen.getByText("The Xbox gamertag you play under. One per account.")).toBeInTheDocument();
    expect(screen.getByText("We suggest tags seen on our servers. Verifying earns 1 token.")).toBeInTheDocument();
  });

  test("suggests tags and picking one fills the input", async () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "Boots" } });
    const suggestion = await screen.findByRole("button", { name: "BOOTSCOLDWATER" });
    fireEvent.click(suggestion);
    expect((screen.getByLabelText("Gamertag") as HTMLInputElement).value).toBe("BOOTSCOLDWATER");
    await waitFor(() => expect(screen.queryByRole("button", { name: "BOOTSNCATS99" })).not.toBeInTheDocument());
  });

  test("submits the claim and shows an error", () => {
    const onClaim = vi.fn();
    const { rerender } = render(<LinkTagPanel onClaim={onClaim} pending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "BootsColdwater" } });
    fireEvent.click(screen.getByRole("button", { name: "Claim it" }));
    expect(onClaim).toHaveBeenCalledWith("BootsColdwater");
    rerender(<LinkTagPanel onClaim={onClaim} pending={false} error="That gamertag is already claimed by someone." />);
    expect(screen.getByText("That gamertag is already claimed by someone.")).toBeInTheDocument();
  });
});

const challenge = (over: Partial<Challenge>): Challenge => ({
  sequence: ["facepalm", "salute", "clap"], progressIndex: 1,
  expiresAt: "2026-07-17T10:10:00Z", expired: false, ...over,
});

describe("ProveItPanel", () => {
  test("live challenge: kicker, headline, emote boxes with states, footnote", () => {
    render(<ProveItPanel gamertag="BootsColdwater" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    expect(screen.getByText("Prove it's you")).toBeInTheDocument();
    expect(screen.getByText("BootsColdwater — perform, in order:")).toBeInTheDocument();
    expect(screen.getByText(/expires in 22h/i)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("✓");
    expect(items[1]!.textContent).toContain("←");
    expect(items[0]).toHaveAttribute("data-done", "true");
    expect(screen.getByText("On any One Life server. Other emotes between are fine — order is what counts. Only whoever controls the tag can finish this.")).toBeInTheDocument();
  });

  test("cancel fires", () => {
    const onCancel = vi.fn();
    render(<ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={onCancel} onReclaim={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel claim" }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("expired: reclaim CTA replaces the boxes", () => {
    const onReclaim = vi.fn();
    render(<ProveItPanel gamertag="Boots" challenge={challenge({ expired: true })} now={NOW} onCancel={() => {}} onReclaim={onReclaim} />);
    expect(screen.getByText("Your verification for Boots expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new challenge →" }));
    expect(onReclaim).toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
