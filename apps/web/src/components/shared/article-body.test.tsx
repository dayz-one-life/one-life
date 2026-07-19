import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ArticleBody } from "@/components/shared/article-body";
import type { ArticleBlock } from "@/lib/types";

const FLAT = "First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.";

describe("ArticleBody — flat fallback (the 168-existing-rows guarantee)", () => {
  it("splits flat prose on blank lines into one <p> per paragraph when blocks is null", () => {
    const { container } = render(<ArticleBody blocks={null} fallback={FLAT} />);
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(3);
    expect(paras[0]!.textContent).toBe("First paragraph.");
    expect(paras[1]!.textContent).toBe("Second paragraph.");
    expect(paras[2]!.textContent).toBe("Third paragraph.");
  });

  it("uses the flat path when blocks is undefined", () => {
    const { container } = render(<ArticleBody fallback={FLAT} />);
    expect(container.querySelectorAll("p")).toHaveLength(3);
  });

  it("uses the flat path when blocks is an empty array", () => {
    const { container } = render(<ArticleBody blocks={[]} fallback={FLAT} />);
    expect(container.querySelectorAll("p")).toHaveLength(3);
  });

  it("uses the flat path when blocks is a malformed non-array (e.g. a stray JSON object)", () => {
    const malformed = { type: "para" } as unknown as ArticleBlock[];
    const { container } = render(<ArticleBody blocks={malformed} fallback={FLAT} />);
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(3);
    expect(paras[0]!.textContent).toBe("First paragraph.");
    expect(paras[1]!.textContent).toBe("Second paragraph.");
    expect(paras[2]!.textContent).toBe("Third paragraph.");
  });

  it("keeps the shared body wrapper classes and appends the caller className", () => {
    const { container } = render(<ArticleBody blocks={null} fallback={FLAT} className="mt-5" />);
    const wrapper = container.firstElementChild!;
    expect(wrapper.className).toContain("space-y-4");
    expect(wrapper.className).toContain("font-mono");
    expect(wrapper.className).toContain("text-[14px]");
    expect(wrapper.className).toContain("leading-relaxed");
    expect(wrapper.className).toContain("text-ink-soft");
    expect(wrapper.className).toContain("mt-5");
  });
});

describe("ArticleBody — block rendering", () => {
  it("renders a para block as a <p>", () => {
    render(<ArticleBody blocks={[{ type: "para", text: "A body paragraph." }]} fallback="unused" />);
    expect(screen.getByText("A body paragraph.")).toBeInTheDocument();
    expect(screen.queryByText("unused")).toBeNull();
  });

  it("renders a subhead block as an h2", () => {
    render(<ArticleBody blocks={[{ type: "subhead", text: "The Last Hour" }]} fallback="unused" />);
    expect(screen.getByRole("heading", { level: 2, name: "The Last Hour" })).toBeInTheDocument();
  });

  it("renders a quote block with its attribution", () => {
    render(<ArticleBody blocks={[{ type: "quote", text: "He never made the treeline.", attribution: "a bystander" }]} fallback="unused" />);
    expect(screen.getByText(/He never made the treeline/)).toBeInTheDocument();
    expect(screen.getByText(/a bystander/)).toBeInTheDocument();
  });

  it("renders a list block as a <ul> with one <li> per item", () => {
    render(<ArticleBody blocks={[{ type: "list", items: ["Rifle", "Bandage", "Nothing else"] }]} fallback="unused" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Rifle", "Bandage", "Nothing else"]);
  });

  it("renders blocks in order and mixes kinds", () => {
    const blocks: ArticleBlock[] = [
      { type: "para", text: "Opening." },
      { type: "subhead", text: "Middle" },
      { type: "para", text: "Closing." },
    ];
    const { container } = render(<ArticleBody blocks={blocks} fallback="unused" />);
    const kids = Array.from(container.firstElementChild!.children);
    expect(kids.map((el) => el.tagName)).toEqual(["P", "H2", "P"]);
    expect(kids.map((el) => el.textContent)).toEqual(["Opening.", "Middle", "Closing."]);
  });

  it("drops an unknown future block type instead of crashing", () => {
    const blocks = [
      { type: "para", text: "Kept." },
      { type: "sidebar-map", text: "From a newer writer." },
    ] as unknown as ArticleBlock[];
    render(<ArticleBody blocks={blocks} fallback="unused" />);
    expect(screen.getByText("Kept.")).toBeInTheDocument();
    expect(screen.queryByText("From a newer writer.")).toBeNull();
  });
});
