export type HttpSendMethod = "POST" | "DELETE" | "PATCH";

/**
 * How a client actually talks to the API. The endpoint catalog is written once against this
 * interface; each client supplies its own implementation:
 *
 *   - apps/web forwards cookies server-side (next/headers) and uses `credentials: "include"`
 *     in the browser.
 *   - the mobile client attaches `Authorization: Bearer <token>` from secure storage.
 *
 * Implementations are responsible for resolving the path to a URL and for running the response
 * through `parse`, so a rejected request always surfaces as an `ApiError`.
 */
export type Transport = {
  get<T>(path: string): Promise<T>;
  send<T>(method: HttpSendMethod, path: string, body?: unknown): Promise<T>;
};
