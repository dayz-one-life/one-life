import {
  pgTable, bigserial, integer, text, timestamp, boolean, jsonb,
  bigint, uniqueIndex, index, doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// ── Identity & auth (Better Auth core schema) ──
// No server_id: identity is global. camelCase JS keys are required by the
// Better Auth Drizzle adapter (it matches fields by name).

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gamertagLinks = pgTable("gamertag_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id),
  serverId: integer("server_id").notNull().references(() => servers.id),
  gamertag: text("gamertag").notNull(),
  status: text("status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqUserServerGamertag: uniqueIndex("gamertag_links_user_server_gamertag_uniq").on(t.userId, t.serverId, t.gamertag),
  uniqVerified: uniqueIndex("gamertag_links_verified_uniq").on(t.serverId, t.gamertag).where(sql`${t.status} = 'verified'`),
  byServerGamertag: index("gamertag_links_server_gamertag_idx").on(t.serverId, t.gamertag),
}));

export const verificationChallenges = pgTable("verification_challenges", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  gamertagLinkId: bigint("gamertag_link_id", { mode: "number" }).notNull().references(() => gamertagLinks.id),
  sequence: text("sequence").array().notNull(),
  progressIndex: integer("progress_index").notNull().default(0),
  lastMatchedEventId: bigint("last_matched_event_id", { mode: "number" }).notNull().default(0),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  byLink: index("verification_challenges_link_idx").on(t.gamertagLinkId),
}));

// ── Death-ban enforcement (SP3). Durable side-table — never truncated by projector rebuild;
// keyed on (server_id, gamertag, life_started_at) which survives rebuilds. ──

export const bans = pgTable("bans", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  gamertag: text("gamertag").notNull(),
  lifeStartedAt: timestamp("life_started_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),          // 'qualified_death'
  qualifiedBy: text("qualified_by"),         // 'playtime' | 'kill' | 'pvp-death'
  bannedAt: timestamp("banned_at", { withTimezone: true }).notNull(),      // death time
  expiresAt: timestamp("expires_at", { withTimezone: true }),              // banned_at + BAN_DURATION_HOURS
  status: text("status").notNull().default("pending"),                     // pending|applied|expired|failed|lifted
  dryRun: boolean("dry_run").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqDeath: uniqueIndex("bans_server_gamertag_life_uniq").on(t.serverId, t.gamertag, t.lifeStartedAt),
  byStatus: index("bans_status_idx").on(t.status),
}));

// ── Unban-token economy (SP4). Append-only ledger; balance = SUM(delta) per user;
// idempotency_key makes every grant exactly-once. ──

export const tokenTransactions = pgTable("token_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),        // +1 grant | -1 redeem/transfer_out | +1 transfer_in
  kind: text("kind").notNull(),             // verification|monthly|referral|redeem|transfer_in|transfer_out
  idempotencyKey: text("idempotency_key").notNull(),
  relatedBanId: bigint("related_ban_id", { mode: "number" }),
  counterpartyUserId: text("counterparty_user_id").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqIdem: uniqueIndex("token_tx_idempotency_uniq").on(t.idempotencyKey),
  byUser: index("token_tx_user_idx").on(t.userId),
}));

export const referrals = pgTable("referrals", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }), // one referrer each
  referrerUserId: text("referrer_user_id").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
