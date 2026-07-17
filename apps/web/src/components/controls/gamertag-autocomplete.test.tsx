import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { GamertagAutocomplete } from "./gamertag-autocomplete";

function Harness({
  fetchSuggestions,
  exclude,
}: {
  fetchSuggestions: (q: string) => Promise<string[]>;
  exclude?: string;
}) {
  const [v, setV] = useState("");
  return (
    <GamertagAutocomplete
      value={v}
      onChange={setV}
      fetchSuggestions={fetchSuggestions}
      exclude={exclude}
      aria-label="Field"
    />
  );
}

describe("GamertagAutocomplete", () => {
  test("debounces, then suggests matches", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ot" } });
    expect(await screen.findByRole("button", { name: "OtherGuy" })).toBeInTheDocument();
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions).toHaveBeenCalledWith("Ot");
  });

  test("does not search below the 2-char minimum", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "O" } });
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "OtherGuy" })).not.toBeInTheDocument();
  });

  test("excludes the current player case-insensitively", async () => {
    const fetchSuggestions = vi.fn(async () => ["MeGamer", "OtherGuy"]);
    render(<Harness fetchSuggestions={fetchSuggestions} exclude="megamer" />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ga" } });
    expect(await screen.findByRole("button", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MeGamer" })).not.toBeInTheDocument();
  });

  test("picking a suggestion fills the value and does not reopen the dropdown", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ot" } });
    fireEvent.click(await screen.findByRole("button", { name: "OtherGuy" }));
    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe("OtherGuy");
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("button", { name: "OtherGuy" })).not.toBeInTheDocument();
  });

  test("a stale slow response cannot overwrite newer results", async () => {
    const fetchSuggestions = vi.fn<(q: string) => Promise<string[]>>();
    let resolveFirst: (v: string[]) => void = () => {};
    fetchSuggestions.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));
    fetchSuggestions.mockImplementationOnce(async () => ["SecondResult"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ab" } });
    await new Promise((r) => setTimeout(r, 250)); // first (hanging) request issued
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Abc" } });
    await screen.findByRole("button", { name: "SecondResult" });
    resolveFirst(["FirstResult"]); // stale response lands late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "FirstResult" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SecondResult" })).toBeInTheDocument();
  });
});
