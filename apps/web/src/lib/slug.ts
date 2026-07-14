export function playerSlug(gamertag: string): string {
  return gamertag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
