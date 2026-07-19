import {
  pgTable, bigserial, integer, text, timestamp, boolean, jsonb,
  bigint, uniqueIndex, index, doublePrecision, customType,
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
  gamertag: text("gamertag").notNull(),
  dayzId: text("dayz_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => ({
  uniq: uniqueIndex("players_gamertag_uniq").on(t.gamertag),
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
  // The instant this life became qualified (earliest of: playtime crossing QUALIFY_SECONDS,
  // first kill in the life, pvp death). Written WRITE-ONCE by the projector fold; null until
  // the life qualifies. Materializes what lifeQualifiedAt() computes at read time.
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
}, (t) => ({
  byPlayer: index("lives_player_idx").on(t.serverId, t.playerId),
  qualifiedAtIdx: index("lives_qualified_at_idx").on(t.qualifiedAt).where(sql`${t.qualifiedAt} IS NOT NULL`),
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
  gamertag: text("gamertag").notNull(),
  status: text("status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqUserGamertag: uniqueIndex("gamertag_links_user_gamertag_uniq").on(t.userId, t.gamertag),
  uniqVerified: uniqueIndex("gamertag_links_verified_uniq").on(t.gamertag).where(sql`${t.status} = 'verified'`),
  uniqUserActive: uniqueIndex("gamertag_links_user_active_uniq").on(t.userId).where(sql`${t.status} IN ('pending','verified')`),
  byGamertag: index("gamertag_links_gamertag_idx").on(t.gamertag),
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

// ── RPT ingest + character mapping (SP5). Durable side-tables — never truncated by projector
// rebuild; nothing here references projection row ids. Console (Xbox) RPT only. ──

export const rptFiles = pgTable("rpt_files", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  path: text("path").notNull(),
  name: text("name").notNull(),
  logDate: timestamp("log_date", { withTimezone: true }),
  lastProcessedLine: integer("last_processed_line").notNull().default(0),
  isComplete: boolean("is_complete").notNull().default(false),
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
}, (t) => ({
  uniqPath: uniqueIndex("rpt_files_server_path_uniq").on(t.serverId, t.path),
}));

// one row per completed login (append-only fact stream)
export const characterSightings = pgTable("character_sightings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  rptFileId: bigint("rpt_file_id", { mode: "number" }).notNull().references(() => rptFiles.id),
  lineIndex: integer("line_index").notNull(),
  uid: text("uid").notNull(),
  gamertag: text("gamertag").notNull(),
  charId: bigint("char_id", { mode: "number" }).notNull(),
  playerDbId: bigint("player_db_id", { mode: "number" }),
  kind: text("kind").notNull(),                       // 'existing' | 'new'
  characterClass: text("character_class"),            // 'SurvivorF_Helga' | null (unresolved)
  classSource: text("class_source"),                  // 'create_entity' | 'head_asset' | 'inherited' | null
  x: doublePrecision("x"), y: doublePrecision("y"), z: doublePrecision("z"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uniq: uniqueIndex("character_sightings_file_line_uniq").on(t.serverId, t.rptFileId, t.lineIndex),
  byGamertag: index("character_sightings_gamertag_idx").on(t.serverId, t.gamertag, t.observedAt),
}));

// rollup: current knowledge per character. NOT unique on (serverId, charId) alone — a wipe
// restarts the charID sequence, so a stale-window + uid match keys the epoch.
export const characters = pgTable("characters", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  charId: bigint("char_id", { mode: "number" }).notNull(),
  uid: text("uid").notNull(),
  characterClass: text("character_class"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uniqEpoch: uniqueIndex("characters_server_char_epoch_uniq").on(t.serverId, t.charId, t.firstSeenAt),
  byCharId: index("characters_char_idx").on(t.serverId, t.charId),
}));

// ── Content engine (R5). Durable side-table — generated editorial content (obituaries first).
// Like `bans`, it references ONLY `servers` and keys the life by the rebuild-stable natural tuple
// (server_id, gamertag, life_started_at) — NO players/lives FK, so a projector rebuild
// (TRUNCATE players,lives ... RESTART IDENTITY CASCADE) neither cascade-wipes it nor stales its
// keys. One row per (kind, life); a failed generation writes a status='failed' stub (content null,
// attempts bumped) so retries are bounded. ──
export const articles = pgTable("articles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),                       // 'obituary' | 'birth_notice' | 'news'
  status: text("status").notNull().default("published"),  // published|failed|retracted
  slug: text("slug"),                                                // null on a failed stub
  serverId: integer("server_id").notNull().references(() => servers.id),
  gamertag: text("gamertag").notNull(),                              // natural-key: player identity
  map: text("map").notNull(),                                         // servers.map codename
  mapSlug: text("map_slug"),                                         // servers.slug (nullable)
  lifeNumber: integer("life_number").notNull(),
  lifeStartedAt: timestamp("life_started_at", { withTimezone: true }).notNull(), // natural-key: which life
  deathAt: timestamp("death_at", { withTimezone: true }),               // obituaries: lives.ended_at (feed order); birth notices: NULL while alive
  timeAliveSeconds: integer("time_alive_seconds").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  longestKillMeters: doublePrecision("longest_kill_meters"),
  cause: text("cause"),
  headline: text("headline"),
  lede: text("lede"),
  body: text("body"),
  pullQuoteText: text("pull_quote_text"),
  pullQuoteAttribution: text("pull_quote_attribution"),
  tags: text("tags").array(),
  facts: jsonb("facts"),                                             // ObituaryFacts snapshot
  promptVersion: text("prompt_version"),
  model: text("model"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  imageUrl: text("image_url"),                                       // reserved for R5c
  imagePrompt: text("image_prompt"),                                // reserved for R5c
  imageKind: text("image_kind"),                                    // reserved for R5c
  imageCaption: text("image_caption"),                              // deadpan caps line under the hero (R5c)
  imageModel: text("image_model"),                                  // image-model provenance (R5c)
  imageAttempts: integer("image_attempts").notNull().default(0),    // image-pass retries, independent of text attempts
  imageError: text("image_error"),                                  // last image-pass failure
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  discordPostedAt: timestamp("discord_posted_at", { withTimezone: true }), // set when the obituary link was posted to Discord; NULL = unposted
  // R5d — kind-agnostic dedupe key for article kinds NOT keyed by a life (news items key on a
  // source-derived string). NULL for obituaries/birth notices, which keep the life natural key.
  naturalKey: text("natural_key"),
  // R5d — rich body as an ordered block array (para|subhead|quote|list). NULL on every pre-R5d
  // row; the web renderer falls back to splitting flat `body` on blank lines when it is NULL.
  bodyBlocks: jsonb("body_blocks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // PARTIAL: only the two life-keyed kinds are constrained by the life tuple. A news row carries
  // no life and must not collide. Because this index is partial, EVERY onConflictDoUpdate that
  // targets it must pass a matching `targetWhere` — see apps/newsdesk/src/{pg-store,birth-pg-store}.ts.
  uniqLife: uniqueIndex("articles_kind_server_gamertag_life_uniq")
    .on(t.kind, t.serverId, t.gamertag, t.lifeStartedAt)
    .where(sql`${t.kind} IN ('obituary','birth_notice')`),
  uniqNaturalKey: uniqueIndex("articles_natural_key_uniq").on(t.naturalKey).where(sql`${t.naturalKey} IS NOT NULL`),
  uniqSlug: uniqueIndex("articles_slug_uniq").on(t.slug),
  feedIdx: index("articles_kind_status_death_idx").on(t.kind, t.status, t.deathAt),
  bornIdx: index("articles_kind_status_born_idx").on(t.kind, t.status, t.lifeStartedAt),
  createdIdx: index("articles_kind_status_created_idx").on(t.kind, t.status, t.createdAt),
  discordUnpostedIdx: index("articles_discord_unposted_idx").on(t.deathAt).where(sql`${t.kind} = 'obituary' AND ${t.status} = 'published' AND ${t.discordPostedAt} IS NULL`),
  imageMissingIdx: index("articles_image_missing_idx").on(t.createdAt).where(sql`${t.status} = 'published' AND ${t.imageUrl} IS NULL`),
}));

// One generated photo per article. Durable like `articles` (never truncated on rebuild); bytes
// live in Postgres so the archive promise and the pg_dump backup cover images too.
export const articleImages = pgTable("article_images", {
  articleId: bigint("article_id", { mode: "number" }).primaryKey().references(() => articles.id, { onDelete: "cascade" }),
  bytes: customType<{ data: Buffer }>({ dataType: () => "bytea" })("bytes").notNull(),
  contentType: text("content_type").notNull(),                      // from the API media_type (png observed)
  width: integer("width"),                                          // parsed from PNG IHDR; null for non-png
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Player notifications. Durable: NOT in apps/projector/src/rebuild.ts's truncate
// list, so a --rebuild never drops a player's inbox. Dedup is the natural_key unique
// index — a PLAIN unique index, so onConflictDoNothing against it takes no targetWhere.
//
// ⚠️ Latent gotcha: some natural keys embed lives.id (e.g. "life_qualified:<lifeId>",
// "milestone:<days>d:<lifeId>"), but rebuild.ts truncates `lives` WITH RESTART IDENTITY,
// so lifeId is reassigned on every projection rebuild — while this table is never
// truncated. After a future rebuild that shifts numbering, a legitimately-qualifying life
// could collide with a stale key left by a retired life and silently get no notification
// (the row already "exists" per the unique index). Zero impact today (table is empty at
// rebuild time in this release) and partially self-correcting since replay is
// deterministic, but a real risk once notifications have accumulated across a rebuild.
// Not fixed here — flagging for whoever changes the key scheme or the rebuild strategy. ──

export const notifications = pgTable("notifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  naturalKey: text("natural_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
}, (t) => ({
  uniqNatural: uniqueIndex("notifications_natural_key_uniq").on(t.naturalKey),
  byUser: index("notifications_user_created_idx").on(t.userId, t.createdAt),
  unpushedIdx: index("notifications_unpushed_idx").on(t.createdAt).where(sql`${t.pushedAt} IS NULL`),
}));

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  failureCount: integer("failure_count").notNull().default(0),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
}, (t) => ({
  uniqEndpoint: uniqueIndex("push_subscriptions_endpoint_uniq").on(t.endpoint),
  byUser: index("push_subscriptions_user_idx").on(t.userId),
}));
