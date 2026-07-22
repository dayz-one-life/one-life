export type AdmFileRef = {
  path: string; name: string; localTimestampMs: number | null; modifiedAtMs: number;
};

const API_BASE = "https://api.nitrado.net";
const FILENAME_RE = /DayZServer_X1_x64_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(?:ADM|RPT)$/;

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

  private async postJson(path: string, body: unknown): Promise<any> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Nitrado POST ${res.status} for ${path}`);
    const json = await res.json();
    if (json?.status !== "success") throw new Error(`Nitrado settings error: ${json?.status}`);
    return json;
  }

  // ── Ban list (name-based). Stored as a single \r\n-joined string in settings.general.bans;
  // every mutation is a whole-field read-modify-write. ──

  async getBans(): Promise<string[]> {
    const json = await this.getJson(`/services/${this.serviceId}/gameservers/settings`);
    if (json?.status !== "success") throw new Error(`Nitrado settings error: ${json?.status}`);
    const raw: string = json?.data?.settings?.general?.bans ?? "";
    return raw.split(/\r\n|\r|\n/).map((s) => s.trim()).filter((s) => s !== "");
  }

  private async setBans(names: string[]): Promise<void> {
    await this.postJson(`/services/${this.serviceId}/gameservers/settings`, {
      category: "general",
      key: "bans",
      value: names.join("\r\n"),
    });
  }

  async addBan(gamertag: string): Promise<void> {
    const bans = await this.getBans();
    if (bans.includes(gamertag)) return; // idempotent
    await this.setBans([...bans, gamertag]);
  }

  async removeBan(gamertag: string): Promise<void> {
    const bans = await this.getBans();
    await this.setBans(bans.filter((b) => b !== gamertag));
  }

  // ── Batched ban-list mutation. Every mutation is a whole-field read-modify-write of one
  // \r\n-joined string, so a caller needing N entries must NOT loop over addBan/removeBan:
  // that is N round trips with a lost-update window between each. Both methods below do
  // exactly one read and, when something actually changed, exactly one write.
  async addBans(names: string[]): Promise<void> {
    const wanted = names.map((n) => n.trim()).filter((n) => n !== "");
    if (wanted.length === 0) return;
    const bans = await this.getBans();
    const missing = wanted.filter((n) => !bans.includes(n));
    if (missing.length === 0) return; // nothing to do — do not rewrite the field
    await this.setBans([...bans, ...missing]);
  }

  async removeBans(names: string[]): Promise<void> {
    const doomed = new Set(names.map((n) => n.trim()).filter((n) => n !== ""));
    if (doomed.size === 0) return;
    const bans = await this.getBans();
    const kept = bans.filter((b) => !doomed.has(b));
    if (kept.length === bans.length) return; // nothing was present — do not rewrite
    await this.setBans(kept);
  }

  /** Restart this service's game server (fire immediately, no warning message). */
  async restartServer(): Promise<void> {
    await this.postJson(`/services/${this.serviceId}/gameservers/restart`, {});
  }

  private parseFilenameTs(name: string): number | null {
    const m = FILENAME_RE.exec(name);
    if (!m) return null;
    return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  }

  private async listLogFiles(ext: ".ADM" | ".RPT"): Promise<AdmFileRef[]> {
    const gs = await this.getJson(`/services/${this.serviceId}/gameservers`);
    const base = gs?.data?.gameserver?.game_specific?.path;
    if (!base) throw new Error("Nitrado: could not resolve gameserver path");
    const listing = await this.getJson(
      `/services/${this.serviceId}/gameservers/file_server/list?dir=${encodeURIComponent(base + "config")}`,
    );
    const entries: any[] = listing?.data?.entries ?? [];
    const files: AdmFileRef[] = entries
      .filter((e) => typeof e.name === "string" && e.name.endsWith(ext) && e.path)
      .map((e) => ({
        path: e.path as string,
        name: e.name as string,
        localTimestampMs: this.parseFilenameTs(e.name),
        modifiedAtMs: (e.modified_at ?? 0) * 1000,
      }));
    files.sort((a, b) => (a.localTimestampMs ?? 0) - (b.localTimestampMs ?? 0)); // oldest-first
    return files;
  }

  async listAdmFiles(): Promise<AdmFileRef[]> {
    return this.listLogFiles(".ADM");
  }

  async listRptFiles(): Promise<AdmFileRef[]> {
    return this.listLogFiles(".RPT");
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
