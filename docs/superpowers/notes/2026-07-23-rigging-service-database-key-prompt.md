# Prompt: add a configurable `database` key to rigging's service containers (Shipyard)

**Run this in a fresh session in the Shipyard repo (`submtd/shipyard`), not in the consuming repo.**

---

## Context

I'm adopting the Shipyard suite in a real repo — `dayz-one-life/one-life`, an org-owned pnpm +
turbo TypeScript monorepo on Postgres, gitflow (`main`/`develop`), fork contributions. This is the
same repo behind issue #24, whose three rigging blockers (pnpm/yarn/bun, custom `testCommand`,
service containers) you already fixed in 0.6.0–0.8.0. Adopting rigging end-to-end surfaced **one
remaining, narrower gap** — the same *shape* as #24: a renderer with no slot for something the
rendered artifact genuinely needs, and no escape hatch, so it can't be corrected from the consuming
repo without hand-editing generated output.

## The defect

rigging's Postgres service **hardcodes the database name to `postgres`** and gives the consuming
repo no way to change it. In `plugins/rigging/rigging/services.py`:

```python
"postgres": ServiceSpec(
    id="postgres",
    image="postgres",
    port=5432,
    env=(("POSTGRES_PASSWORD", "postgres"), ("POSTGRES_DB", "postgres")),
    health_options=f"--health-cmd pg_isready {_HEALTH}",
    url_template="postgresql://postgres:postgres@localhost:{port}/postgres",
),
```

So the only `TEST_DATABASE_URL` rigging can emit ends in `/postgres` (see
`tests/golden/node-postgres.yml`). The per-service config accepts only `{version, urlEnv}`
(`_SERVICE_KEYS` in `config.py`).

**Why that breaks a real repo:** many projects guard their destructive test suite by *database
name* — refusing to run unless the target DB name matches a safe pattern, so a misconfigured
`TEST_DATABASE_URL` can never truncate dev or prod data. `one-life`'s guard throws unless the DB
name ends in `_test`:

```ts
// packages/test-support/src/guard.ts
if (!/_test$/i.test(name)) {
  throw new Error(`Refusing to run tests against database "${name}". ...must end in "_test"...`);
}
```

Its harness *self-creates and migrates* whatever DB the URL names (connects to the maintenance
`postgres` db, `CREATE DATABASE` if missing, migrates, then runs). So if rigging could emit
`.../onelife_test`, the whole job would just work. It can't, so the job dies at the guard, and
there is no legal fix in the consuming repo. Guarding the test DB by name is a common, sensible
safety pattern — rigging shouldn't force it off.

## Goal

Let a repo choose the service database name, so this `.rigging.json`:

```json
{
  "stacks": {
    "node": {
      "packageManager": "pnpm",
      "testCommand": ["turbo", "run", "test", "--concurrency=1"],
      "services": {
        "postgres": { "version": "16", "urlEnv": "TEST_DATABASE_URL", "database": "onelife_test" }
      }
    }
  }
}
```

renders exactly:

```yaml
    services:
      postgres:
        image: "postgres:16"
        env:
          POSTGRES_PASSWORD: "postgres"
          POSTGRES_DB: "onelife_test"
        ports:
          - "5432:5432"
        options: "--health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5"
    env:
      TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/onelife_test"
```

## Hard constraint: byte-identity for existing configs

`database` is **optional**. When omitted, output must be **byte-identical** to today for every
existing golden — `tests/golden/node-postgres.yml` keeps `POSTGRES_DB: "postgres"` and
`.../postgres`; `node-mysql.yml` keeps `MYSQL_DATABASE: "mysql"` and `.../mysql`. Achieve this by
giving each service a **default database** equal to the value it hardcodes today, so an omitted
`database` reproduces the current bytes exactly.

## Design (follow the existing patterns in this engine)

1. **`services.py` — make the DB name a parameter, not a constant.**
   Add two fields to `ServiceSpec`: `database_env: Optional[str]` (the env var that sets the DB —
   `"POSTGRES_DB"` for postgres, `"MYSQL_DATABASE"` for mysql, `None` for redis) and
   `default_database: Optional[str]` (`"postgres"`, `"mysql"`, `None` for redis). Split the static
   `env` so the DB pair is no longer baked in: keep a `base_env` (e.g. the password pair) and
   compose the DB pair at resolve time. Replace the `url` *property* with a method
   `url(database)` (or `connection_url(database)`) whose template interpolates both `port` and the
   chosen `database`. Redis, which has no database concept, keeps `database_env=None`,
   `default_database=None`, and its URL method ignores the argument.

2. **`config.py` — accept and validate `database`.**
   - Add `"database"` to `_SERVICE_KEYS`.
   - Validate its value with a dedicated regex — a DB name that is safe in both a URL path segment
     and a double-quoted YAML scalar. Reuse the strictness style of the file's other patterns
     (letters/digits/underscore/hyphen; no whitespace, no `${{`, nothing needing YAML quoting).
     `fullmatch`, like the rest.
   - **Reject `database` for a service that has no `database_env`** (i.e. redis), the same way
     `_valid_package_manager` rejects `packageManager` for a non-node stack: a silently-discarded
     setting leaves the user believing they configured something. Name the field in the error.
   - Add `database: Optional[str]` to `config.ResolvedService`; thread it through
     `_valid_services`.

3. **`plan.py` — compose env + URL from the chosen database.**
   In `_resolve_services`, pick `database = rs.database or spec.default_database`, build the
   rendered service `env` as `base_env + ((spec.database_env, database),)` when `database_env` is
   set (else just `base_env`), and append `(rs.url_env, spec.url(database))` to the job env. Keep
   config order stable so rendered YAML stays deterministic.

4. **init stays unchanged.** `database` is a manual escape hatch, exactly like `testCommand` and
   `services` already are — `rigging:init` must not propose it, so the #33 round-trip property test
   (init output must load) keeps passing untouched.

## Tests + goldens (this suite is golden/byte-identity disciplined)

- **New golden** `tests/golden/node-postgres-database.yml`: the target output above
  (`database: "onelife_test"`), wired into the render/golden test the same way `node-postgres.yml`
  is.
- **`test_config.py`**: `database` accepted and threaded onto `ResolvedService`; rejected with a
  field-naming `ConfigError` for redis; rejected for a value that fails the regex; omitted →
  `None`.
- **`test_plan.py` / `test_render.py`**: an omitted `database` reproduces the existing postgres and
  mysql bytes (the byte-identity guard); a set `database` changes both the `POSTGRES_DB` env line
  and the URL path segment, and *only* those.
- **`test_services.py`**: `default_database`/`database_env` are correct per service; redis has
  neither.
- **`test_injection.py` / `test_purity.py`**: still green — the change adds no subprocess/os/network
  and no new `${{`-bearing path (the regex refuses expression openers at load).
- Run the whole suite: `pytest` (or the repo's documented command) — all green.

## Docs

- **`CHANGELOG.md`**: add an `### Added` entry under `## [Unreleased]` describing the new
  `services.<id>.database` key, its default-preserves-bytes behaviour, and the redis rejection.
  Reference this as the final increment closing the org-monorepo adoption of rigging (issue #24
  follow-up). Do **not** bump the twelve version files here — that's the release step, done in
  lockstep across all six plugins.
- **`rigging:init` skill + README**: the "not here yet" / capabilities text lists service support —
  update it to note the DB name is now configurable (default `postgres`/`mysql`), so a repo that
  guards its test DB by name can drive rigging end to end.

## Process

Use the repo's own keel lifecycle: `keel:start-work` (feature branch off `develop`), implement TDD,
update `CHANGELOG.md` last, then `keel:finish-work` to open the PR. Keep the change minimal and in
the established style of each file (the dataclass-per-service config, the pure data modules, the
`fullmatch` validators, the golden discipline).

## Acceptance

A `.rigging.json` with `services.postgres.database: "onelife_test"` renders
`TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/onelife_test"` and
`POSTGRES_DB: "onelife_test"`; every existing golden is byte-identical; `database` on redis is a
`ConfigError`; the full test suite is green.
