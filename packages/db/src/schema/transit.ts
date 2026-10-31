import { sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type ReferenceBatchKind = "station_crosswalk" | "track";
export type SourceManifest = Record<
	string,
	{ fileName: string; sha256: string }
>;
export type MatchMethod = "auto-same-line" | "auto-shared" | "manual-alias";
export type TrackDirection = "up" | "down";

export const referenceBatch = sqliteTable("reference_batch", {
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	id: integer("id").primaryKey({ autoIncrement: true }),
	isCurrent: integer("is_current", { mode: "boolean" })
		.default(false)
		.notNull(),
	kind: text("kind").$type<ReferenceBatchKind>().notNull(),
	sourceManifest: text("source_manifest", { mode: "json" })
		.$type<SourceManifest>()
		.notNull(),
});

export const stationCrosswalk = sqliteTable(
	"station_crosswalk",
	{
		batchId: integer("batch_id")
			.notNull()
			.references(() => referenceBatch.id, { onDelete: "cascade" }),
		bldnId: text("bldn_id"),
		coordSource: text("coord_source").notNull(),
		frCode: text("fr_code"),
		id: integer("id").primaryKey({ autoIncrement: true }),
		lat: real("lat").notNull(),
		lineKey: text("line_key").notNull(),
		lng: real("lng").notNull(),
		matchMethod: text("match_method").$type<MatchMethod>().notNull(),
		nameAliases: text("name_aliases", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		nameCanonical: text("name_canonical").notNull(),
		qualityFlags: text("quality_flags", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		stationCd: text("station_cd"),
		statnId: text("statn_id").notNull(),
		subwayId: text("subway_id").notNull(),
	},
	(table) => [
		uniqueIndex("station_crosswalk_batch_statn_idx").on(
			table.batchId,
			table.statnId
		),
	]
);

export const trackShape = sqliteTable(
	"track_shape",
	{
		attribution: text("attribution").notNull(),
		batchId: integer("batch_id")
			.notNull()
			.references(() => referenceBatch.id, { onDelete: "cascade" }),
		branchKey: text("branch_key").notNull(),
		coords: text("coords", { mode: "json" })
			.$type<[number, number][]>()
			.notNull(),
		direction: text("direction").$type<TrackDirection>().notNull(),
		id: integer("id").primaryKey({ autoIncrement: true }),
		lengthM: real("length_m").notNull(),
		lineKey: text("line_key").notNull(),
		osmRelationId: integer("osm_relation_id").notNull(),
	},
	(table) => [
		uniqueIndex("track_shape_batch_relation_idx").on(
			table.batchId,
			table.osmRelationId
		),
	]
);

export const trackStation = sqliteTable(
	"track_station",
	{
		distanceM: real("distance_m").notNull(),
		id: integer("id").primaryKey({ autoIncrement: true }),
		offsetM: real("offset_m").notNull(),
		osmStopNodeId: integer("osm_stop_node_id"),
		seq: integer("seq").notNull(),
		statnId: text("statn_id").notNull(),
		trackShapeId: integer("track_shape_id")
			.notNull()
			.references(() => trackShape.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("track_station_shape_statn_idx").on(
			table.trackShapeId,
			table.statnId
		),
		index("track_station_statn_idx").on(table.statnId),
	]
);
