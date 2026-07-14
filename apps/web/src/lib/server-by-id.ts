import { getServers } from "./api";

export async function slugForServerId(id: number): Promise<string | null> {
  const servers = await getServers();
  return servers.find((s) => s.id === id)?.slug ?? null;
}
