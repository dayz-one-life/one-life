import type { FastifyInstance } from "fastify";

export type MinAppVersion = { ios: string; android: string };

/**
 * Publishes the minimum supported mobile app version, per platform. The app checks this at
 * launch and shows a blocking "update required" screen when it falls below its platform's
 * floor; `isUpdateRequired` in `@onelife/client-logic/app-version` does the comparison.
 *
 * Public and unauthenticated on purpose — this is the app's FIRST call, made before sign-in.
 * Gating it behind a session would make an expired token indistinguishable from an app too old
 * to refresh one. It reveals only two version numbers.
 *
 * Returns BOTH platforms rather than taking a `?platform=` parameter: no input to validate, no
 * 400 path, and no way for a future platform to get a confusing error instead of an answer.
 *
 * ⚠️ Deliberately NOT a compatibility check against the caller. The server publishes a floor;
 * the client compares. A header-based gate (`X-App-Version` + 426 from middleware) was
 * rejected — it forces a header onto every request including the website's, for a UX
 * affordance rather than a security boundary. Nothing here defends against a hostile client.
 */
export function registerAppVersionRoute(app: FastifyInstance, min: MinAppVersion): void {
  app.get("/api/app-version", async () => ({
    ios: { minimumVersion: min.ios },
    android: { minimumVersion: min.android },
  }));
}
