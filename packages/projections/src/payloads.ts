import { z } from "zod";
import type { EventType } from "@onelife/domain";

export class PayloadError extends Error {}

const gamertag = z.object({ gamertag: z.string(), dayzId: z.string().nullish() });
const death = z.object({ victim: z.string(), cause: z.string(), killer: z.string().nullable(),
  weapon: z.string().nullable(), distance: z.number().nullable(),
  energy: z.number().nullish(), water: z.number().nullish(), bleedSources: z.number().nullish() });
const hit = z.object({ victim: z.string(), attackerType: z.string() }).passthrough();
const build = z.object({ gamertag: z.string(), action: z.string(), object: z.string() }).passthrough();
const position = z.object({ gamertag: z.string(), x: z.number(), y: z.number() });
const boot = z.object({ localDateTime: z.string() });
const passthrough = z.object({}).passthrough();

const SCHEMAS: Partial<Record<EventType, z.ZodType>> = {
  "player.connecting": gamertag, "player.connected": gamertag, "player.disconnected": gamertag,
  "player.died": death, "player.hit": hit, "player.position": position,
  "build.placed": build, "build.built": build, "build.dismantled": build, "build.packed": build, "build.repaired": build,
  "server.rebooted": boot,
  "emote.performed": passthrough, "player.teleported": passthrough, "roster.snapshot": passthrough,
};

export function validatePayload(type: EventType, payload: unknown): Record<string, unknown> {
  const schema = SCHEMAS[type] ?? passthrough;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PayloadError(`invalid payload for ${type}: ${parsed.error.message}`);
  return parsed.data as Record<string, unknown>;
}
