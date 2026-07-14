export type AdmFileRef = {
  path: string; name: string; localTimestampMs: number | null; modifiedAtMs: number;
};

const API_BASE = "https://api.nitrado.net";
const FILENAME_RE = /DayZServer_X1_x64_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.ADM$/;

export class NitradoClient {
  constructor(
    private token: string,
    private serviceId: number,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async getJson(path: string): Promise<any> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Nitrado ${res.status} for ${path}`);
    return res.json();
  }

  private parseFilenameTs(name: string): number | null {
    const m = FILENAME_RE.exec(name);
    if (!m) return null;
    return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  }

  async listAdmFiles(): Promise<AdmFileRef[]> {
    const gs = await this.getJson(`/services/${this.serviceId}/gameservers`);
    const base = gs?.data?.gameserver?.game_specific?.path;
    if (!base) throw new Error("Nitrado: could not resolve gameserver path");
    const listing = await this.getJson(
      `/services/${this.serviceId}/gameservers/file_server/list?dir=${encodeURIComponent(base + "config")}`,
    );
    const entries: any[] = listing?.data?.entries ?? [];
    const files: AdmFileRef[] = entries
      .filter((e) => typeof e.name === "string" && e.name.endsWith(".ADM") && e.path)
      .map((e) => ({
        path: e.path as string,
        name: e.name as string,
        localTimestampMs: this.parseFilenameTs(e.name),
        modifiedAtMs: (e.modified_at ?? 0) * 1000,
      }));
    files.sort((a, b) => (a.localTimestampMs ?? 0) - (b.localTimestampMs ?? 0)); // oldest-first
    return files;
  }

  async downloadFile(filePath: string): Promise<string> {
    const dl = await this.getJson(
      `/services/${this.serviceId}/gameservers/file_server/download?file=${encodeURIComponent(filePath)}`,
    );
    const url = dl?.data?.token?.url;
    if (!url) throw new Error("Nitrado: no download url returned");
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`Nitrado download ${res.status}`);
    return res.text();
  }
}
