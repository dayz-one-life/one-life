import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Masthead } from "./header";

function renderMasthead() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Masthead />
    </QueryClientProvider>,
  );
}

describe("Masthead", () => {
  it("shows the logo with alt text and a signed-out account CTA", async () => {
    renderMasthead();
    expect(screen.getByAltText(/one life/i)).toBeInTheDocument();
    // useSession resolves asynchronously (no session in the test env), settling on
    // the signed-out CTA: "Sign in" -> /login.
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("links to the survivors board", async () => {
    renderMasthead();
    expect(screen.getByRole("link", { name: /survivors/i })).toHaveAttribute("href", "/survivors");
  });
});
