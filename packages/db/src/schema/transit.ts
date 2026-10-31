import { sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type ReferenceBatchKind = "station_crosswalk" | "track" | "timetable";
export type SourceManifest = Record<
	string,
	{ fileName: string; sha256: string }
>;
export type MatchMethod = "auto-same-line" | "auto-shared" | "manual-alias";
export type TrackDirection = "up" | "down";
export type ServiceDay = "weekday" | "saturday" | "holiday";
export type ServiceDaySource = "source" | "holiday-copied";
export type ExpressKind = "local" | "express" | "special" | "direct";
export type TimetableSourceKind =
	| "seoul-metro-csv"
	| "kric-korail"
	| "kric-packed"
	| "korail-xlsx"
	| "airport-express-csv"
	| "kric-api";
/** 선 위 역 거리를 정한 방식. OSM 정차 노드(선 위) → 그 노드의 투영 → 역사마스터 좌표 투영 순으로 시도한다. */
export type TrackStationAnchor =
	| "osm-stop"
	| "osm-stop-projected"
	| "station-master";

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
		anchor: text("anchor").$type<TrackStationAnchor>().notNull(),
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

export const timetableTrip = sqliteTable(
	"timetable_trip",
	{
		batchId: integer("batch_id")
			.notNull()
			.references(() => referenceBatch.id, { onDelete: "cascade" }),
		destinationStatnId: text("destination_statn_id"),
		direction: text("direction").$type<TrackDirection>().notNull(),
		express: text("express").$type<ExpressKind>().notNull(),
		id: integer("id").primaryKey({ autoIncrement: true }),
		lineKey: text("line_key").notNull(),
		originStatnId: text("origin_statn_id"),
		qualityFlags: text("quality_flags", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		serviceDay: text("service_day").$type<ServiceDay>().notNull(),
		serviceDaySource: text("service_day_source")
			.$type<ServiceDaySource>()
			.notNull(),
		source: text("source").$type<TimetableSourceKind>().notNull(),
		/** 기준일 YYYY-MM-DD 또는 출처 표기 */
		sourceVersion: text("source_version").notNull(),
		/** 출처 원래 열차 번호 */
		trainNo: text("train_no").notNull(),
	},
	(table) => [
		uniqueIndex("timetable_trip_key_idx").on(
			table.batchId,
			table.source,
			table.lineKey,
			table.serviceDay,
			table.direction,
			table.trainNo
		),
	]
);

export const timetableStopTime = sqliteTable(
	"timetable_stop_time",
	{
		/** 서비스일 0시 기준 초. 24시 이후는 86400 이상. */
		arriveSec: integer("arrive_sec"),
		departSec: integer("depart_sec"),
		id: integer("id").primaryKey({ autoIncrement: true }),
		qualityFlags: text("quality_flags", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		seq: integer("seq").notNull(),
		statnId: text("statn_id").notNull(),
		tripId: integer("trip_id")
			.notNull()
			.references(() => timetableTrip.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("timetable_stop_time_trip_seq_idx").on(table.tripId, table.seq),
		index("timetable_stop_time_statn_idx").on(table.statnId),
	]
);
