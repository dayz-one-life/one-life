import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Kicker } from "./kicker";

describe("Kicker", () => {
  test("default red maps to red-deep — small-text red must clear 4.5:1", () => {
    render(<Kicker>The front desk</Kicker>);
    expect(screen.getByText("The front desk").className).toContain("text-red-deep");
    expect(screen.getByText("The front desk").className).not.toContain("text-red ");
  });
});
