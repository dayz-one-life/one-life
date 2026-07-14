import {
  pgTable, bigserial, integer, text, timestamp, boolean, jsonb,
  bigint, uniqueIndex, index, doublePrecision,
} from "drizzle-orm/pg-core";

export const servers = pgTable("servers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  nitradoServiceId: bigint("nitrado_service_id", { mode: "number" }).notNull(),
  name: text("name").notNull(),
  map: text("map").notNull().default("chernarusplus"),
  slug: text("slug"),
  active: boolean("active").notNull().default(true),
  clockOffsetMs: bigint("clock_offset_ms", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqService: uniqueIndex("servers_nitrado_service_id_uniq").on(t.nitradoServiceId),
  uniqSlug: uniqueIndex("servers_slug_uniq").on(t.slug),
}));

export const admFiles = pgTable("adm_files", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  path: text("path").notNull(),
  name: text("name").notNull(),
  logDate: timestamp("log_date", { withTimezone: true }),
  lastProcessedLine: integer("last_processed_line").notNull().default(0),
  isComplete: boolean("is_complete").notNull().default(false),
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
}, (t) => ({
  uniqPath: uniqueIndex("adm_files_server_path_uniq").on(t.serverId, t.path),
}));

export const rawLines = pgTable("raw_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  admFileId: bigint("adm_file_id", { mode: "number" }).notNull().references(() => admFiles.id),
  lineIndex: integer("line_index").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  text: text("text").notNull(),
}, (t) => ({
  uniqLine: uniqueIndex("raw_lines_file_line_uniq").on(t.admFileId, t.lineIndex),
}));

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  admFileId: bigint("adm_file_id", { mode: "number" }).notNull().references(() => admFiles.id),
  lineIndex: integer("line_index").notNull(),
  subIndex: integer("sub_index").notNull().default(0),
  type: text("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").notNull(),
  rawLineId: bigint("raw_line_id", { mode: "number" }).references(() => rawLines.id),
}, (t) => ({
  uniqEvent: uniqueIndex("events_idempotency_uniq").on(t.serverId, t.admFileId, t.lineIndex, t.subIndex),
  byType: index("events_type_idx").on(t.type),
  byServerOccurred: index("events_server_occurred_idx").on(t.serverId, t.occurredAt),
}));

export const consumerCursors = pgTable("consumer_cursors", {
  consumerName: text("consumer_name").primaryKey(),
  lastEventId: bigint("last_event_id", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable("players", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  gamertag: text("gamertag").notNull(),
  dayzId: text("dayz_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  currentLifeId: bigint("current_life_id", { mode: "number" }),
}, (t) => ({
  uniq: uniqueIndex("players_server_gamertag_uniq").on(t.serverId, t.gamertag),
}));

export const lives = pgTable("lives", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
  lifeNumber: integer("life_number").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  deathCause: text("death_cause"),
  deathByGamertag: text("death_by_gamertag"),
  deathWeapon: text("death_weapon"),
  deathDistance: doublePrecision("death_distance"),
  energyAtDeath: doublePrecision("energy_at_death"),
  waterAtDeath: doublePrecision("water_at_death"),
  bleedSourcesAtDeath: integer("bleed_sources_at_death"),
  playtimeSeconds: integer("playtime_seconds").notNull().default(0),
}, (t) => ({
  byPlayer: index("lives_player_idx").on(t.serverId, t.playerId),
}));

export const sessions = pgTable("sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
  lifeId: bigint("life_id", { mode: "number" }).notNull().references(() => lives.id),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  closeReason: text("close_reason"),
}, (t) => ({
  openByPlayer: index("sessions_open_idx").on(t.serverId, t.playerId, t.disconnectedAt),
}));

export const kills = pgTable("kills", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  killerGamertag: text("killer_gamertag").notNull(),
  killerPlayerId: bigint("killer_player_id", { mode: "number" }),
  victimGamertag: text("victim_gamertag").notNull(),
  victimPlayerId: bigint("victim_player_id", { mode: "number" }),
  victimLifeId: bigint("victim_life_id", { mode: "number" }),
  weapon: text("weapon"),
  distance: doublePrecision("distance"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uniq: uniqueIndex("kills_victim_life_uniq").on(t.serverId, t.victimLifeId),
  byKiller: index("kills_killer_idx").on(t.serverId, t.killerGamertag),
}));

export const hitEvents = pgTable("hit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  victimGamertag: text("victim_gamertag").notNull(),
  victimPlayerId: bigint("victim_player_id", { mode: "number" }),
  attackerGamertag: text("attacker_gamertag"),
  attackerType: text("attacker_type").notNull(),
  attackerLabel: text("attacker_label"),
  bodyPart: text("body_part"),
  victimHp: doublePrecision("victim_hp"),
  x: doublePrecision("x"),
  y: doublePrecision("y"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uniq: uniqueIndex("hit_events_natural_uniq").on(
    t.serverId, t.victimGamertag, t.attackerGamertag, t.attackerType, t.bodyPart, t.occurredAt),
}));

export const buildEvents = pgTable("build_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  gamertag: text("gamertag").notNull(),
  playerId: bigint("player_id", { mode: "number" }),
  lifeId: bigint("life_id", { mode: "number" }),
  action: text("action").notNull(),
  object: text("object").notNull(),
  className: text("class_name"),
  tool: text("tool"),
  x: doublePrecision("x"),
  y: doublePrecision("y"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uniq: uniqueIndex("build_events_natural_uniq").on(
    t.serverId, t.gamertag, t.action, t.object, t.occurredAt),
  byPlayer: index("build_events_player_idx").on(t.serverId, t.playerId),
}));

export const positions = pgTable("positions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
  gamertag: text("gamertag").notNull(),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
}, (t) => ({
  byPlayer: index("positions_player_idx").on(t.serverId, t.playerId, t.recordedAt),
}));
