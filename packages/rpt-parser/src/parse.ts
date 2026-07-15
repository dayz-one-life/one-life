import { headerDate, TimeTracker } from "./timestamps.js";
import {
  parseTime, parseLoginOpen, parseCreateEntity, parseConnect,
  parseCharBlockStart, parseCharId, parsePlayerId, parseBlockDpnid, parseBlockUid,
} from "./lines.js";

export type CharacterSighting = {
  lineIndex: number;
  uid: string;
  gamertag: string;
  charId: number;
  playerDbId: number | null;
  kind: "existing" | "new";
  characterClass: string | null;
  classSource: "create_entity" | null;
  x: number | null;
  y: number | null;
  z: number | null;
  observedAt: Date;
};

type Pending = {
  gamertag: string;
  uid: string;
  characterClass: string | null;
  classSource: "create_entity" | null;
  openedAt: Date;
};
type Block = { kind: "existing" | "new"; observedAt: Date; lineIndex: number; charId?: number; playerDbId?: number; dpnid?: string; uid?: string };

const LOGIN_TIMEOUT_MS = 120 * 1000;

/** Correlate RPT login blocks into character sightings. Pure; no fallback-(c) entity attribution. */
export function parseRptFile(content: string, opts: { offsetMs: number }): CharacterSighting[] {
  const base = headerDate(content) ?? new Date(Date.UTC(2020, 0, 1));
  const tracker = new TimeTracker(base, opts.offsetMs);
  const lines = content.split(/\r?\n/);
  const pending = new Map<string, Pending>();
  let connect: { gamertag: string; uid: string; x: number; y: number; z: number } | null = null;
  let block: Block | null = null;
  const sightings: CharacterSighting[] = [];

  const finalize = () => {
    if (!block || block.charId == null || block.dpnid == null || block.uid == null) { block = null; return; }
    const p = pending.get(block.dpnid);
    sightings.push({
      lineIndex: block.lineIndex,
      uid: block.uid,
      gamertag: p?.gamertag ?? connect?.gamertag ?? "",
      charId: block.charId,
      playerDbId: block.playerDbId ?? null,
      kind: block.kind,
      characterClass: p?.characterClass ?? null,
      classSource: p?.classSource ?? null,
      x: connect?.x ?? null,
      y: connect?.y ?? null,
      z: connect?.z ?? null,
      observedAt: block.observedAt,
    });
    if (p) pending.delete(block.dpnid);
    block = null;
    connect = null;
  };

  const attach = (cls: string, source: "create_entity") => {
    if (pending.size !== 1) return; // overlapping logins → abstain
    const p = [...pending.values()][0]!;
    if (!p.characterClass) { p.characterClass = cls; p.classSource = source; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // char-block continuation lines are indented and carry no timestamp
    if (block) {
      const cid = parseCharId(line); if (cid != null) { block.charId = cid; continue; }
      const pid = parsePlayerId(line); if (pid != null) { block.playerDbId = pid; continue; }
      const dp = parseBlockDpnid(line); if (dp != null) { block.dpnid = dp; continue; }
      const bu = parseBlockUid(line); if (bu != null) { block.uid = bu; finalize(); continue; }
      block = null; // an unexpected line aborts an incomplete block
    }

    const tp = parseTime(line);
    const now = tp ? tracker.at(tp.h, tp.m, tp.s, tp.frac) : null;

    if (now) {
      for (const [k, p] of pending) {
        if (now.getTime() - p.openedAt.getTime() > LOGIN_TIMEOUT_MS) pending.delete(k);
      }
    }

    const lo = parseLoginOpen(line);
    if (lo && now) { pending.set(lo.dpnid, { gamertag: lo.gamertag, uid: lo.uid, characterClass: null, classSource: null, openedAt: now }); continue; }

    const cls = parseCreateEntity(line);
    if (cls) { attach(cls, "create_entity"); continue; }

    const c = parseConnect(line);
    if (c) { connect = c; continue; }

    const kind = parseCharBlockStart(line);
    if (kind && now) { block = { kind, observedAt: now, lineIndex: i }; continue; }
  }

  return sightings;
}
