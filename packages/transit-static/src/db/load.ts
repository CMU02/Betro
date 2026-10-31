import type { Database } from "@Betro/db";
import {
	type ReferenceBatchKind,
	referenceBatch,
	type SourceManifest,
	stationCrosswalk,
	type TrackDirection,
	type TrackStationAnchor,
	timetableStopTime,
	timetableTrip,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import type { CrosswalkRow } from "../crosswalk/match";
import { isLineKey, type LineKey } from "../lines";
import type { Trip } from "../timetable/model";

/** SQLite 바인딩 변수 한도 안에 머물도록 한 번에 넣는 행 수. */
const INSERT_CHUNK_SIZE = 500;
/** timetable_trip은 열이 많아 500행씩, 열이 적은 timetable_stop_time은 2,000행씩 넣는다. */
const TRIP_CHUNK_SIZE = 500;
const STOP_TIME_CHUNK_SIZE = 2000;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** 읽기 전용 배열도 받도록 CrosswalkRow의 배열 필드를 readonly로 푼 형태. */
export type CrosswalkRowInput = Omit<
	CrosswalkRow,
	"nameAliases" | "qualityFlags"
> & {
	nameAliases: readonly string[];
	qualityFlags: readonly string[];
};

export interface TrackStationInput {
	anchor: TrackStationAnchor;
	distanceM: number;
	offsetM: number;
	osmStopNodeId?: number;
	seq: number;
	statnId: string;
}

export interface TrackShapeInput {
	attribution: string;
	branchKey: string;
	coords: [number, number][];
	direction: TrackDirection;
	lengthM: number;
	lineKey: LineKey;
	osmRelationId: number;
	stations: TrackStationInput[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		out.push(items.slice(start, start + size));
	}
	return out;
}

async function insertBatch(
	tx: Transaction,
	kind: ReferenceBatchKind,
	manifest: SourceManifest
): Promise<number> {
	const [batch] = await tx
		.insert(referenceBatch)
		.values({ kind, sourceManifest: manifest })
		.returning({ id: referenceBatch.id });
	if (!batch) {
		throw new Error(`reference_batch insert for ${kind} returned no row`);
	}
	return batch.id;
}

/** 같은 kind의 다른 배치를 내리고 이 배치만 현재 배치로 표시한다. */
async function makeCurrent(
	tx: Transaction,
	kind: ReferenceBatchKind,
	batchId: number
): Promise<void> {
	await tx
		.update(referenceBatch)
		.set({ isCurrent: false })
		.where(and(eq(referenceBatch.kind, kind), ne(referenceBatch.id, batchId)));
	await tx
		.update(referenceBatch)
		.set({ isCurrent: true })
		.where(eq(referenceBatch.id, batchId));
}

/** 한 트랜잭션에서 station_crosswalk 배치를 만들고 행을 넣은 뒤 현재 배치로 바꾼다. */
export async function loadCrosswalk(
	db: Database,
	rows: readonly CrosswalkRowInput[],
	manifest: SourceManifest
): Promise<{ batchId: number }> {
	return await db.transaction(async (tx) => {
		const batchId = await insertBatch(tx, "station_crosswalk", manifest);
		for (const part of chunk(rows, INSERT_CHUNK_SIZE)) {
			// biome-ignore lint/performance/noAwaitInLoops: chunks go in one by one inside the transaction
			await tx.insert(stationCrosswalk).values(
				part.map((row) => ({
					batchId,
					bldnId: row.bldnId,
					coordSource: row.coordSource,
					frCode: row.frCode,
					lat: row.lat,
					lineKey: row.lineKey,
					lng: row.lng,
					matchMethod: row.matchMethod,
					nameAliases: [...row.nameAliases],
					nameCanonical: row.nameCanonical,
					qualityFlags: [...row.qualityFlags],
					stationCd: row.stationCd,
					statnId: row.statnId,
					subwayId: row.subwayId,
				}))
			);
		}
		await makeCurrent(tx, "station_crosswalk", batchId);
		return { batchId };
	});
}

/** 한 트랜잭션에서 track 배치를 만들고 선로 모양과 선 위 역을 넣은 뒤 현재 배치로 바꾼다. */
export async function loadTracks(
	db: Database,
	shapes: readonly TrackShapeInput[],
	manifest: SourceManifest
): Promise<{ batchId: number }> {
	return await db.transaction(async (tx) => {
		const batchId = await insertBatch(tx, "track", manifest);
		for (const shape of shapes) {
			// biome-ignore lint/performance/noAwaitInLoops: each shape id is needed for its station rows
			const [inserted] = await tx
				.insert(trackShape)
				.values({
					attribution: shape.attribution,
					batchId,
					branchKey: shape.branchKey,
					coords: shape.coords,
					direction: shape.direction,
					lengthM: shape.lengthM,
					lineKey: shape.lineKey,
					osmRelationId: shape.osmRelationId,
				})
				.returning({ id: trackShape.id });
			if (!inserted) {
				throw new Error(
					`track_shape insert for relation ${shape.osmRelationId} returned no row`
				);
			}
			for (const part of chunk(shape.stations, INSERT_CHUNK_SIZE)) {
				// biome-ignore lint/performance/noAwaitInLoops: statements in one transaction run one by one
				await tx.insert(trackStation).values(
					part.map((station) => ({
						anchor: station.anchor,
						distanceM: station.distanceM,
						offsetM: station.offsetM,
						osmStopNodeId: station.osmStopNodeId,
						seq: station.seq,
						statnId: station.statnId,
						trackShapeId: inserted.id,
					}))
				);
			}
		}
		await makeCurrent(tx, "track", batchId);
		return { batchId };
	});
}

/** timetable_trip 유일 색인(배치 안에서)과 같은 열로 만든 키. */
function tripKey(trip: {
	direction: string;
	lineKey: string;
	serviceDay: string;
	source: string;
	trainNo: string;
}): string {
	return [
		trip.source,
		trip.lineKey,
		trip.serviceDay,
		trip.direction,
		trip.trainNo,
	].join("|");
}

/**
 * 한 트랜잭션에서 timetable 배치를 만들고 trip(500행씩)과 stop_time(2,000행씩)을 넣은 뒤 현재 배치로 바꾼다.
 * 다중 행 INSERT의 RETURNING 순서는 보장되지 않으므로 돌려받은 id는 trip 유일 키로 짝짓는다.
 */
export async function loadTimetable(
	db: Database,
	trips: readonly Trip[],
	manifest: SourceManifest
): Promise<{ batchId: number }> {
	return await db.transaction(async (tx) => {
		const batchId = await insertBatch(tx, "timetable", manifest);
		for (const part of chunk(trips, TRIP_CHUNK_SIZE)) {
			// biome-ignore lint/performance/noAwaitInLoops: chunks go in one by one inside the transaction
			const inserted = await tx
				.insert(timetableTrip)
				.values(
					part.map((trip) => ({
						batchId,
						destinationStatnId: trip.destinationStatnId,
						direction: trip.direction,
						express: trip.express,
						lineKey: trip.lineKey,
						originStatnId: trip.originStatnId,
						qualityFlags: [...trip.qualityFlags],
						serviceDay: trip.serviceDay,
						serviceDaySource: trip.serviceDaySource,
						source: trip.source,
						sourceVersion: trip.sourceVersion,
						trainNo: trip.trainNo,
					}))
				)
				.returning({
					direction: timetableTrip.direction,
					id: timetableTrip.id,
					lineKey: timetableTrip.lineKey,
					serviceDay: timetableTrip.serviceDay,
					source: timetableTrip.source,
					trainNo: timetableTrip.trainNo,
				});
			const idByKey = new Map(inserted.map((row) => [tripKey(row), row.id]));
			const stopRows = part.flatMap((trip) => {
				const tripId = idByKey.get(tripKey(trip));
				if (tripId === undefined) {
					throw new Error(`timetable_trip ${tripKey(trip)} returned no id`);
				}
				return trip.stops.map((stop) => ({
					arriveSec: stop.arriveSec,
					departSec: stop.departSec,
					qualityFlags: [...stop.qualityFlags],
					seq: stop.seq,
					statnId: stop.statnId,
					tripId,
				}));
			});
			for (const stops of chunk(stopRows, STOP_TIME_CHUNK_SIZE)) {
				// biome-ignore lint/performance/noAwaitInLoops: statements in one transaction run one by one
				await tx.insert(timetableStopTime).values(stops);
			}
		}
		await makeCurrent(tx, "timetable", batchId);
		return { batchId };
	});
}

/**
 * 원본 manifest에 로직 버전 항목을 더한다. isCurrentManifest가 항목 전체를 비교하므로,
 * 버전만 올라가도 현재 배치와 다른 manifest가 되어 다음 실행에서 다시 적재된다.
 * SourceManifest 형태를 지키려고 버전은 sha256 칸에 `v<번호>`로 넣는다.
 */
export function withLogicVersion(
	manifest: SourceManifest,
	key: string,
	label: string,
	version: number
): SourceManifest {
	return { ...manifest, [key]: { fileName: label, sha256: `v${version}` } };
}

function sameManifest(a: SourceManifest, b: SourceManifest): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) {
		return false;
	}
	return keys.every((key) => {
		const left = a[key];
		const right = b[key];
		return (
			left !== undefined &&
			right !== undefined &&
			left.fileName === right.fileName &&
			left.sha256 === right.sha256
		);
	});
}

/** 이 kind의 현재 배치가 같은 원본(manifest)으로 만들어졌으면 true. 다시 적재할 필요가 없다. */
export async function isCurrentManifest(
	db: Database,
	kind: ReferenceBatchKind,
	manifest: SourceManifest
): Promise<boolean> {
	const [current] = await db
		.select({ sourceManifest: referenceBatch.sourceManifest })
		.from(referenceBatch)
		.where(
			and(eq(referenceBatch.kind, kind), eq(referenceBatch.isCurrent, true))
		)
		.orderBy(desc(referenceBatch.id))
		.limit(1);
	return (
		current !== undefined && sameManifest(current.sourceManifest, manifest)
	);
}

/** where: 오류 메시지에 쓸 행 이름(예: "station_crosswalk 1002000211"). */
function toLineKey(value: string, where: string): LineKey {
	if (!isLineKey(value)) {
		throw new Error(`${where}: unknown line_key ${value}`);
	}
	return value;
}

/** station_crosswalk 현재 배치(is_current)의 행을 statnId 순으로 돌려준다. 현재 배치가 없으면 빈 배열. */
export async function loadCurrentCrosswalk(
	db: Database
): Promise<CrosswalkRow[]> {
	const rows = await db
		.select({ row: stationCrosswalk })
		.from(stationCrosswalk)
		.innerJoin(referenceBatch, eq(stationCrosswalk.batchId, referenceBatch.id))
		.where(
			and(
				eq(referenceBatch.kind, "station_crosswalk"),
				eq(referenceBatch.isCurrent, true)
			)
		)
		.orderBy(asc(stationCrosswalk.statnId));
	return rows.map(({ row }) => ({
		bldnId: row.bldnId ?? "",
		coordSource: "station-master",
		frCode: row.frCode ?? undefined,
		lat: row.lat,
		lineKey: toLineKey(row.lineKey, `station_crosswalk ${row.statnId}`),
		lng: row.lng,
		matchMethod: row.matchMethod,
		nameAliases: row.nameAliases,
		nameCanonical: row.nameCanonical,
		qualityFlags: row.qualityFlags,
		stationCd: row.stationCd ?? undefined,
		statnId: row.statnId,
		subwayId: row.subwayId,
	}));
}

const currentTimetable = and(
	eq(referenceBatch.kind, "timetable"),
	eq(referenceBatch.isCurrent, true)
);

/** timetable 현재 배치의 노선별 trip 수. 현재 배치가 없거나 trip이 없는 노선은 빠진다. */
export async function loadCurrentTripCounts(
	db: Database
): Promise<Partial<Record<LineKey, number>>> {
	const rows = await db
		.select({ lineKey: timetableTrip.lineKey, trips: count() })
		.from(timetableTrip)
		.innerJoin(referenceBatch, eq(timetableTrip.batchId, referenceBatch.id))
		.where(currentTimetable)
		.groupBy(timetableTrip.lineKey);
	const counts: Partial<Record<LineKey, number>> = {};
	for (const row of rows) {
		counts[toLineKey(row.lineKey, `timetable_trip line ${row.lineKey}`)] =
			row.trips;
	}
	return counts;
}

/**
 * timetable 현재 배치의 trip을 정차(seq 순)와 함께 id 순으로 돌려준다. lineKey를 주면 그 노선만.
 * 현재 배치가 없으면 빈 배열.
 */
export async function loadCurrentTrips(
	db: Database,
	lineKey?: LineKey
): Promise<(Trip & { id: number })[]> {
	const where = lineKey
		? and(currentTimetable, eq(timetableTrip.lineKey, lineKey))
		: currentTimetable;
	const tripRows = await db
		.select({ trip: timetableTrip })
		.from(timetableTrip)
		.innerJoin(referenceBatch, eq(timetableTrip.batchId, referenceBatch.id))
		.where(where)
		.orderBy(asc(timetableTrip.id));
	const stopRows = await db
		.select({ stop: timetableStopTime })
		.from(timetableStopTime)
		.innerJoin(timetableTrip, eq(timetableStopTime.tripId, timetableTrip.id))
		.innerJoin(referenceBatch, eq(timetableTrip.batchId, referenceBatch.id))
		.where(where)
		.orderBy(asc(timetableStopTime.tripId), asc(timetableStopTime.seq));
	const stopsByTrip = new Map<number, Trip["stops"]>();
	for (const { stop } of stopRows) {
		const stops = stopsByTrip.get(stop.tripId) ?? [];
		stops.push({
			arriveSec: stop.arriveSec,
			departSec: stop.departSec,
			qualityFlags: stop.qualityFlags,
			seq: stop.seq,
			statnId: stop.statnId,
		});
		stopsByTrip.set(stop.tripId, stops);
	}
	return tripRows.map(({ trip }) => ({
		destinationStatnId: trip.destinationStatnId ?? undefined,
		direction: trip.direction,
		express: trip.express,
		id: trip.id,
		lineKey: toLineKey(trip.lineKey, `timetable_trip ${trip.id}`),
		originStatnId: trip.originStatnId ?? undefined,
		qualityFlags: trip.qualityFlags,
		serviceDay: trip.serviceDay,
		serviceDaySource: trip.serviceDaySource,
		source: trip.source,
		sourceVersion: trip.sourceVersion,
		stops: stopsByTrip.get(trip.id) ?? [],
		trainNo: trip.trainNo,
	}));
}
