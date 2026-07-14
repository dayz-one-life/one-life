export const EVENT_TYPES = [
  "player.connecting",
  "player.connected",
  "player.disconnected",
  "player.died",
  "player.hit",
  "emote.performed",
  "build.placed",
  "build.built",
  "build.dismantled",
  "build.packed",
  "build.repaired",
  "player.teleported",
  "player.position",
  "server.rebooted",
  "roster.snapshot",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
