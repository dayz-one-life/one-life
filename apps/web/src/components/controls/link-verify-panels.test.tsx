import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import { searchClaimableGamertags } from "@/lib/api";
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

  test("claim errors announce via role=alert", () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error="Tag already claimed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Tag already claimed");
  });

  test("claim error ties to the gamertag input via aria-describedby and aria-invalid", () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error="Tag already claimed" />);
    const input = screen.getByLabelText("Gamertag");
    expect(input).toHaveAccessibleDescription("Tag already claimed");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  test("no error means no aria-invalid on the gamertag input", () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    expect(screen.getByLabelText("Gamertag")).not.toHaveAttribute("aria-invalid");
  });

  test("picking a suggestion does not reopen the dropdown after the debounce window", async () => {
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "Boots" } });
    const suggestion = await screen.findByRole("button", { name: "BOOTSCOLDWATER" });
    fireEvent.click(suggestion);
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("button", { name: "BOOTSCOLDWATER" })).not.toBeInTheDocument();
  });

  test("a stale slow response cannot overwrite newer results", async () => {
    const mock = vi.mocked(searchClaimableGamertags);
    let resolveFirst: (v: string[]) => void = () => {};
    mock.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));
    mock.mockImplementationOnce(async () => ["BOOTSNCATS99"]);
    render(<LinkTagPanel onClaim={() => {}} pending={false} error={null} />);
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "Boots" } });
    await new Promise((r) => setTimeout(r, 250)); // first (hanging) request issued
    fireEvent.change(screen.getByLabelText("Gamertag"), { target: { value: "BootsN" } });
    await screen.findByRole("button", { name: "BOOTSNCATS99" }); // second resolves
    resolveFirst(["BOOTSCOLDWATER"]); // stale response lands late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "BOOTSCOLDWATER" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BOOTSNCATS99" })).toBeInTheDocument();
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

  test("cancel claim is a 44pt target below xl and announces nothing by itself", () => {
    render(<ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    const btn = screen.getByRole("button", { name: "Cancel claim" });
    expect(btn.className).toContain("min-h-[44px]");
    expect(btn.className).toContain("xl:min-h-0");
  });

  test("progress is announced via a role=status region keyed to progressIndex", () => {
    const { rerender } = render(
      <ProveItPanel gamertag="Boots" challenge={challenge({ progressIndex: 1 })} now={NOW} onCancel={() => {}} onReclaim={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3 confirmed");
    rerender(
      <ProveItPanel gamertag="Boots" challenge={challenge({ progressIndex: 2 })} now={NOW} onCancel={() => {}} onReclaim={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3 confirmed");
  });

  test("the status region is a separate node from the progress list", () => {
    render(<ProveItPanel gamertag="Boots" challenge={challenge({})} now={NOW} onCancel={() => {}} onReclaim={() => {}} />);
    const status = screen.getByRole("status");
    expect(status.tagName).not.toBe("OL");
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
