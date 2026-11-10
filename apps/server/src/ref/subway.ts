import type { Database } from "@Betro/db";
import { and, asc, eq } from "@Betro/db/operators";
import {
	type ReferenceBatchKind,
	referenceBatch,
	stationCrosswalk,
	type TrackDirection,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import { LINES, type LineKey } from "@Betro/transit-static/lines";
import { subwayLine, subwayStation } from "./ids";

export interface SubwayLineItem {
	line: string;
	name: string;
}

export interface DirectionShape {
	direction: TrackDirection;
	isLoop: boolean;
	stations: string[];
}

export interface DirectionResult {
	direction: TrackDirection;
	stops: number;
}

export interface SubwayBranch {
	branchKey: string;
	stations: { name: string; stop: string }[];
}

interface Coordinate {
	lat: number;
	lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;

function haversineM(a: Coordinate, b: Coordinate): number {
	const dLat = (b.lat - a.lat) * DEGREES_TO_RADIANS;
	const dLng = (b.lng - a.lng) * DEGREES_TO_RADIANS;
	const h =
		Math.sin(dLat / HALF) ** HALF +
		Math.cos(a.lat * DEGREES_TO_RADIANS) *
			Math.cos(b.lat * DEGREES_TO_RADIANS) *
			Math.sin(dLng / HALF) ** HALF;
	return HALF * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** 이웃한 두 역 사이 직선거리 중 가장 큰 값. 좌표가 없는 역이 낀 쌍은 건너뛴다. */
export function maxAdjacentGapM(
	coords: readonly (Coordinate | null)[]
): number {
	let max = 0;
	for (let i = 1; i < coords.length; i += 1) {
		const prev = coords[i - 1];
		const next = coords[i];
		if (prev && next) {
			max = Math.max(max, haversineM(prev, next));
		}
	}
	return max;
}

const MIN_LOOP_STATIONS = 3;

/**
 * 첫 역과 마지막 역 사이 직선거리가 그 노선의 역 간 최대 거리보다 길지 않으면 순환으로 본다.
 * 순환선은 닫는 구간도 보통 역 간 거리 중 하나라서, 같은 값일 때도 순환이어야 해 "이하"로 비교한다.
 * 역이 셋보다 적으면 닫는 구간과 그냥 한 구간을 가릴 수 없어 순환이 아니다.
 */
export function isLoopShape(
	coords: readonly (Coordinate | null)[],
	lineMaxGapM: number
): boolean {
	const [first] = coords;
	const last = coords.at(-1);
	if (coords.length < MIN_LOOP_STATIONS || !first || !last) {
		return false;
	}
	return haversineM(first, last) <= lineMaxGapM;
}

function stopsOnShape(
	shape: DirectionShape,
	from: string,
	to: string
): number | null {
	const fromIndex = shape.stations.indexOf(from);
	const toIndex = shape.stations.indexOf(to);
	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
		return null;
	}
	if (toIndex > fromIndex) {
		return toIndex - fromIndex;
	}
	return shape.isLoop ? shape.stations.length - fromIndex + toIndex : null;
}

/**
 * `from`에서 `to`로 가는 방향과 정거장 수. 두 역이 한 선로 위에 앞뒤로 있는 선로 중
 * 정거장 수가 가장 적은 것을 고른다. 이어지지 않으면 null.
 */
export function directionBetween(
	shapes: readonly DirectionShape[],
	from: string,
	to: string
): DirectionResult | null {
	let best: DirectionResult | null = null;
	for (const shape of shapes) {
		const stops = stopsOnShape(shape, from, to);
		if (stops !== null && (best === null || stops < best.stops)) {
			best = { direction: shape.direction, stops };
		}
	}
	return best;
}

export function listSubwayLines(): SubwayLineItem[] {
	return LINES.map((line) => ({
		line: subwayLine(line.lineKey),
		name: line.nameKo,
	}));
}

const SUBWAY_PREFIX = "seoul-subway:";

/** 출처 구분 ID(`seoul-subway:…`)나 맨 값을 맨 값으로 돌려준다. */
export function stripSubwayPrefix(value: string): string {
	return value.startsWith(SUBWAY_PREFIX)
		? value.slice(SUBWAY_PREFIX.length)
		: value;
}

export function findLineKey(value: string): LineKey | null {
	return LINES.find((line) => line.lineKey === value)?.lineKey ?? null;
}

async function currentBatch(
	db: Database,
	kind: ReferenceBatchKind
): Promise<number | null> {
	const [row] = await db
		.select({ id: referenceBatch.id })
		.from(referenceBatch)
		.where(
			and(eq(referenceBatch.kind, kind), eq(referenceBatch.isCurrent, true))
		)
		.limit(1);
	return row?.id ?? null;
}

/** 현재 선로 배치 번호. 없으면 null. */
export function currentTrackBatch(db: Database): Promise<number | null> {
	return currentBatch(db, "track");
}

interface LineShape {
	branchKey: string;
	direction: TrackDirection;
	statnIds: string[];
}

interface LineData {
	batchId: number;
	coords: Map<string, Coordinate>;
	names: Map<string, string>;
	shapes: LineShape[];
}

/** 현재 선로 배치에서 한 노선의 선로와 역 이름·좌표를 읽는다. 선로 배치가 없으면 null. */
async function loadLine(
	db: Database,
	lineKey: LineKey
): Promise<LineData | null> {
	const batchId = await currentTrackBatch(db);
	if (batchId === null) {
		return null;
	}
	const crosswalkBatchId = await currentBatch(db, "station_crosswalk");
	const rows = await db
		.select({
			branchKey: trackShape.branchKey,
			direction: trackShape.direction,
			shapeId: trackShape.id,
			statnId: trackStation.statnId,
		})
		.from(trackStation)
		.innerJoin(trackShape, eq(trackShape.id, trackStation.trackShapeId))
		.where(
			and(eq(trackShape.batchId, batchId), eq(trackShape.lineKey, lineKey))
		)
		.orderBy(asc(trackShape.id), asc(trackStation.seq));
	const shapes = new Map<number, LineShape>();
	for (const row of rows) {
		const shape = shapes.get(row.shapeId);
		if (shape) {
			shape.statnIds.push(row.statnId);
		} else {
			shapes.set(row.shapeId, {
				branchKey: row.branchKey,
				direction: row.direction,
				statnIds: [row.statnId],
			});
		}
	}
	const names = new Map<string, string>();
	const coords = new Map<string, Coordinate>();
	if (crosswalkBatchId !== null) {
		const stations = await db
			.select({
				lat: stationCrosswalk.lat,
				lng: stationCrosswalk.lng,
				name: stationCrosswalk.nameCanonical,
				statnId: stationCrosswalk.statnId,
			})
			.from(stationCrosswalk)
			.where(
				and(
					eq(stationCrosswalk.batchId, crosswalkBatchId),
					eq(stationCrosswalk.lineKey, lineKey)
				)
			);
		for (const station of stations) {
			names.set(station.statnId, station.name);
			coords.set(station.statnId, { lat: station.lat, lng: station.lng });
		}
	}
	return { batchId, coords, names, shapes: [...shapes.values()] };
}

/** 노선의 가지별 `down` 선로 역 순서. 선로 배치가 없으면 null. */
export async function findLineStations(
	db: Database,
	lineKey: LineKey
): Promise<{ batchId: number; branches: SubwayBranch[] } | null> {
	const line = await loadLine(db, lineKey);
	if (!line) {
		return null;
	}
	const branches = line.shapes
		.filter((shape) => shape.direction === "down")
		.map((shape) => ({
			branchKey: shape.branchKey,
			stations: shape.statnIds.map((statnId) => ({
				name: line.names.get(statnId) ?? statnId,
				stop: subwayStation(statnId),
			})),
		}));
	return { batchId: line.batchId, branches };
}

/** 한 노선 안에서 두 역 사이의 방향과 정거장 수. 선로 배치가 없으면 null, 이어지지 않으면 `direction`이 null. */
export async function findDirection(
	db: Database,
	lineKey: LineKey,
	from: string,
	to: string
): Promise<{ batchId: number; result: DirectionResult | null } | null> {
	const line = await loadLine(db, lineKey);
	if (!line) {
		return null;
	}
	const shapeCoords = line.shapes.map((shape) =>
		shape.statnIds.map((statnId) => line.coords.get(statnId) ?? null)
	);
	const lineMaxGapM = Math.max(0, ...shapeCoords.map(maxAdjacentGapM));
	const shapes: DirectionShape[] = line.shapes.map((shape, index) => ({
		direction: shape.direction,
		isLoop: isLoopShape(shapeCoords[index] ?? [], lineMaxGapM),
		stations: shape.statnIds,
	}));
	return { batchId: line.batchId, result: directionBetween(shapes, from, to) };
}
