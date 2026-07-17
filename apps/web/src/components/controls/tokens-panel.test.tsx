import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TokensPanel } from "./tokens-panel";
import { searchVerifiedGamertags } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  searchVerifiedGamertags: vi.fn(async () => [] as string[]),
}));

const idle = { pending: false, error: null, ok: false };

describe("TokensPanel", () => {
  test("shows the balance and footnote", () => {
    render(<TokensPanel balance={3} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("+1 every 1st of the month · Transfers are final")).toBeInTheDocument();
  });

  test("send submits the trimmed gamertag", () => {
    const onSend = vi.fn();
    render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={onSend} onSetReferrer={() => {}} />);
    fireEvent.change(screen.getByLabelText("Send a token to a verified player"), { target: { value: "  OtherGuy " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("OtherGuy");
  });

  test("send is disabled at zero balance", () => {
    render(<TokensPanel balance={0} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    fireEvent.change(screen.getByLabelText("Send a token to a verified player"), { target: { value: "X" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("shows the mapped send error", () => {
    render(<TokensPanel balance={2} send={{ ...idle, error: "Not a verified player" }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByText("Not a verified player")).toBeInTheDocument();
  });

  test("send.ok clears the input", () => {
    const { rerender } = render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    const input = screen.getByLabelText("Send a token to a verified player") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "OtherGuy" } });
    rerender(<TokensPanel balance={2} send={{ ...idle, ok: true }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(input.value).toBe("");
  });

  test("referrer row hides after success and under showReferrer=false", () => {
    const { rerender } = render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByLabelText("Referred by")).toBeInTheDocument();
    rerender(<TokensPanel balance={2} send={idle} referrer={{ ...idle, ok: true }} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.queryByLabelText("Referred by")).not.toBeInTheDocument();
    rerender(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} showReferrer={false} />);
    expect(screen.queryByLabelText("Referred by")).not.toBeInTheDocument();
  });

  test("send suggests verified players and excludes the current player", async () => {
    vi.mocked(searchVerifiedGamertags).mockResolvedValueOnce(["MeGamer", "OtherGuy"]);
    render(
      <TokensPanel balance={2} myGamertag="MeGamer" send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Send a token to a verified player"), { target: { value: "Ga" } });
    expect(await screen.findByRole("button", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MeGamer" })).not.toBeInTheDocument();
  });
});
