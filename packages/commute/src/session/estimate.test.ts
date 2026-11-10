import { describe, expect, it } from "bun:test";
import { commuteConfig } from "../config";
import type { BusLeg, Leg, Route, SubwayLeg } from "../plan";
import type {
	Approaching,
	ArrivalMethod,
	Progress,
	StopBoard,
	TransitBoards,
} from "../sources/types";
import { estimateRoute, selectVehicle } from "./estimate";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 08:00(현지)로 읽는 기준 시각. 계산은 시간대와 무관하게 epoch 차이만 본다. */
const BASE = Date.UTC(2026, 10, 9, 23, 0);
const config = commuteConfig({});
const NO_SKIP: ReadonlySet<string> = new Set();

/** 08:mm */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

function vehicle(
	vehicleId: string,
	etaAt: number | null,
	overrides: Partial<Approaching> = {}
): Approaching {
	return {
		etaAt,
		lastOfDay: false,
		method: etaAt === null ? null : "official",
		plate: null,
		stopsAway: 3,
		vehicleId,
		...overrides,
	};
}

function stopBoard(
	approaching: Approaching[],
	overrides: Partial<StopBoard> = {}
): StopBoard {
	return {
		approaching,
		fetchedAt: at(10),
		headwayMs: 12 * MINUTE_MS,
		passed: [],
		sourceAt: at(10),
		...overrides,
	};
}

interface FakeLeg {
	board: StopBoard | null;
	progress?: Record<string, Progress>;
	rideMs: number | null;
}

/** 구간 객체를 키로 손으로 만든 도착판을 돌려주는 가짜. */
function fakeBoards(entries: [Leg, FakeLeg][]): TransitBoards {
	const byLeg = new Map(entries);
	return {
		board: (leg, side) =>
			side === "board" ? (byLeg.get(leg)?.board ?? null) : null,
		progress: (leg, vehicleId) => byLeg.get(leg)?.progress?.[vehicleId] ?? null,
		rideMs: (leg) => byLeg.get(leg)?.rideMs ?? null,
	};
}

const busLeg: BusLeg = {
	alight: { name: "흑석동효사정앞", seq: 42, stop: "seoul-bus:119000030" },
	board: { name: "노량진역", seq: 39, stop: "seoul-bus:119000011" },
	line: "seoul-bus:100100290",
	lineName: "6411",
	mode: "bus",
};

const subwayLeg: SubwayLeg = {
	alight: { name: "역삼", stop: "seoul-subway:1002000221" },
	board: { name: "강남", stop: "seoul-subway:1002000222" },
	direction: "down",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

const busRoute: Route = { legs: [busLeg], rank: 0, walkMinutes: [5, 3] };
const transferRoute: Route = {
	legs: [busLeg, subwayLeg],
	rank: 1,
	walkMinutes: [5, 4, 2],
};

function input(
	readyAt: number,
	overrides: Partial<{
		boardedLegs: boolean[];
		fixed: (string | null)[];
		fromLeg: number;
		now: number;
		skip: ReadonlySet<string>;
	}> = {}
) {
	return { fixed: [], now: at(10), readyAt, skip: NO_SKIP, ...overrides };
}

describe("selectVehicle", () => {
	const board = stopBoard([vehicle("A", at(13)), vehicle("B", at(22))]);

	it("readyAt 뒤에 오는 첫 차량을 고른다", () => {
		expect(selectVehicle(board, at(15), NO_SKIP)?.vehicleId).toBe("B");
	});

	it("readyAt과 같은 시각에 오는 차량은 탈 수 있다", () => {
		expect(selectVehicle(board, at(13), NO_SKIP)?.vehicleId).toBe("A");
	});

	it("skip에 든 차량은 건너뛴다", () => {
		expect(selectVehicle(board, at(10), new Set(["A"]))?.vehicleId).toBe("B");
	});

	it("모두 readyAt보다 이르면 null", () => {
		expect(selectVehicle(board, at(23), NO_SKIP)).toBeNull();
	});

	it("etaAt이 null인 차량은 고르지 않는다", () => {
		const withUnknown = stopBoard([vehicle("X", null), vehicle("B", at(22))]);
		expect(selectVehicle(withUnknown, at(10), NO_SKIP)?.vehicleId).toBe("B");
	});
});

describe("estimateRoute: 버스 구간 하나", () => {
	it("승차 도착 + 주행 + 마지막 도보로 목적지 도착을 낸다", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(17), { stopsAway: 2 })]),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(busRoute, boards, input(at(15)), config);
		expect(estimate.rank).toBe(0);
		expect(estimate.destinationEtaAt).toBe(at(34));
		expect(estimate.legs).toEqual([
			{
				alightEtaAt: at(31),
				boardEtaAt: at(17),
				etaState: "live",
				method: "official",
				positionState: "live",
				stopsAway: 2,
				vehicleId: "A",
			},
		]);
	});

	it("rideMs가 null이면 하차와 목적지 도착도 null", () => {
		const boards = fakeBoards([
			[busLeg, { board: stopBoard([vehicle("A", at(17))]), rideMs: null }],
		]);
		const estimate = estimateRoute(busRoute, boards, input(at(15)), config);
		expect(estimate.legs[0]?.boardEtaAt).toBe(at(17));
		expect(estimate.legs[0]?.alightEtaAt).toBeNull();
		expect(estimate.destinationEtaAt).toBeNull();
	});
});

describe("estimateRoute: 환승", () => {
	it("둘째 구간은 첫 구간 하차 + 환승 도보 뒤의 첫 열차를 고른다", () => {
		// 버스 08:17 승차, 10분 주행 → 08:27 하차, 환승 도보 4분 → 08:31부터 탈 수 있다.
		const boards = fakeBoards([
			[
				busLeg,
				{ board: stopBoard([vehicle("A", at(17))]), rideMs: 10 * MINUTE_MS },
			],
			[
				subwayLeg,
				{
					board: stopBoard([
						vehicle("T1", at(29)),
						vehicle("T2", at(31)),
						vehicle("T3", at(35)),
					]),
					rideMs: 2 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(
			transferRoute,
			boards,
			input(at(15)),
			config
		);
		expect(estimate.rank).toBe(1);
		expect(estimate.legs[0]?.alightEtaAt).toBe(at(27));
		expect(estimate.legs[1]?.vehicleId).toBe("T2");
		expect(estimate.legs[1]?.boardEtaAt).toBe(at(31));
		expect(estimate.legs[1]?.alightEtaAt).toBe(at(33));
		expect(estimate.destinationEtaAt).toBe(at(35));
	});

	it("환승 도보가 길면 더 늦은 열차를 고른다", () => {
		const longTransfer: Route = { ...transferRoute, walkMinutes: [5, 6, 2] };
		const boards = fakeBoards([
			[
				busLeg,
				{ board: stopBoard([vehicle("A", at(17))]), rideMs: 10 * MINUTE_MS },
			],
			[
				subwayLeg,
				{
					board: stopBoard([vehicle("T2", at(31)), vehicle("T3", at(35))]),
					rideMs: 2 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(longTransfer, boards, input(at(15)), config);
		expect(estimate.legs[1]?.vehicleId).toBe("T3");
	});

	it("첫 구간 차량이 하차 정류장에 닿은 뒤에는 fromLeg 구간을 readyAt 뒤 첫 열차로 고른다", () => {
		// 탄 버스 A가 하차 정류장에 닿았다(진행 정보에 도착 시각이 없다). 환승 도보 중이고 08:34부터 탈 수 있다.
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("B", at(25))]),
					progress: {
						A: { etaAt: null, method: "official", stopsAway: 0 },
					},
					rideMs: 10 * MINUTE_MS,
				},
			],
			[
				subwayLeg,
				{
					board: stopBoard([vehicle("T0", at(32)), vehicle("T1", at(36))]),
					rideMs: 2 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(
			transferRoute,
			boards,
			input(at(34), { fixed: ["A", null], fromLeg: 1 }),
			config
		);
		expect(estimate.legs[0]?.vehicleId).toBe("A");
		expect(estimate.legs[1]?.vehicleId).toBe("T1");
		expect(estimate.legs[1]?.boardEtaAt).toBe(at(36));
		expect(estimate.legs[1]?.alightEtaAt).toBe(at(38));
		expect(estimate.destinationEtaAt).toBe(at(40));
	});

	it("fromLeg 앞 구간은 끝난 구간이라 새 차량을 고르지 않는다", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{ board: stopBoard([vehicle("B", at(25))]), rideMs: 10 * MINUTE_MS },
			],
			[
				subwayLeg,
				{ board: stopBoard([vehicle("T1", at(36))]), rideMs: 2 * MINUTE_MS },
			],
		]);
		const estimate = estimateRoute(
			transferRoute,
			boards,
			input(at(34), { fromLeg: 1 }),
			config
		);
		expect(estimate.legs[0]?.vehicleId).toBeNull();
		expect(estimate.legs[0]?.boardEtaAt).toBeNull();
		expect(estimate.legs[1]?.vehicleId).toBe("T1");
	});
});

describe("estimateRoute: 잡아 둔 차량", () => {
	const board = stopBoard([vehicle("A", at(17)), vehicle("B", at(25))]);

	it("더 이른 차량이 있어도 fixed 차량을 쓴다", () => {
		const boards = fakeBoards([[busLeg, { board, rideMs: 14 * MINUTE_MS }]]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(15), { fixed: ["B"] }),
			config
		);
		expect(estimate.legs[0]?.vehicleId).toBe("B");
		expect(estimate.legs[0]?.boardEtaAt).toBe(at(25));
	});

	it("fixed 차량이 readyAt보다 일러도 그 차량을 쓴다", () => {
		const boards = fakeBoards([[busLeg, { board, rideMs: 14 * MINUTE_MS }]]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(20), { fixed: ["A"] }),
			config
		);
		expect(estimate.legs[0]?.vehicleId).toBe("A");
		expect(estimate.legs[0]?.boardEtaAt).toBe(at(17));
	});

	it("fixed 차량이 도착판에서 사라졌으면 vehicleId는 남고 boardEtaAt은 null", () => {
		const boards = fakeBoards([[busLeg, { board, rideMs: 14 * MINUTE_MS }]]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(15), { fixed: ["GONE"] }),
			config
		);
		expect(estimate.legs[0]?.vehicleId).toBe("GONE");
		expect(estimate.legs[0]?.boardEtaAt).toBeNull();
		expect(estimate.legs[0]?.alightEtaAt).toBeNull();
		expect(estimate.destinationEtaAt).toBeNull();
	});

	it("이미 탄 차량(승차 도착판에 없음)은 진행 정보로 하차 도착을 낸다", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board,
					progress: {
						RIDING: { etaAt: at(29), method: "official", stopsAway: 2 },
					},
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(15), { fixed: ["RIDING"] }),
			config
		);
		expect(estimate.legs[0]).toEqual({
			alightEtaAt: at(29),
			boardEtaAt: null,
			etaState: "live",
			method: "official",
			positionState: "live",
			stopsAway: 2,
			vehicleId: "RIDING",
		});
		expect(estimate.destinationEtaAt).toBe(at(32));
	});

	it("탄 열차가 승차역에도 하차역에도 없으면 탄 시각 + 주행 시간으로 하차를 추정한다", () => {
		const boards = fakeBoards([
			[
				subwayLeg,
				{
					board: stopBoard([vehicle("NEXT", at(22))]),
					rideMs: 20 * MINUTE_MS,
				},
			],
		]);
		const route: Route = { legs: [subwayLeg], rank: 0, walkMinutes: [5, 3] };
		const riding = estimateRoute(
			route,
			boards,
			input(at(8), { boardedLegs: [true], fixed: ["T1"] }),
			config
		);
		expect(riding.legs[0]).toEqual({
			alightEtaAt: at(28),
			boardEtaAt: null,
			etaState: "estimated",
			method: "timetable",
			positionState: "live",
			stopsAway: null,
			vehicleId: "T1",
		});
		expect(riding.destinationEtaAt).toBe(at(31));

		// 타기 전에 사라진 열차는 시각을 모른다. 모르는 시각을 실시간이라고 하지 않는다.
		const before = estimateRoute(
			route,
			boards,
			input(at(15), { fixed: ["T1"] }),
			config
		);
		expect(before.legs[0]?.alightEtaAt).toBeNull();
		expect(before.legs[0]?.method).toBeNull();
		expect(before.legs[0]?.etaState).toBe("estimated");
		expect(before.destinationEtaAt).toBeNull();
	});

	it("skip은 fixed 차량에는 쓰지 않는다", () => {
		const boards = fakeBoards([[busLeg, { board, rideMs: 14 * MINUTE_MS }]]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(15), { fixed: ["A"], skip: new Set(["A"]) }),
			config
		);
		expect(estimate.legs[0]?.vehicleId).toBe("A");
	});
});

describe("estimateRoute: 묵은 도착판", () => {
	function staleBoards(ageSec: number): TransitBoards {
		return fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(17))], {
						headwayMs: 12 * MINUTE_MS,
						sourceAt: at(10) - ageSec * SECOND_MS,
					}),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
	}

	it("151초 묵었으면 배차간격의 반을 더한 추정으로 바꾼다", () => {
		const estimate = estimateRoute(
			busRoute,
			staleBoards(151),
			input(at(15)),
			config
		);
		const [leg] = estimate.legs;
		expect(leg?.positionState).toBe("stale");
		expect(leg?.etaState).toBe("estimated");
		expect(leg?.method).toBe("headway");
		expect(leg?.boardEtaAt).toBe(at(15) + 6 * MINUTE_MS);
		expect(leg?.alightEtaAt).toBe(at(15) + 20 * MINUTE_MS);
		expect(leg?.stopsAway).toBeNull();
	});

	it("150초면 아직 실시간이다", () => {
		const estimate = estimateRoute(
			busRoute,
			staleBoards(150),
			input(at(15)),
			config
		);
		const [leg] = estimate.legs;
		expect(leg?.positionState).toBe("live");
		expect(leg?.etaState).toBe("live");
		expect(leg?.method).toBe("official");
		expect(leg?.boardEtaAt).toBe(at(17));
	});

	it("묵었고 배차간격을 모르면 boardEtaAt은 null", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(17))], {
						headwayMs: null,
						sourceAt: at(0),
					}),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(busRoute, boards, input(at(15)), config);
		expect(estimate.legs[0]?.positionState).toBe("stale");
		expect(estimate.legs[0]?.etaState).toBe("estimated");
		expect(estimate.legs[0]?.boardEtaAt).toBeNull();
		expect(estimate.destinationEtaAt).toBeNull();
	});

	it("탄 차량은 도착판이 묵어도 진행 정보로 하차 도착을 내고 위치는 stale로 둔다", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("B", at(25))], {
						headwayMs: 10 * MINUTE_MS,
						sourceAt: at(10) - 151 * SECOND_MS,
					}),
					progress: {
						RIDING: { etaAt: at(33), method: "official", stopsAway: 2 },
					},
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(35), { fixed: ["RIDING"] }),
			config
		);
		expect(estimate.legs[0]).toEqual({
			alightEtaAt: at(33),
			boardEtaAt: null,
			etaState: "estimated",
			method: "headway",
			positionState: "stale",
			stopsAway: null,
			vehicleId: "RIDING",
		});
		expect(estimate.destinationEtaAt).toBe(at(36));
	});

	it("묵은 도착판에 남은 잡아 둔 차량(탑승 전)은 배차간격 추정을 쓴다", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(17))], {
						headwayMs: 12 * MINUTE_MS,
						sourceAt: at(10) - 151 * SECOND_MS,
					}),
					progress: {
						A: { etaAt: at(31), method: "official", stopsAway: 5 },
					},
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(15), { fixed: ["A"] }),
			config
		);
		expect(estimate.legs[0]?.boardEtaAt).toBe(at(21));
		expect(estimate.legs[0]?.alightEtaAt).toBe(at(35));
		expect(estimate.legs[0]?.positionState).toBe("stale");
	});

	it("묵음 기준은 config.staleAfterMs를 따른다", () => {
		const strict = commuteConfig({ COMMUTE_STALE_AFTER_MS: "60000" });
		const estimate = estimateRoute(
			busRoute,
			staleBoards(61),
			input(at(15)),
			strict
		);
		expect(estimate.legs[0]?.positionState).toBe("stale");
	});
});

describe("estimateRoute: 시각 상태", () => {
	const cases: [ArrivalMethod, "live" | "estimated"][] = [
		["official", "live"],
		["official-corrected", "live"],
		["timetable", "estimated"],
		["extrapolated", "estimated"],
	];

	for (const [method, etaState] of cases) {
		it(`새 도착판에서 method ${method} → 위치 live, 시각 ${etaState}`, () => {
			const boards = fakeBoards([
				[
					subwayLeg,
					{
						board: stopBoard([vehicle("T1", at(17), { method })]),
						rideMs: 2 * MINUTE_MS,
					},
				],
			]);
			const route: Route = { legs: [subwayLeg], rank: 0, walkMinutes: [5, 3] };
			const estimate = estimateRoute(route, boards, input(at(15)), config);
			expect(estimate.legs[0]?.positionState).toBe("live");
			expect(estimate.legs[0]?.etaState).toBe(etaState);
			expect(estimate.legs[0]?.method).toBe(method);
		});
	}
});

describe("estimateRoute: 도착판 없음", () => {
	it("위치 none, 시각 추정, 도착은 모두 null", () => {
		const boards = fakeBoards([]);
		const estimate = estimateRoute(busRoute, boards, input(at(15)), config);
		const [leg] = estimate.legs;
		expect(leg?.positionState).toBe("none");
		expect(leg?.etaState).toBe("estimated");
		expect(leg?.boardEtaAt).toBeNull();
		expect(leg?.alightEtaAt).toBeNull();
		expect(leg?.vehicleId).toBeNull();
		expect(estimate.destinationEtaAt).toBeNull();
	});

	it("첫 구간을 모르면 둘째 구간도 고르지 않는다", () => {
		const boards = fakeBoards([
			[
				subwayLeg,
				{ board: stopBoard([vehicle("T1", at(31))]), rideMs: 2 * MINUTE_MS },
			],
		]);
		const estimate = estimateRoute(
			transferRoute,
			boards,
			input(at(15)),
			config
		);
		expect(estimate.legs[1]?.vehicleId).toBeNull();
		expect(estimate.legs[1]?.boardEtaAt).toBeNull();
		expect(estimate.destinationEtaAt).toBeNull();
	});
});

describe("estimateRoute: 도착판 범위 밖", () => {
	it("두 대 모두 readyAt보다 이르면 마지막 차량 + 배차간격", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(11)), vehicle("B", at(14))], {
						headwayMs: 10 * MINUTE_MS,
					}),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(busRoute, boards, input(at(15)), config);
		const [leg] = estimate.legs;
		expect(leg?.boardEtaAt).toBe(at(24));
		expect(leg?.method).toBe("headway");
		expect(leg?.etaState).toBe("estimated");
		expect(leg?.positionState).toBe("live");
		expect(leg?.vehicleId).toBeNull();
		expect(leg?.alightEtaAt).toBe(at(38));
		expect(estimate.destinationEtaAt).toBe(at(41));
	});

	it("배차간격 하나로도 readyAt에 못 미치면 배차간격을 더 쌓는다", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(11)), vehicle("B", at(14))], {
						headwayMs: 10 * MINUTE_MS,
					}),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(busRoute, boards, input(at(30)), config);
		expect(estimate.legs[0]?.boardEtaAt).toBe(at(34));
	});

	it("skip으로 남은 차량이 없을 때도 마지막 차량 + 배차간격", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(11)), vehicle("B", at(18))], {
						headwayMs: 10 * MINUTE_MS,
					}),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(
			busRoute,
			boards,
			input(at(15), { skip: new Set(["B"]) }),
			config
		);
		expect(estimate.legs[0]?.boardEtaAt).toBe(at(28));
		expect(estimate.legs[0]?.method).toBe("headway");
	});

	it("범위 밖인데 배차간격을 모르면 boardEtaAt은 null", () => {
		const boards = fakeBoards([
			[
				busLeg,
				{
					board: stopBoard([vehicle("A", at(11))], { headwayMs: null }),
					rideMs: 14 * MINUTE_MS,
				},
			],
		]);
		const estimate = estimateRoute(busRoute, boards, input(at(15)), config);
		expect(estimate.legs[0]?.boardEtaAt).toBeNull();
		expect(estimate.legs[0]?.etaState).toBe("estimated");
		expect(estimate.destinationEtaAt).toBeNull();
	});
});
