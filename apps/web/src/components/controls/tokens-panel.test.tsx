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
    expect(await screen.findByRole("option", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "MeGamer" })).not.toBeInTheDocument();
  });

  test("referrer suggests verified players and excludes the current player", async () => {
    vi.mocked(searchVerifiedGamertags).mockResolvedValueOnce(["MeGamer", "OtherGuy"]);
    render(
      <TokensPanel balance={2} myGamertag="MeGamer" send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Referred by"), { target: { value: "Ga" } });
    expect(await screen.findByRole("option", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "MeGamer" })).not.toBeInTheDocument();
  });

  test("send errors announce via role=alert", () => {
    render(<TokensPanel balance={1} send={{ pending: false, ok: false, error: "Not enough tokens" }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough tokens");
  });

  test("send error ties to its input via aria-describedby and aria-invalid", () => {
    render(<TokensPanel balance={1} send={{ pending: false, ok: false, error: "Not enough tokens" }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    const input = screen.getByLabelText("Send a token to a verified player");
    expect(input).toHaveAccessibleDescription("Not enough tokens");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  test("referrer error ties to its input via aria-describedby and aria-invalid", () => {
    render(<TokensPanel balance={1} send={idle} referrer={{ pending: false, ok: false, error: "Not a verified player" }} onSend={() => {}} onSetReferrer={() => {}} />);
    const input = screen.getByLabelText("Referred by");
    expect(input).toHaveAccessibleDescription("Not a verified player");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  // TokensPanel mounts its own always-present SrStatus PLUS one inside each
  // GamertagAutocomplete (send + referrer, when rendered) — all always-mounted per Finding 1.
  // Disambiguate by picking the one node that actually carries text; the autocompletes' own
  // status regions stay empty in these tests since no search is performed.
  function nonEmptyStatus() {
    const nonEmpty = screen.getAllByRole("status").filter((el) => el.textContent !== "");
    expect(nonEmpty).toHaveLength(1);
    return nonEmpty[0]!;
  }

  test("send success is announced via a role=status region", () => {
    const { rerender } = render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    rerender(<TokensPanel balance={5} send={{ ...idle, ok: true }} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(nonEmptyStatus()).toHaveTextContent("Token sent — balance 5");
  });

  test("referrer success is announced via role=status and survives the form unmounting", () => {
    const { rerender } = render(<TokensPanel balance={2} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    rerender(<TokensPanel balance={2} send={idle} referrer={{ ...idle, ok: true }} onSend={() => {}} onSetReferrer={() => {}} />);
    expect(screen.queryByLabelText("Referred by")).not.toBeInTheDocument();
    expect(nonEmptyStatus()).toHaveTextContent(/referrer set/i);
  });

  // TokensPanel mounts simultaneously on the rail and in the mobile sheet (both live in the
  // root layout at once, one hidden by CSS per breakpoint) — a fixed error-node id would
  // duplicate in the DOM and aria-describedby could resolve to the wrong instance.
  test("two mounted instances get distinct error ids (rail + mobile sheet render simultaneously)", () => {
    const erroring = { pending: false, ok: false, error: "Not enough tokens" };
    render(
      <>
        <TokensPanel balance={1} send={erroring} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />
        <TokensPanel balance={1} send={erroring} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />
      </>,
    );
    const errors = screen.getAllByRole("alert");
    expect(errors).toHaveLength(2);
    expect(errors[0]!.id).not.toBe(errors[1]!.id);
    const inputs = screen.getAllByLabelText("Send a token to a verified player");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveAttribute("aria-describedby", errors[0]!.id);
    expect(inputs[1]).toHaveAttribute("aria-describedby", errors[1]!.id);
  });

  test("inputs are 16px below xl so iOS Safari does not zoom on focus", () => {
    render(<TokensPanel balance={1} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
    const input = screen.getByLabelText("Send a token to a verified player");
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("xl:text-[11.5px]");
  });

  // live-data honesty §5 fix round 1: `balance` is `tokens.data?.balance ?? null → ?? 0` off an
  // unresolved query. TokensPanel is the MOST prominent balance readout (26px number) — it must
  // not assert a fabricated "0" while the tokens query is loading/errored.
  describe("balanceLoading: does not fabricate the balance readout", () => {
    test("does not render the numeral while unresolved, shows a checking affordance instead", () => {
      render(<TokensPanel balance={0} balanceLoading send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      expect(screen.getByText(/checking your balance/i)).toBeInTheDocument();
    });

    // Regression pin (two-surface token rule, CLAUDE.md): TokensPanel always sits on a
    // dark-toned surface (its own `bg-dark` island on the rail, or `boxed` into the already-dark
    // sheet), so the loading chip must carry the dark `bg-dark-well` token, never a light one
    // like `bg-bone`/`bg-paper` — a panel that ships an ink-on-dark token is present in the DOM
    // and fully functional, but invisible on a phone (this exact class of bug shipped in v0.26.0).
    test("the balance-loading chip carries the dark-surface bg-dark-well token, not a light one", () => {
      render(<TokensPanel balance={0} balanceLoading send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
      // The matched text lives on the inner sr-only span; the chip itself (bearing the visible
      // token) is its parent.
      const chip = screen.getByText(/checking your balance/i).parentElement;
      expect(chip).not.toBeNull();
      expect(chip!.className).toContain("bg-dark-well");
      expect(chip!.className).not.toContain("bg-bone");
      expect(chip!.className).not.toContain("bg-paper");
    });

    test("a genuinely-resolved zero balance still renders as the numeral 0", () => {
      render(<TokensPanel balance={0} balanceLoading={false} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
      expect(screen.getByText("0")).toBeInTheDocument();
      expect(screen.queryByText(/checking your balance/i)).not.toBeInTheDocument();
    });

    test("a genuinely-resolved positive balance is unaffected (default balanceLoading is false)", () => {
      render(<TokensPanel balance={3} send={idle} referrer={idle} onSend={() => {}} onSetReferrer={() => {}} />);
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });
});
