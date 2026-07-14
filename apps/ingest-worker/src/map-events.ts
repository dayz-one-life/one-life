import type { ParsedLine } from "@onelife/adm-parser";
import type { EventType } from "@onelife/domain";

const KIND_TO_TYPE: Record<ParsedLine["kind"], EventType> = {
  connecting: "player.connecting",
  connected: "player.connected",
  disconnected: "player.disconnected",
  death: "player.died",
  position: "player.position",
  emote: "emote.performed",
  hit: "player.hit",
  build: "build.placed", // refined below per action
  teleport: "player.teleported",
  roster: "roster.snapshot",
  boot: "server.rebooted",
};

const BUILD_ACTION_TO_TYPE: Record<string, EventType> = {
  placed: "build.placed",
  built: "build.built",
  dismantled: "build.dismantled",
  packed: "build.packed",
  repaired: "build.repaired",
};

export function mapParsedToEvents(parsed: ParsedLine[]): { type: EventType; payload: unknown }[] {
  return parsed.map((p) => {
    if (p.kind === "build") {
      const { kind, ...payload } = p;
      return { type: BUILD_ACTION_TO_TYPE[p.action]!, payload };
    }
    const { kind, ...payload } = p as ParsedLine & Record<string, unknown>;
    return { type: KIND_TO_TYPE[p.kind], payload };
  });
}
