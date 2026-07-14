import { fileURLToPath } from "node:url";

/**
 * Absolute path to the vitest globalSetup file — location-independent for any
 * consuming package's vitest.config.ts.
 *
 * This is intentionally its own leaf module with NO other imports (not even
 * `./guard.js`'s siblings that touch `@onelife/db`). Vite's config loader
 * (`loadConfigFromFile`) bundles vitest.config.ts with esbuild but marks every
 * bare-specifier import as `external` and then does a *plain native Node
 * `import()`* of the resolved file — outside vite-node's module graph, so
 * none of the TS-authored `./foo.js` -> `./foo.ts` remapping that vite-node
 * normally does for workspace packages is available. `@onelife/db`'s sources
 * use that remapping pervasively (e.g. `export * from "./schema.js"` where
 * only `schema.ts` exists), so anything that transitively imports
 * `@onelife/db` at module-evaluation time cannot be loaded from a
 * vitest.config.ts. Keeping this constant's computation free of that import
 * (and importing it via the `@onelife/test-support/setup-path` subpath,
 * bypassing the package's `index.ts` barrel which *does* import
 * `@onelife/db` for `getTestDb`) keeps config loading on the safe, dep-free
 * path. The actual globalSetup file (`./global-setup.ts`) IS loaded through
 * vite-node's runner at test-run time, where `@onelife/db` resolves fine.
 */
export const GLOBAL_SETUP_PATH = fileURLToPath(new URL("./global-setup.ts", import.meta.url));
