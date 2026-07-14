/** Throws unless the URL's database name ends in `_test`. Fail-closed. */
export function assertTestDatabase(url: string): void {
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, "").split("/").pop() ?? "";
  } catch {
    throw new Error(`Refusing to run tests: invalid database URL.`);
  }
  if (!/_test$/i.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name || "(none)"}". ` +
      `The test database name must end in "_test". Set TEST_DATABASE_URL to a *_test database ` +
      `(default postgres://onelife:onelife@localhost:5432/onelife_test). This guard prevents ` +
      `accidentally running the destructive test suite against dev or production data.`,
    );
  }
}

export const DEFAULT_TEST_DATABASE_URL = "postgres://onelife:onelife@localhost:5432/onelife_test";

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}
