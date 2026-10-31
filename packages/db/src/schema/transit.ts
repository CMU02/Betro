import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type ReferenceBatchKind = "station_crosswalk" | "track";
export type SourceManifest = Record<string, { fileName: string; sha256: string }>;
export type MatchMethod = "auto-same-line" | "auto-shared" | "manual-alias";
export type TrackDirection = "up" | "down";

export const referenceBatch = sqliteTable("reference_batch", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<ReferenceBatchKind>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  sourceManifest: text("source_manifest", { mode: "json" }).$type<SourceManifest>().notNull(),
  isCurrent: integer("is_current", { mode: "boolean" }).default(false).notNull(),
});

export const stationCrosswalk = sqliteTable(
  "station_crosswalk",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => referenceBatch.id, { onDelete: "cascade" }),
    statnId: text("statn_id").notNull(),
    subwayId: text("subway_id").notNull(),
    lineKey: text("line_key").notNull(),
    stationCd: text("station_cd"),
    frCode: text("fr_code"),
    bldnId: text("bldn_id"),
    nameCanonical: text("name_canonical").notNull(),
    nameAliases: text("name_aliases", { mode: "json" }).$type<string[]>().notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    coordSource: text("coord_source").notNull(),
    matchMethod: text("match_method").$type<MatchMethod>().notNull(),
    qualityFlags: text("quality_flags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [uniqueIndex("station_crosswalk_batch_statn_idx").on(table.batchId, table.statnId)],
);

export const trackShape = sqliteTable(
  "track_shape",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => referenceBatch.id, { onDelete: "cascade" }),
    lineKey: text("line_key").notNull(),
    branchKey: text("branch_key").notNull(),
    direction: text("direction").$type<TrackDirection>().notNull(),
    osmRelationId: integer("osm_relation_id").notNull(),
    coords: text("coords", { mode: "json" }).$type<[number, number][]>().notNull(),
    lengthM: real("length_m").notNull(),
    attribution: text("attribution").notNull(),
  },
  (table) => [uniqueIndex("track_shape_batch_relation_idx").on(table.batchId, table.osmRelationId)],
);

export const trackStation = sqliteTable(
  "track_station",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackShapeId: integer("track_shape_id")
      .notNull()
      .references(() => trackShape.id, { onDelete: "cascade" }),
    statnId: text("statn_id").notNull(),
    seq: integer("seq").notNull(),
    distanceM: real("distance_m").notNull(),
    offsetM: real("offset_m").notNull(),
    osmStopNodeId: integer("osm_stop_node_id"),
  },
  (table) => [
    uniqueIndex("track_station_shape_statn_idx").on(table.trackShapeId, table.statnId),
    index("track_station_statn_idx").on(table.statnId),
  ],
);
