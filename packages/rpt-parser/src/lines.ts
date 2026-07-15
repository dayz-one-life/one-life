// Pure line matchers for the RPT character signals. Anchored on real 1.29 line formats.

const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})\.(\d+)/;
// pending login opens at the terminal login state (uid is populated by then; may still be empty
// on the earliest states — allow empty). Name may contain spaces → capture up to " (dpnid ".
const LOGIN_RE = /\[StateMachine\]: Player (.+?) \(dpnid (\d+) uid ([A-F0-9]*)\) Entering (GetNewCharLoginState|GetLoadedCharLoginState)/;
// model signal: only Survivor[MF]_ classes from the authoritative Create entity line
// (AI ZmbM_/Animal_ ignored). Head-asset warnings are NOT used — they carry no player identity
// and mis-attribute across players, so create_entity is the single class signal.
const CREATE_RE = /Create entity type '(Survivor[MF]_[A-Za-z0-9]+)'/;
const CONNECT_RE = /Player (.+?) \(id=([A-F0-9]+) pos=<(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)>\) has connected\./;
const CHARBLOCK_RE = /<(LOAD EXISTING|CREATE NEW) CHAR>:/;
const CHARID_RE = /^\s+charID (\d+)/;
const PLAYERID_RE = /^\s+playerID (\d+)/;
const DPNID_RE = /^\s+dpnid (\d+)/;
const UID_RE = /^\s+uid ([A-F0-9]+)/;

export type TimePrefix = { h: number; m: number; s: number; frac: string };
export function parseTime(line: string): TimePrefix | null {
  const m = TIME_RE.exec(line);
  return m ? { h: +m[1]!, m: +m[2]!, s: +m[3]!, frac: m[4]! } : null;
}

export type LoginOpen = { gamertag: string; dpnid: string; uid: string; state: string };
export function parseLoginOpen(line: string): LoginOpen | null {
  const m = LOGIN_RE.exec(line);
  return m ? { gamertag: m[1]!, dpnid: m[2]!, uid: m[3]!, state: m[4]! } : null;
}

export function parseCreateEntity(line: string): string | null {
  const m = CREATE_RE.exec(line);
  return m ? m[1]! : null;
}


export type Connect = { gamertag: string; uid: string; x: number; y: number; z: number };
export function parseConnect(line: string): Connect | null {
  const m = CONNECT_RE.exec(line);
  return m ? { gamertag: m[1]!, uid: m[2]!, x: +m[3]!, y: +m[4]!, z: +m[5]! } : null;
}

export function parseCharBlockStart(line: string): "existing" | "new" | null {
  const m = CHARBLOCK_RE.exec(line);
  return m ? (m[1] === "LOAD EXISTING" ? "existing" : "new") : null;
}

export function parseCharId(line: string): number | null {
  const m = CHARID_RE.exec(line);
  return m ? +m[1]! : null;
}
export function parsePlayerId(line: string): number | null {
  const m = PLAYERID_RE.exec(line);
  return m ? +m[1]! : null;
}
export function parseBlockDpnid(line: string): string | null {
  const m = DPNID_RE.exec(line);
  return m ? m[1]! : null;
}
export function parseBlockUid(line: string): string | null {
  const m = UID_RE.exec(line);
  return m ? m[1]! : null;
}
