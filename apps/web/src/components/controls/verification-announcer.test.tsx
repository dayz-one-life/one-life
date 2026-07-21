import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { VerificationAnnouncer } from "./verification-announcer";

describe("VerificationAnnouncer", () => {
  test("announces once on the pending -> verified transition", () => {
    const { rerender } = render(<VerificationAnnouncer kind="pending" />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    rerender(<VerificationAnnouncer kind="verified" />);
    expect(screen.getByRole("status")).toHaveTextContent("Verification complete");
  });

  test("does not announce on initial mount already verified", () => {
    render(<VerificationAnnouncer kind="verified" />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  test("does not announce for unrelated transitions (e.g. unlinked -> pending)", () => {
    const { rerender } = render(<VerificationAnnouncer kind="unlinked" />);
    rerender(<VerificationAnnouncer kind="pending" />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
