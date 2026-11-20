import { describe, expect, it } from "bun:test";
import type {
	BusMap,
	BusSnapshotVehicle,
	SubwayMap,
	SubwaySnapshotVehicle,
} from "./map-client";
import {
	busTrackPoint,
	CATCH_UP_SEC,
	createBusTrack,
	createSubwayTrack,
	type MotionState,
	observe,
	pointAlong,
	positionAt,
	subwayTrackPoint,
	type TrackPoint,
} from "./motion";

const LAT = 37.5;
const LNG = 127;
/** 위도 37.5도에서 경도 1도의 길이(미터). 시험용 직선 노선을 동쪽으로 깐다. */
const METERS_PER_LNG_DEG =
	(6_371_008.8 * Math.PI * Math.cos((LAT * Math.PI) / 180)) / 180;

const east = (meters: number): [number, number] => [
	LNG + meters / METERS_PER_LNG_DEG,
	LAT,
];

const T0 = 1_800_000_000_000;
const sec = (seconds: number): number => T0 + seconds * 1000;

function point(overrides: Partial<TrackPoint>): TrackPoint {
	return {
		distanceM: 0,
		intervalM: 500,
		nextStopDistanceM: 500,
		observedAt: T0,
		scheduledSpeedMps: null,
		...overrides,
	};
}

function first(p: TrackPoint): MotionState {
	return observe(null, p).state;
}

it("never moves backward when a new observation is behind the shown position", () => {
	const start = first(
		point({ nextStopDistanceM: 1000, scheduledSpeedMps: 10 })
	);
	expect(positionAt(start, sec(50))).toBeCloseTo(500);

	const behind = observe(
		start,
		point({ distanceM: 300, nextStopDistanceM: 1000, observedAt: sec(50) })
	);
	expect(behind.violation).toBeNull();
	expect(positionAt(behind.state, sec(50))).toBeCloseTo(500);
	// 뒤로 간 관측 뒤에는 멈춰서 다음 관측을 기다린다.
	expect(positionAt(behind.state, sec(120))).toBeCloseTo(500);

	const ahead = observe(
		behind.state,
		point({ distanceM: 650, nextStopDistanceM: 1000, observedAt: sec(80) })
	);
	expect(ahead.violation).toBeNull();
	// 받은 순간에는 그대로이고, CATCH_UP_SEC 동안 관측 자리(그 뒤 외삽 포함)까지 따라잡는다.
	expect(positionAt(ahead.state, sec(80))).toBeCloseTo(500);
	// 속도는 직전 두 관측(300m → 650m, 30초)으로 낸다.
	const speedMps = 350 / 30;
	expect(positionAt(ahead.state, sec(80 + CATCH_UP_SEC))).toBeCloseTo(
		650 + speedMps * CATCH_UP_SEC
	);
});

it("does not extrapolate past the next unobserved stop", () => {
	const start = first(point({ distanceM: 0, nextStopDistanceM: 400 }));
	// 버스는 시간표 속도가 없어 직전 두 관측으로 속도를 낸다: 200m / 20초 = 10m/s.
	const moving = observe(
		start,
		point({ distanceM: 200, nextStopDistanceM: 400, observedAt: sec(20) })
	);
	expect(moving.state.speedMps).toBeCloseTo(10);
	expect(positionAt(moving.state, sec(30))).toBeCloseTo(300);
	expect(positionAt(moving.state, sec(200))).toBeCloseTo(400);
});

it("keeps the marker at its last position through two missed observations", () => {
	const p = point({
		distanceM: 100,
		nextStopDistanceM: 500,
		scheduledSpeedMps: 5,
	});
	const start = first(p);
	const atStop = positionAt(start, sec(160));
	expect(atStop).toBeCloseTo(500);

	// 수집기는 못 본 차량을 5분 동안 같은 관측 시각으로 스냅샷에 남긴다. 같은 점이 두 번 다시 온다.
	const missedOnce = observe(start, p, sec(160));
	const missedTwice = observe(missedOnce.state, p, sec(320));
	expect(missedOnce.state).toBe(start);
	expect(missedTwice.state).toBe(start);
	expect(missedOnce.violation).toBeNull();
	expect(missedTwice.violation).toBeNull();
	// 사라지지도 튀지도 않고 정류장 앞에 머문다. 신선도의 기준 시각은 그대로라 표시만 늘어난다.
	expect(positionAt(missedTwice.state, sec(320))).toBeCloseTo(atStop);
	expect(missedTwice.state.lastObservedAt).toBe(T0);
});

it("counts a jump when a new observation forces the shown position forward by more than one stop interval", () => {
	const start = first(
		point({ distanceM: 0, nextStopDistanceM: 500, scheduledSpeedMps: 5 })
	);
	const jumped = observe(
		start,
		point({
			distanceM: 1600,
			intervalM: 500,
			nextStopDistanceM: 2000,
			observedAt: sec(10),
		})
	);
	expect(jumped.violation).toBe("jump");
	expect(positionAt(jumped.state, sec(10))).toBeCloseTo(1600);

	const small = observe(
		start,
		point({ distanceM: 400, nextStopDistanceM: 500, observedAt: sec(10) })
	);
	expect(small.violation).toBeNull();
});

it("judges the update at the time it is received, not when it was observed", () => {
	const start = first(
		point({ distanceM: 0, nextStopDistanceM: 1000, scheduledSpeedMps: 10 })
	);
	// 50초 전 관측(250m)이 이제 도착했다. 받은 순간 표시는 이미 600m다.
	const late = observe(
		start,
		point({ distanceM: 250, nextStopDistanceM: 1000, observedAt: sec(10) }),
		sec(60)
	);
	expect(late.violation).toBeNull();
	expect(positionAt(late.state, sec(60))).toBeGreaterThanOrEqual(600);
});

it("re-anchors without a violation when the vehicle starts over far behind", () => {
	const start = first(point({ distanceM: 30_000, nextStopDistanceM: 30_500 }));
	const restarted = observe(
		start,
		point({ distanceM: 50, nextStopDistanceM: 500, observedAt: sec(30) })
	);
	expect(restarted.violation).toBeNull();
	expect(positionAt(restarted.state, sec(30))).toBeCloseTo(50);
});

it("positionAt never decreases and ignores a clock before the anchor", () => {
	const state = first(point({ distanceM: 100, scheduledSpeedMps: 5 }));
	expect(positionAt(state, sec(-30))).toBeCloseTo(100);
	expect(positionAt(state, sec(10))).toBeCloseTo(150);
});

it("loop line stations start at the beginning when the first one sits off the seam", () => {
	// 2호선 본선처럼 처음과 끝이 이어지는 고리. 선은 첫 역을 지나서 시작해 시작점은 첫 역에서 붙임 거리보다 멀고,
	// 돌아오는 끝 구간이 첫 역 바로 옆을 지난다(실데이터: 시청에서 시작점 84m, 끝 구간 61m).
	// 첫 역이 끝에 붙으면 뒤의 모든 역이 끝으로 몰린다.
	const side = 2000;
	const METERS_PER_LAT_DEG = (6_371_008.8 * Math.PI) / 180;
	const at = (x: number, y: number): [number, number] => [
		LNG + x / METERS_PER_LNG_DEG,
		LAT + y / METERS_PER_LAT_DEG,
	];
	const station = (x: number, y: number, seq: number) => ({
		lat: at(x, y)[1],
		lng: at(x, y)[0],
		name: `${seq}`,
		nextRunSec: 100,
		offsetM: 0,
		seq,
		stop: `seoul-subway:L${seq}`,
	});
	const loop: SubwayMap["branches"][number] = {
		branchKey: "main",
		direction: "up",
		shape: [
			at(0, 0),
			at(side, 0),
			at(side, side),
			at(-200, side),
			at(-200, 0),
			at(0, 0),
		],
		stations: [
			station(-120, -60, 0),
			station(side, -10, 1),
			station(side + 10, side, 2),
			station(-200 - 10, side / 2, 3),
		],
	};
	const track = createSubwayTrack(loop);
	const distances = track?.stations.map((s) => s.distanceM) ?? [];
	expect(distances[0] ?? -1).toBeLessThan(100);
	expect(distances[1] ?? -1).toBeCloseTo(side, -1);
	expect(distances[2] ?? -1).toBeCloseTo(side * 2, -1);
	expect(distances[3] ?? -1).toBeCloseTo(side * 3 + 200 + side / 2, -1);
});

describe("subway", () => {
	const branch: SubwayMap["branches"][number] = {
		branchKey: "main",
		direction: "up",
		shape: [east(0), east(1000), east(2000), east(3000)],
		stations: [
			// 서버 `offsetM`은 선로에서 역 좌표까지의 수직 거리다. 앱은 역 좌표를 선에 투영해 쓴다.
			{
				lat: LAT,
				lng: east(0)[0],
				name: "가",
				nextRunSec: 100,
				offsetM: 12,
				seq: 0,
				stop: "seoul-subway:S1",
			},
			{
				lat: LAT,
				lng: east(2000)[0],
				name: "나",
				nextRunSec: 50,
				offsetM: 8,
				seq: 1,
				stop: "seoul-subway:S2",
			},
			{
				lat: LAT,
				lng: east(3000)[0],
				name: "다",
				nextRunSec: null,
				offsetM: 3,
				seq: 2,
				stop: "seoul-subway:S3",
			},
		],
	};

	function train(
		statnId: string,
		status: SubwaySnapshotVehicle["status"]
	): SubwaySnapshotVehicle {
		return {
			direction: "up",
			lastSeenAt: T0,
			lineKey: "2",
			observedAt: T0,
			rawTrainNo: "2241",
			stationDistanceM: null,
			statnId,
			status,
		};
	}

	it("subway progress between stations uses nextRunSec", () => {
		const track = createSubwayTrack(branch);
		expect(track).not.toBeNull();
		if (!track) {
			return;
		}
		const departed = subwayTrackPoint(track, train("S1", "depart"));
		expect(departed).not.toBeNull();
		if (!departed) {
			return;
		}
		expect(departed.distanceM).toBeCloseTo(0, 0);
		expect(departed.nextStopDistanceM ?? 0).toBeCloseTo(2000, 0);
		const state = first(departed);
		// 2000m를 100초에 간다. 50초 뒤에는 절반이고, 다음 역 너머로는 가지 않는다.
		expect(positionAt(state, sec(50))).toBeCloseTo(1000, 0);
		expect(positionAt(state, sec(300))).toBeCloseTo(2000, 0);

		// 전역 출발(S2 기준)은 S1~S2 구간을 같은 시간표 속도로 간다.
		const prevDepart = subwayTrackPoint(track, train("S2", "prev-depart"));
		expect(prevDepart?.distanceM ?? -1).toBeCloseTo(0, 0);
		expect(prevDepart?.scheduledSpeedMps ?? 0).toBeCloseTo(20);

		// 도착(정차 중)은 그 역에 머문다.
		const arrived = subwayTrackPoint(track, train("S2", "arrive"));
		expect(arrived?.distanceM ?? -1).toBeCloseTo(2000, 0);
		expect(arrived?.scheduledSpeedMps).toBe(0);

		// 진입은 그 역에 거의 다 왔다. 그 역이 상한이다.
		const approaching = subwayTrackPoint(track, train("S3", "approach"));
		expect(approaching?.distanceM ?? -1).toBeCloseTo(3000, 0);
		expect(approaching?.nextStopDistanceM ?? -1).toBeCloseTo(3000, 0);

		expect(subwayTrackPoint(track, train("S9", "depart"))).toBeNull();
	});

	it("keeps timetable progress when the same station status repeats", () => {
		const track = createSubwayTrack(branch);
		const departed = track
			? subwayTrackPoint(track, train("S1", "depart"))
			: null;
		expect(departed).not.toBeNull();
		if (!departed) {
			return;
		}
		const state = first(departed);
		// 역 단위 위치는 하한일 뿐이다. 80초 뒤 같은 "S1 출발"이 다시 와도 멈추지 않고 S2로 간다.
		const repeated = observe(state, { ...departed, observedAt: sec(80) });
		expect(repeated.violation).toBeNull();
		expect(positionAt(repeated.state, sec(80))).toBeCloseTo(1600, 0);
		expect(positionAt(repeated.state, sec(90))).toBeCloseTo(1800, 0);
		expect(positionAt(repeated.state, sec(200))).toBeCloseTo(2000, 0);
	});
});

describe("bus", () => {
	const map: BusMap = {
		batchId: 1,
		line: "seoul-bus:R1",
		shape: [east(0), east(500), east(1000), east(2000)],
		stops: [
			{
				arsId: null,
				lat: LAT + 0.0001,
				lng: east(0)[0],
				name: "1",
				seq: 1,
				stop: "seoul-bus:A",
			},
			{
				arsId: null,
				lat: LAT + 0.0001,
				lng: east(500)[0],
				name: "2",
				seq: 2,
				stop: "seoul-bus:B",
			},
			{
				arsId: null,
				lat: LAT - 0.0001,
				lng: east(1000)[0],
				name: "3",
				seq: 3,
				stop: "seoul-bus:C",
			},
			{
				arsId: null,
				lat: LAT,
				lng: east(2000)[0],
				name: "4",
				seq: 4,
				stop: "seoul-bus:D",
			},
		],
	};

	function bus(sectOrd: number, meters: number): BusSnapshotVehicle {
		return {
			lastSeenAt: T0,
			lat: LAT + 0.0002,
			lng: east(meters)[0],
			observedAt: T0,
			routeId: "R1",
			sectOrd,
			vehId: "V1",
		};
	}

	it("projects the vehicle within its section and caps at the next stop", () => {
		const track = createBusTrack(map);
		expect(track).not.toBeNull();
		if (!track) {
			return;
		}
		const p = busTrackPoint(track, bus(2, 700));
		expect(p?.distanceM ?? -1).toBeCloseTo(700, 0);
		expect(p?.nextStopDistanceM ?? -1).toBeCloseTo(1000, 0);
		expect(p?.intervalM ?? -1).toBeCloseTo(500, 0);
		expect(p?.scheduledSpeedMps).toBeNull();
		// GPS가 구간 밖을 가리켜도 그 구간 안에 둔다.
		expect(busTrackPoint(track, bus(2, 1500))?.distanceM ?? -1).toBeCloseTo(
			1000,
			0
		);
		// 마지막 정류장 뒤에는 다음 정류장이 없다.
		expect(busTrackPoint(track, bus(4, 2000))?.nextStopDistanceM).toBeNull();
		expect(busTrackPoint(track, bus(9, 0))).toBeNull();
	});

	it("has no track without a shape", () => {
		expect(createBusTrack({ ...map, shape: [] })).toBeNull();
	});

	it("catches up smoothly when a slow dev update lands stops ahead", () => {
		// dev 서울 버스: 160초마다, 20초 늦게 받는다. 5m/s로 400m 간격 정류장을 지나므로 갱신마다 두 구간쯤 앞선다.
		const spacing = 400;
		const stopCount = 30;
		const speedMps = 5;
		const cadenceSec = 160;
		const latencySec = 20;
		const sampleSec = 5;
		const settleSec = 30;
		const routeM = spacing * stopCount;
		const route: BusMap = {
			batchId: 1,
			line: "seoul-bus:R2",
			shape: Array.from({ length: stopCount * 4 + 1 }, (_, i) =>
				east((i * routeM) / (stopCount * 4))
			),
			stops: Array.from({ length: stopCount + 1 }, (_, i) => ({
				arsId: null,
				lat: LAT + 0.0001,
				lng: east(i * spacing)[0],
				name: `${i}`,
				seq: i + 1,
				stop: `seoul-bus:S${i}`,
			})),
		};
		const track = createBusTrack(route);
		expect(track).not.toBeNull();
		if (!track) {
			return;
		}
		let state: MotionState | null = null;
		let shown = 0;
		let updates = 0;
		for (let t = 0; speedMps * t < routeM - spacing; t += cadenceSec) {
			const meters = speedMps * t;
			const p = busTrackPoint(track, {
				...bus(Math.floor(meters / spacing) + 1, meters),
				observedAt: sec(t),
			});
			expect(p).not.toBeNull();
			if (!p) {
				return;
			}
			const receivedAt = sec(t + latencySec);
			const result = observe(state, p, receivedAt);
			expect(result.violation).toBeNull();
			if (state !== null) {
				updates += 1;
				// 받은 순간 표시 위치는 그대로다. 그 뒤로 따라잡는다.
				expect(positionAt(result.state, receivedAt)).toBeCloseTo(
					positionAt(state, receivedAt)
				);
			}
			({ state } = result);
			for (let s = 0; s <= cadenceSec; s += sampleSec) {
				const at = positionAt(state, receivedAt + s * 1000);
				expect(at).toBeGreaterThanOrEqual(shown - 1e-6);
				expect(at).toBeLessThanOrEqual(
					(state.ceilingM ?? Number.POSITIVE_INFINITY) + 1e-6
				);
				shown = at;
			}
			// 멈춰 있지 않고 관측 자리까지 따라잡는다.
			expect(
				positionAt(state, receivedAt + settleSec * 1000)
			).toBeGreaterThanOrEqual(p.distanceM - 1e-6);
		}
		expect(updates).toBeGreaterThan(10);
	});
});

it("holds instead of re-anchoring when an observation slips back less than two intervals", () => {
	const start = first(
		point({ distanceM: 1000, intervalM: 300, nextStopDistanceM: 1300 })
	);
	const slipped = observe(
		start,
		point({
			distanceM: 750,
			intervalM: 300,
			nextStopDistanceM: 1000,
			observedAt: sec(30),
		})
	);
	expect(slipped.violation).toBeNull();
	expect(positionAt(slipped.state, sec(30))).toBeCloseTo(1000);
	expect(positionAt(slipped.state, sec(120))).toBeCloseTo(1000);
});

it("stays continuous when an update arrives in the middle of a catch-up", () => {
	const start = first(point({ distanceM: 0, nextStopDistanceM: 2000 }));
	const catching = observe(
		start,
		point({ distanceM: 1000, nextStopDistanceM: 2000, observedAt: sec(100) })
	);
	const midway = sec(100 + CATCH_UP_SEC / 2);
	const shownMidway = positionAt(catching.state, midway);
	expect(shownMidway).toBeGreaterThan(0);
	expect(shownMidway).toBeLessThan(1000);
	const again = observe(
		catching.state,
		// 4초에 40m(10m/s)라 실제로 갈 수 있는 거리다.
		point({ distanceM: 1040, nextStopDistanceM: 2000, observedAt: sec(104) }),
		midway
	);
	expect(again.violation).toBeNull();
	expect(positionAt(again.state, midway)).toBeCloseTo(shownMidway);
	expect(positionAt(again.state, midway + 60_000)).toBeGreaterThanOrEqual(1040);
});

it("re-anchors a short route's new run instead of freezing at the terminus", () => {
	// 4km 남짓한 마을버스가 종점(4000m)에 있다가 같은 차량 번호로 처음(50m)부터 다시 돈다.
	const atTerminus = first(
		point({ distanceM: 4000, intervalM: 300, nextStopDistanceM: 4100 })
	);
	const restarted = observe(
		atTerminus,
		point({
			distanceM: 50,
			intervalM: 300,
			nextStopDistanceM: 300,
			observedAt: sec(60),
		})
	);
	expect(restarted.violation).toBeNull();
	expect(positionAt(restarted.state, sec(60))).toBeCloseTo(50);
	const moving = observe(
		restarted.state,
		point({
			distanceM: 400,
			intervalM: 300,
			nextStopDistanceM: 600,
			observedAt: sec(120),
		})
	);
	expect(moving.violation).toBeNull();
	expect(positionAt(moving.state, sec(180))).toBeGreaterThanOrEqual(400);
});

it("pointAlong walks the shape in metres with an east bearing and clamps both ends", () => {
	const shape = [east(0), east(1000), east(1000), east(2000)];
	const mid = pointAlong(shape, 1500);
	expect(mid).not.toBeNull();
	expect(mid?.longitude ?? 0).toBeCloseTo(east(1500)[0], 6);
	expect(mid?.latitude ?? 0).toBeCloseTo(LAT, 6);
	expect(mid?.bearing ?? 0).toBeCloseTo(90, 0);
	expect(pointAlong(shape, -10)?.longitude ?? 0).toBeCloseTo(east(0)[0], 6);
	expect(pointAlong(shape, 99_999)?.longitude ?? 0).toBeCloseTo(
		east(2000)[0],
		6
	);
	expect(pointAlong([], 10)).toBeNull();
});
