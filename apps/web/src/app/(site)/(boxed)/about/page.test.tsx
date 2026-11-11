import { render, screen } from "@testing-library/react";
import { it, expect, vi } from "vitest";

vi.mock("@/lib/api", () => ({ getServers: vi.fn().mockResolvedValue([]) }));
vi.mock("@/components/front-page/signin-cta", () => ({ SignInCta: () => null }));

import AboutPage from "./page";

// Death-verdict spec 2.4 and residual question Q9: a kill credited from a trap the player set
// qualifies the life exactly as any other kill does, and the rule says so. It also says "kill",
// which is what the code has always done ("throw a punch or take a shot" never qualified a life).
it("the grace rule names a trap", async () => {
  render(await AboutPage());
  const rule = screen.getByText(/Every life opens with five minutes of grace/);
  expect(rule).toHaveTextContent("kill another survivor, or have a trap you set kill one, and the life qualifies early");
  expect(rule).toHaveTextContent("Five minutes of play, or one kill, whichever comes first.");
  expect(rule).not.toHaveTextContent(/throw a punch|take a shot/);
});
