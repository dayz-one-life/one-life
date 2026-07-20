import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ArticleHero } from "@/components/shared/article-hero";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

describe("ArticleHero", () => {
  it("renders the image and the mono caption", () => {
    render(<ArticleHero src="/media/heroes/x.png" caption="LAST KNOWN PHOTO" accent="red" />);
    expect(screen.getByText("LAST KNOWN PHOTO")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeTruthy();
  });
  it("renders without a caption line when caption is null", () => {
    render(<ArticleHero src="/media/heroes/x.png" caption={null} accent="blue" />);
    expect(document.querySelector("figcaption")).toBeNull();
  });
  it("renders the ink accent on the caption rule", () => {
    render(<ArticleHero src="/media/heroes/x.png" caption="A ROOM, RECENTLY LEFT" accent="ink" />);
    expect(screen.getByText("A ROOM, RECENTLY LEFT")).toHaveClass("border-ink");
  });
  it("frames the photo 16:9 at the full article-column width", () => {
    render(<ArticleHero src="/media/heroes/x.png" caption={null} accent="ink" />);
    const frame = document.querySelector("figure > div");
    expect(frame).toHaveClass("aspect-video", "w-full");
    expect(frame).not.toHaveClass("max-w-md");
  });
});
