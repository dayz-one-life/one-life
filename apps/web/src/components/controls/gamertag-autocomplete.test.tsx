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
    expect(await screen.findByRole("option", { name: "OtherGuy" })).toBeInTheDocument();
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions).toHaveBeenCalledWith("Ot");
  });

  test("does not search below the 2-char minimum", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "O" } });
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "OtherGuy" })).not.toBeInTheDocument();
  });

  test("excludes the current player case-insensitively", async () => {
    const fetchSuggestions = vi.fn(async () => ["MeGamer", "OtherGuy"]);
    render(<Harness fetchSuggestions={fetchSuggestions} exclude="megamer" />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ga" } });
    expect(await screen.findByRole("option", { name: "OtherGuy" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "MeGamer" })).not.toBeInTheDocument();
  });

  test("picking a suggestion fills the value and does not reopen the dropdown", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ot" } });
    fireEvent.click(await screen.findByRole("option", { name: "OtherGuy" }));
    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe("OtherGuy");
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("option", { name: "OtherGuy" })).not.toBeInTheDocument();
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
    await screen.findByRole("option", { name: "SecondResult" });
    resolveFirst(["FirstResult"]); // stale response lands late
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("option", { name: "FirstResult" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "SecondResult" })).toBeInTheDocument();
  });

  test("input is a combobox wired to the listbox, collapsed until results arrive", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    const input = screen.getByRole("combobox", { name: "Field" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-controls", "");
    fireEvent.change(input, { target: { value: "Ot" } });
    const listbox = await screen.findByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  test("ArrowDown/ArrowUp move the highlight and set aria-activedescendant", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    const input = screen.getByRole("combobox", { name: "Field" });
    fireEvent.change(input, { target: { value: "Ot" } });
    const options = await screen.findAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);
  });

  test("Enter selects the highlighted option", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    const input = screen.getByLabelText("Field") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ot" } });
    await screen.findAllByRole("option");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("OtherGuy");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("Escape closes the listbox without clearing the query", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    const input = screen.getByRole("combobox", { name: "Field" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ot" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input.value).toBe("Ot");
  });

  test("a completed search announces the result count via a polite live region", async () => {
    const fetchSuggestions = vi.fn(async () => ["OtherGuy", "OtherGal"]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Ot" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 matches"));
  });

  test("a search with no results announces 'No matches'", async () => {
    const fetchSuggestions = vi.fn(async () => [] as string[]);
    render(<Harness fetchSuggestions={fetchSuggestions} />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "Zz" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No matches"));
  });
});
