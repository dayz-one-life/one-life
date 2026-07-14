import { getServers } from "./api";
import type { Server } from "./types";

export const MAP_SLUGS = ["chernarus", "sakhal"] as const;
export type MapSlug = (typeof MAP_SLUGS)[number];

export async function getServerBySlug(slug: string): Promise<Server | null> {
  const servers = await getServers();
  return servers.find((s) => s.slug === slug) ?? null;
}
