import { describe, it, expect, vi, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, waitFor, cleanup } from "@testing-library/react";
import { ReferralClaim } from "./referral-claim";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ReferralClaim />", () => {
  it("posts exactly once even under StrictMode double-invoke", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    render(
      <StrictMode>
        <ReferralClaim />
      </StrictMode>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("/api/referral/claim", { method: "POST" });
  });

  it("renders nothing", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const { container } = render(<ReferralClaim />);
    expect(container).toBeEmptyDOMElement();
  });
});
