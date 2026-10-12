import { getServers } from "./api";
import type { Server } from "./types";

export async function getServerBySlug(slug: string): Promise<Server | null> {
  const servers = await getServers();
  return servers.find((s) => s.slug === slug) ?? null;
}
