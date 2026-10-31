import type { Database } from "@Betro/db";
import {
	type ReferenceBatchKind,
	referenceBatch,
	type SourceManifest,
	stationCrosswalk,
	type TrackDirection,
	type TrackStationAnchor,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { CrosswalkRow } from "../crosswalk/match";
import { isLineKey, type LineKey } from "../lines";

/** SQLite 바인딩 변수 한도 안에 머물도록 한 번에 넣는 행 수. */
const INSERT_CHUNK_SIZE = 500;

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

function toLineKey(value: string, statnId: string): LineKey {
	if (!isLineKey(value)) {
		throw new Error(`station_crosswalk ${statnId}: unknown line_key ${value}`);
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
		lineKey: toLineKey(row.lineKey, row.statnId),
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
