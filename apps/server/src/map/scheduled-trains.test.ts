import type { LibsqlDatabase } from "@Betro/db";
import {
	referenceBatch,
	timetableStopTime,
	timetableTrip,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { kstToEpochMs } from "@Betro/realtime/time";
import { beforeAll, describe, expect, it } from "bun:test";

import { createMapRoutes } from "./routes";
import { scheduledTrains } from "./scheduled-trains";

const BASE = "https://betro.test";

type Day = "weekday" | "saturday" | "holiday";
/** [역, 도착 초, 출발 초] */
type Stop = [string, number | null, number | null];

let db: LibsqlDatabase;
const ids = new Map<string, number>();

function idOf(name: string): number {
	const id = ids.get(name);
	if (id === undefined) {
		throw new Error(`seed trip ${name} missing`);
	}
	return id;
}

async function seedTrip(
	name: string,
	batchId: number,
	day: Day,
	stops: Stop[],
	lineKey = "line2"
): Promise<void> {
	const [row] = await db
		.insert(timetableTrip)
		.values({
			batchId,
			direction: "down",
			express: "local",
			lineKey,
			qualityFlags: [],
			serviceDay: day,
			serviceDaySource: "source",
			source: "seoul-metro-csv",
			sourceVersion: "test",
			trainNo: `T-${name}`,
		})
		.returning({ id: timetableTrip.id });
	if (!row) {
		throw new Error("seed trip missing");
	}
	ids.set(name, row.id);
	await db.insert(timetableStopTime).values(
		stops.map(([statnId, arriveSec, departSec], index) => ({
			arriveSec,
			departSec,
			qualityFlags: [],
			seq: index + 1,
			statnId,
			tripId: row.id,
		}))
	);
}

beforeAll(async () => {
	db = await createTestDb();
	const [oldBatch, current] = await db
		.insert(referenceBatch)
		.values([
			{ isCurrent: false, kind: "timetable", sourceManifest: {} },
			{ isCurrent: true, kind: "timetable", sourceManifest: {} },
		])
		.returning({ id: referenceBatch.id });
	if (!(oldBatch && current)) {
		throw new Error("seed batches missing");
	}
	// 평일 아침: 출발 30_000초 → 다음 역 도착 30_120초, 30초 서 있다가 30_150초 출발.
	await seedTrip("morning", current.id, "weekday", [
		["S1", null, 30_000],
		["S2", 30_120, 30_150],
		["S3", 30_270, null],
	]);
	// 아직 출발하지 않은 열차, 다른 요일·다른 배치·다른 노선의 같은 시각 열차는 나오면 안 된다.
	await seedTrip("later", current.id, "weekday", [
		["S1", null, 31_000],
		["S2", 31_120, null],
	]);
	await seedTrip("saturdayTwin", current.id, "saturday", [
		["S1", null, 30_000],
		["S2", 30_120, null],
	]);
	await seedTrip("oldBatch", oldBatch.id, "weekday", [
		["S1", null, 30_000],
		["S2", 30_120, null],
	]);
	await seedTrip(
		"otherLine",
		current.id,
		"weekday",
		[
			["S1", null, 30_000],
			["S2", 30_120, null],
		],
		"line3"
	);
	// 금요일 막차: 24:26:40(88_000초) 출발 → 88_400초 도착.
	await seedTrip("lastFriday", current.id, "weekday", [
		["S1", null, 88_000],
		["S2", 88_400, null],
	]);
	// 경계를 잘못 셌다면 토요일 00:30(1_800초)에 잡힐 토요일 열차.
	await seedTrip("saturdayMidnightDecoy", current.id, "saturday", [
		["S1", null, 1700],
		["S2", 1900, null],
	]);
	// 토요일 05:30(19_800초)의 첫차와, 전날로 셌다면 잡힐 평일 열차(19_800 + 86_400).
	await seedTrip("saturdayFirst", current.id, "saturday", [
		["S1", null, 19_700],
		["S2", 19_900, null],
	]);
	await seedTrip("weekdayPastRollover", current.id, "weekday", [
		["S1", null, 106_100],
		["S2", 106_300, null],
	]);
	// 앞 역 출발 시각이 없으면 도착 시각, 다음 역 도착 시각이 없으면 출발 시각을 쓴다.
	await seedTrip("coalesce", current.id, "holiday", [
		["S1", 40_000, null],
		["S2", null, 40_100],
	]);
	// 같은 시각 쌍(S1 출발 = S2 도착)은 진행률을 낼 수 없어 버린다.
	await seedTrip("zeroLength", current.id, "holiday", [
		["S1", 39_950, 40_060],
		["S2", 40_060, null],
	]);
});

describe("scheduledTrains", () => {
	it("앞 역 출발과 다음 역 도착 사이의 열차만 progress와 함께 낸다", async () => {
		const now = kstToEpochMs("2026-11-24 08:21:00");
		const result = await scheduledTrains(db, "line2", now);
		expect(result?.generatedAt).toBe(now);
		expect(result?.trains).toEqual([
			{
				direction: "down",
				fromStop: "seoul-subway:S1",
				progress: 0.5,
				toStop: "seoul-subway:S2",
				trainNo: "T-morning",
				tripId: idOf("morning"),
			},
		]);
	});

	it("역에 서 있는 동안은 그 역에서 progress 0으로 남는다", async () => {
		const now = kstToEpochMs("2026-11-24 08:22:20");
		const result = await scheduledTrains(db, "line2", now);
		expect(result?.trains).toEqual([
			{
				direction: "down",
				fromStop: "seoul-subway:S2",
				progress: 0,
				toStop: "seoul-subway:S3",
				trainNo: "T-morning",
				tripId: idOf("morning"),
			},
		]);
	});

	it("서비스일 초가 86_400을 넘는 막차도 00:30에 나온다", async () => {
		// 2026-11-28은 토요일이고, 03시 전이라 서비스일은 금요일(평일)이다.
		const result = await scheduledTrains(
			db,
			"line2",
			kstToEpochMs("2026-11-28 00:30:00")
		);
		expect(result?.trains.map((train) => train.tripId)).toEqual([
			idOf("lastFriday"),
		]);
		expect(result?.trains[0]?.progress).toBe(0.5);
	});

	it("03:00 뒤에는 새 서비스일의 첫차만 본다", async () => {
		const result = await scheduledTrains(
			db,
			"line2",
			kstToEpochMs("2026-11-28 05:30:00")
		);
		expect(result?.trains.map((train) => train.tripId)).toEqual([
			idOf("saturdayFirst"),
		]);
	});

	it("앞 역이나 다음 역 시각이 null이면 COALESCE로 채우고, 같은 시각 쌍은 버린다", async () => {
		// 2026-11-29는 일요일(휴일 시간표). 40_050초 = 11:07:30.
		const result = await scheduledTrains(
			db,
			"line2",
			kstToEpochMs("2026-11-29 11:07:30")
		);
		expect(
			result?.trains.map((train) => [train.tripId, train.progress])
		).toEqual([[idOf("coalesce"), 0.5]]);
	});

	it("시간표 배치가 없으면 null이다", async () => {
		const empty = await createTestDb();
		expect(
			await scheduledTrains(empty, "line2", kstToEpochMs("2026-11-24 08:21:00"))
		).toBeNull();
	});
});

describe("GET /v1/map/scheduled/:lineKey", () => {
	function appAt(now: number) {
		return createMapRoutes({
			db,
			maxRoutesPerInstall: 6,
			now: () => now,
			watchTtlMs: 90_000,
		});
	}

	it("인증 없이 15초 공개 캐시로 시간표 열차를 낸다", async () => {
		const now = kstToEpochMs("2026-11-24 08:21:00");
		const response = await appAt(now).request(
			`${BASE}/v1/map/scheduled/seoul-subway:line2`
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=15");
		const body = (await response.json()) as {
			generatedAt: number;
			trains: { tripId: number }[];
		};
		expect(body.generatedAt).toBe(now);
		expect(body.trains.map((train) => train.tripId)).toEqual([idOf("morning")]);
	});

	it("모르는 노선은 404, 시간표가 없으면 503이다", async () => {
		const now = kstToEpochMs("2026-11-24 08:21:00");
		expect(
			(await appAt(now).request(`${BASE}/v1/map/scheduled/line99`)).status
		).toBe(404);
		const empty = createMapRoutes({
			db: await createTestDb(),
			maxRoutesPerInstall: 6,
			now: () => now,
			watchTtlMs: 90_000,
		});
		expect((await empty.request(`${BASE}/v1/map/scheduled/line2`)).status).toBe(
			503
		);
	});
});
