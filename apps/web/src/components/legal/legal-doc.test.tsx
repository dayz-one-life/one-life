import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { LegalDoc } from "./legal-doc";

const SECTIONS = [
  { id: "who-runs-this", heading: "Who runs this", body: <p>One person, as a hobby.</p> },
  { id: "governing-law", heading: "Governing law", body: <p>Arizona, USA.</p> },
];

const doc = () =>
  render(
    <LegalDoc
      kicker="The fine print"
      title="Terms & Conditions"
      standfirst="These cover the website and the servers."
      effectiveDate="29 July 2026"
      sections={SECTIONS}
    />,
  );

it("renders the title, the standfirst and the effective date", () => {
  doc();
  expect(screen.getByRole("heading", { level: 1, name: "Terms & Conditions" })).toBeInTheDocument();
  expect(screen.getByText("These cover the website and the servers.")).toBeInTheDocument();
  expect(screen.getByText(/Last updated 29 July 2026/)).toBeInTheDocument();
});

it("renders one heading and one body per section, in order", () => {
  doc();
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["Who runs this", "Governing law"]);
  expect(screen.getByText("One person, as a hobby.")).toBeInTheDocument();
  expect(screen.getByText("Arizona, USA.")).toBeInTheDocument();
});

// ⚠️ The id is the whole reason sections are data rather than inline markup: a deletion request
// gets answered with a link straight to the clause. Losing it is silent — the page still renders.
it("gives every section its id as an anchor target, and labels it by its own heading", () => {
  const { container } = doc();
  for (const s of SECTIONS) {
    const el = container.querySelector(`#${s.id}`);
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("SECTION");
    const labelledBy = el!.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(container.querySelector(`#${labelledBy}`)!.textContent).toBe(s.heading);
  }
});

// jsdom cannot see a heading sliding under the sticky masthead, so the contract is pinned as a
// class: without scroll-mt, following a #clause link lands the heading behind the header.
it("offsets anchor scrolling so a linked clause clears the masthead", () => {
  const { container } = doc();
  expect(container.querySelector("#who-runs-this")!.className).toMatch(/scroll-mt-/);
});
