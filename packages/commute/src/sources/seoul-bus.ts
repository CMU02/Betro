import { z } from "zod";
import { localToEpochMs } from "../calendar";
import { DEFAULT_TIMEZONE } from "../config";
import type { Approaching, Progress, StopBoard } from "./types";

/** 노선 전 정류장 도착(`getArrInfoByRouteAll`)의 정류장 하나. */
export interface RouteStopArrival {
	headwayMin: number | null;
	/** 출처가 이 값을 만든 시각(`mkTm`). `etaSec`의 기준이다. */
	madeAt: number;
	seq: number;
	stopId: string;
	/** 다가오는 차량(많아야 둘), 가까운 순서. */
	vehicles: {
		etaSec: number;
		isArrived: boolean;
		lastOfDay: boolean;
		plate: string;
		/** 차량이 지금 있는 구간의 순번(`sectOrd`). */
		seqNow: number;
		vehicleId: string;
	}[];
}

type Vehicle = RouteStopArrival["vehicles"][number];

export type ParsedRouteArrivals =
	| { ok: true; fetchedHeaderCd: string; stops: RouteStopArrival[] }
	| { ok: false; headerCd: string | null };

export interface BusBoards {
	board: (seq: number) => StopBoard;
	progress: (vehicleId: string, alightSeq: number) => Progress | null;
	rideMs: (
		vehicleId: string | null,
		boardSeq: number,
		alightSeq: number
	) => number | null;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
/** 차량이 없는 칸의 `vehId`. */
const EMPTY_VEHICLE_ID = "0";
const HEADER_OK = "0";
const HEADER_NO_DATA = "4";
/** 출처 시각은 서울 버스의 현지 시각이다. 시간대는 설정값 한 곳에서 가져온다. */
const SOURCE_TIMEZONE = DEFAULT_TIMEZONE;
const MADE_AT = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

const envelopeSchema = z.object({
	msgBody: z.object({ itemList: z.array(z.unknown()).nullish() }).nullish(),
	msgHeader: z.object({ headerCd: z.string() }),
});

const field = z.string().nullish();

const itemSchema = z.object({
	isArrive1: field,
	isArrive2: field,
	isLast1: field,
	isLast2: field,
	mkTm: z.string(),
	plainNo1: field,
	plainNo2: field,
	sectOrd1: field,
	sectOrd2: field,
	staOrd: z.string(),
	stId: z.string(),
	term: field,
	traTime1: field,
	traTime2: field,
	vehId1: field,
	vehId2: field,
});

type Item = z.infer<typeof itemSchema>;

function intOf(value: string | null | undefined): number | null {
	if (value === null || value === undefined || value.trim() === "") {
		return null;
	}
	const parsed = Number(value.trim());
	return Number.isInteger(parsed) ? parsed : null;
}

function madeAtOf(text: string): number | null {
	const match = MADE_AT.exec(text.trim());
	if (!match) {
		return null;
	}
	const minute = Number(match[2]) * HOUR_MINUTES + Number(match[3]);
	const fraction = match[5] ? Number(`0.${match[5]}`) : 0;
	return (
		localToEpochMs(match[1] as string, minute, SOURCE_TIMEZONE) +
		Math.round((Number(match[4]) + fraction) * SECOND_MS)
	);
}

function vehicleOf(item: Item, n: 1 | 2): Vehicle | null {
	const vehicleId = (item[`vehId${n}`] ?? "").trim();
	if (vehicleId === "" || vehicleId === EMPTY_VEHICLE_ID) {
		return null;
	}
	const etaSec = intOf(item[`traTime${n}`]);
	const seqNow = intOf(item[`sectOrd${n}`]);
	if (etaSec === null || seqNow === null) {
		return null;
	}
	return {
		etaSec,
		isArrived: item[`isArrive${n}`] === "1",
		lastOfDay: item[`isLast${n}`] === "1",
		plate: (item[`plainNo${n}`] ?? "").trim(),
		seqNow,
		vehicleId,
	};
}

function stopOf(raw: unknown): RouteStopArrival | null {
	const parsed = itemSchema.safeParse(raw);
	if (!parsed.success) {
		return null;
	}
	const item = parsed.data;
	const seq = intOf(item.staOrd);
	const madeAt = madeAtOf(item.mkTm);
	if (seq === null || madeAt === null) {
		return null;
	}
	const headway = intOf(item.term);
	const vehicles = [vehicleOf(item, 1), vehicleOf(item, 2)].filter(
		(vehicle): vehicle is Vehicle => vehicle !== null
	);
	return {
		headwayMin: headway !== null && headway > 0 ? headway : null,
		madeAt,
		seq,
		stopId: item.stId.trim(),
		vehicles,
	};
}

/**
 * `getArrInfoByRouteAll` 응답 → 정류장별 도착. headerCd 0은 성공, 4(결과 없음)는 빈 성공,
 * 그 밖은 실패다. 봉투를 알아볼 수 없으면 `headerCd: null`. 던지지 않는다.
 */
export function parseRouteArrivals(json: unknown): ParsedRouteArrivals {
	const envelope = envelopeSchema.safeParse(json);
	if (!envelope.success) {
		return { headerCd: null, ok: false };
	}
	const { headerCd } = envelope.data.msgHeader;
	if (headerCd === HEADER_NO_DATA) {
		return { fetchedHeaderCd: headerCd, ok: true, stops: [] };
	}
	if (headerCd !== HEADER_OK) {
		return { headerCd, ok: false };
	}
	const items = envelope.data.msgBody?.itemList ?? [];
	const stops = items
		.map(stopOf)
		.filter((stop): stop is RouteStopArrival => stop !== null)
		.sort((a, b) => a.seq - b.seq);
	return { fetchedHeaderCd: headerCd, ok: true, stops };
}

export function routeArrivalsUrl(key: string, busRouteId: string): string {
	return `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${encodeURIComponent(key)}&busRouteId=${encodeURIComponent(busRouteId)}&resultType=json`;
}

function stopsAwayOf(vehicle: Vehicle, seq: number): number {
	return vehicle.isArrived || vehicle.seqNow >= seq ? 0 : seq - vehicle.seqNow;
}

const etaAtOf = (stop: RouteStopArrival, vehicle: Vehicle): number =>
	stop.madeAt + vehicle.etaSec * SECOND_MS;

function approachingOf(stop: RouteStopArrival, vehicle: Vehicle): Approaching {
	return {
		etaAt: etaAtOf(stop, vehicle),
		lastOfDay: vehicle.lastOfDay,
		method: "official",
		plate: vehicle.plate === "" ? null : vehicle.plate,
		stopsAway: stopsAwayOf(vehicle, stop.seq),
		vehicleId: vehicle.vehicleId,
	};
}

const nonNegative = (ms: number): number | null => (ms >= 0 ? ms : null);

/**
 * 직전·지금 노선 도착 → 정류장 도착판, 탄 차량의 하차 도착, 주행 시간.
 * `prev`는 같은 노선의 직전 응답(없으면 null)이고 `passed`를 찾는 데만 쓴다.
 */
export function busBoards(
	prev: RouteStopArrival[] | null,
	now: RouteStopArrival[],
	fetchedAt: number
): BusBoards {
	const bySeq = new Map(now.map((stop) => [stop.seq, stop]));
	const prevBySeq = new Map((prev ?? []).map((stop) => [stop.seq, stop]));
	/** 차량 → 지금 있는 구간 순번. */
	const seqNowOf = new Map<string, number>();
	for (const stop of now) {
		for (const vehicle of stop.vehicles) {
			if (!seqNowOf.has(vehicle.vehicleId)) {
				seqNowOf.set(vehicle.vehicleId, vehicle.seqNow);
			}
		}
	}
	const latestMadeAt =
		now.length === 0 ? fetchedAt : Math.max(...now.map((stop) => stop.madeAt));
	const prevLatestMadeAt =
		prev === null || prev.length === 0
			? null
			: Math.max(...prev.map((stop) => stop.madeAt));

	const board = (seq: number): StopBoard => {
		const stop = bySeq.get(seq);
		const sourceAt = stop?.madeAt ?? latestMadeAt;
		const approaching = stop
			? stop.vehicles
					.map((vehicle) => approachingOf(stop, vehicle))
					.sort((a, b) => (a.etaAt ?? 0) - (b.etaAt ?? 0))
			: [];
		const listed = new Set(approaching.map((a) => a.vehicleId));
		const passed = (prevBySeq.get(seq)?.vehicles ?? [])
			.filter(
				(vehicle) =>
					!listed.has(vehicle.vehicleId) &&
					(seqNowOf.get(vehicle.vehicleId) ?? Number.NEGATIVE_INFINITY) >= seq
			)
			.map((vehicle) => ({ at: sourceAt, vehicleId: vehicle.vehicleId }));
		const prevSourceAt = prevBySeq.get(seq)?.madeAt ?? prevLatestMadeAt;
		return {
			...(prevSourceAt === null ? {} : { prevSourceAt }),
			approaching,
			fetchedAt,
			headwayMs:
				stop?.headwayMin === null || stop?.headwayMin === undefined
					? null
					: stop.headwayMin * MINUTE_MS,
			passed,
			sourceAt,
		};
	};

	/** 차량이 첫 차량으로 나오는 정류장 중 `beforeSeq`보다 앞선 가장 먼 곳. */
	const farthestFirst = (
		vehicleId: string,
		beforeSeq: number
	): { stop: RouteStopArrival; vehicle: Vehicle } | null => {
		let found: { stop: RouteStopArrival; vehicle: Vehicle } | null = null;
		for (const stop of now) {
			const [first] = stop.vehicles;
			if (
				first?.vehicleId === vehicleId &&
				stop.seq < beforeSeq &&
				(found === null || stop.seq > found.stop.seq)
			) {
				found = { stop, vehicle: first };
			}
		}
		return found;
	};

	const progress = (vehicleId: string, alightSeq: number): Progress | null => {
		const alight = bySeq.get(alightSeq);
		const listed = alight?.vehicles.find((v) => v.vehicleId === vehicleId);
		if (alight && listed) {
			return {
				etaAt: etaAtOf(alight, listed),
				method: "official",
				stopsAway: stopsAwayOf(listed, alightSeq),
			};
		}
		const seqNow = seqNowOf.get(vehicleId);
		if (seqNow === undefined) {
			return null;
		}
		if (seqNow >= alightSeq) {
			// 하차 정류장을 이미 지났다.
			return { etaAt: null, method: null, stopsAway: 0 };
		}
		const far = farthestFirst(vehicleId, alightSeq);
		const travelled = far ? far.stop.seq - far.vehicle.seqNow : 0;
		if (far === null || travelled <= 0) {
			return null;
		}
		const perStopSec = far.vehicle.etaSec / travelled;
		const etaSec = far.vehicle.etaSec + (alightSeq - far.stop.seq) * perStopSec;
		return {
			etaAt: far.stop.madeAt + Math.round(etaSec * SECOND_MS),
			method: "extrapolated",
			stopsAway: alightSeq - seqNow,
		};
	};

	const vehicleRideMs = (
		vehicleId: string,
		boardSeq: number,
		alightSeq: number
	): number | null => {
		const boardStop = bySeq.get(boardSeq);
		const listed = boardStop?.vehicles.find((v) => v.vehicleId === vehicleId);
		const alightAt = progress(vehicleId, alightSeq)?.etaAt ?? null;
		if (!(boardStop && listed) || alightAt === null) {
			return null;
		}
		return nonNegative(alightAt - etaAtOf(boardStop, listed));
	};

	const rideMs = (
		vehicleId: string | null,
		boardSeq: number,
		alightSeq: number
	): number | null => {
		if (vehicleId !== null) {
			return vehicleRideMs(vehicleId, boardSeq, alightSeq);
		}
		const boardStop = bySeq.get(boardSeq);
		const alightStop = bySeq.get(alightSeq);
		const boardFirst = boardStop?.vehicles[0];
		if (!(boardStop && alightStop && boardFirst)) {
			return null;
		}
		// 승차 정류장의 첫 차량이 하차 정류장에도 나오면 그 차량의 차를 쓴다(같은 차량이 더 정확하다).
		const same = alightStop.vehicles.find(
			(v) => v.vehicleId === boardFirst.vehicleId
		);
		const alightVehicle = same ?? alightStop.vehicles[0];
		if (!alightVehicle) {
			return null;
		}
		return nonNegative(
			etaAtOf(alightStop, alightVehicle) - etaAtOf(boardStop, boardFirst)
		);
	};

	return { board, progress, rideMs };
}
