import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { AvatarPanel } from "./avatar-panel";
import { ApiError } from "@/lib/api";

const getAvatar = vi.fn();
const uploadAvatar = vi.fn();
const syncAvatar = vi.fn();
const removeAvatar = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAvatar: (...a: unknown[]) => getAvatar(...a),
    uploadAvatar: (...a: unknown[]) => uploadAvatar(...a),
    syncAvatar: (...a: unknown[]) => syncAvatar(...a),
    removeAvatar: (...a: unknown[]) => removeAvatar(...a),
  };
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function file(name = "avatar.png") {
  return new File(["x"], name, { type: "image/png" });
}

describe("AvatarPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAvatar.mockResolvedValue({ hash: null });
  });

  test("shows the silhouette and no fabricated 'no avatar' claim while loading", () => {
    getAvatar.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = wrap(<AvatarPanel />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('span[aria-hidden="true"] svg')).not.toBeNull();
  });

  test("renders the current avatar once resolved", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const { container } = wrap(<AvatarPanel />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/avatars/cafe1234feed5678.webp");
  });

  test("upload announces on settlement, never at click", async () => {
    let resolveUpload!: (v: { hash: string }) => void;
    uploadAvatar.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));
    wrap(<AvatarPanel />);
    const input = screen.getByLabelText("Upload avatar image") as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalled());
    expect(uploadAvatar.mock.calls[0]![0]).toBeInstanceOf(File);
    // Not yet settled — no announcement at click/selection time.
    expect(screen.getByRole("status")).toHaveTextContent("");

    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    await act(async () => {
      resolveUpload({ hash: "cafe1234feed5678" });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar updated"));
  });

  test("upload success invalidates the avatar query, so the panel refetches and shows it", async () => {
    getAvatar.mockResolvedValueOnce({ hash: null });
    uploadAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const { container } = wrap(<AvatarPanel />);
    await waitFor(() => expect(getAvatar).toHaveBeenCalledTimes(1));

    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const input = screen.getByLabelText("Upload avatar image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file()] } });

    await waitFor(() => expect(getAvatar.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/avatars/cafe1234feed5678.webp",
    ));
  });

  test("no_provider_image maps to the mapped visible text on settlement", async () => {
    syncAvatar.mockRejectedValue(new ApiError(409, "no_provider_image"));
    wrap(<AvatarPanel />);
    fireEvent.click(screen.getByRole("button", { name: /refresh from login provider/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Your login method has no avatar to pull."),
    );
  });

  test("too_large maps to the mapped visible text", async () => {
    uploadAvatar.mockRejectedValue(new ApiError(400, "too_large"));
    wrap(<AvatarPanel />);
    const input = screen.getByLabelText("Upload avatar image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("That image is too large (5 MB max)."),
    );
  });

  test("not_an_image maps to the mapped visible text", async () => {
    uploadAvatar.mockRejectedValue(new ApiError(400, "not_an_image"));
    wrap(<AvatarPanel />);
    const input = screen.getByLabelText("Upload avatar image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("That file doesn't look like an image."),
    );
  });

  test("fetch_failed maps to the mapped visible text", async () => {
    syncAvatar.mockRejectedValue(new ApiError(502, "fetch_failed"));
    wrap(<AvatarPanel />);
    fireEvent.click(screen.getByRole("button", { name: /refresh from login provider/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't reach your login provider. Try again."),
    );
  });

  test("remove announces 'Avatar removed' on settlement", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    wrap(<AvatarPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
  });

  test("Remove is disabled when there is no current avatar", async () => {
    getAvatar.mockResolvedValue({ hash: null });
    wrap(<AvatarPanel />);
    await waitFor(() => expect(getAvatar).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  test("buttons disable while a mutation is pending", async () => {
    uploadAvatar.mockReturnValue(new Promise(() => {})); // never resolves during this test
    wrap(<AvatarPanel />);
    const input = screen.getByLabelText("Upload avatar image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file()] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled());
    expect(screen.getByRole("button", { name: /refresh from login provider/i })).toBeDisabled();
  });
});
