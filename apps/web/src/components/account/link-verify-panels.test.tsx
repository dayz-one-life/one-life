import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LinkTagPanel } from "./link-panel";
import { searchClaimableGamertags } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  searchClaimableGamertags: vi.fn(async () => ["BOOTSCOLDWATER", "BOOTSNCATS99"]),
}));

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
    const suggestion = await screen.findByRole("option", { name: "BOOTSCOLDWATER" });
    fireEvent.click(suggestion);
    expect((screen.getByLabelText("Gamertag") as HTMLInputElement).value).toBe("BOOTSCOLDWATER");
    await waitFor(() => expect(screen.queryByRole("option", { name: "BOOTSNCATS99" })).not.toBeInTheDocument());
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
    const suggestion = await screen.findByRole("option", { name: "BOOTSCOLDWATER" });
    fireEvent.click(suggestion);
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("option", { name: "BOOTSCOLDWATER" })).not.toBeInTheDocument();
  });

  // LinkTagPanel used to mount twice at once (rail + mobile sheet, both in the
  // root layout at once, one hidden by CSS per breakpoint) — a fixed input/error id would
  // duplicate in the DOM and aria-describedby could resolve to the wrong instance.
  test("two mounted instances get distinct ids for input and error", () => {
    render(
      <>
        <LinkTagPanel onClaim={() => {}} pending={false} error="Tag already claimed" />
        <LinkTagPanel onClaim={() => {}} pending={false} error="Tag already claimed" />
      </>,
    );
    const inputs = screen.getAllByLabelText("Gamertag");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.id).not.toBe(inputs[1]!.id);
    const errors = screen.getAllByRole("alert");
    expect(errors).toHaveLength(2);
    expect(errors[0]!.id).not.toBe(errors[1]!.id);
    expect(inputs[0]).toHaveAttribute("aria-describedby", errors[0]!.id);
    expect(inputs[1]).toHaveAttribute("aria-describedby", errors[1]!.id);
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
    await screen.findByRole("option", { name: "BOOTSNCATS99" }); // second resolves
    resolveFirst(["BOOTSCOLDWATER"]); // stale response lands late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("option", { name: "BOOTSCOLDWATER" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BOOTSNCATS99" })).toBeInTheDocument();
  });
});
