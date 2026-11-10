import { describe, expect, it } from "bun:test";
import { buildSubwayReference, type SubwayReference } from "../reference";
import type { ArrivalRow } from "../upstream/subway-arrival";
import { reduceArrivals } from "./reduce-arrivals";

const STATION_SPACING_M = 1000;

/** 7호선 가짜 참조: 하행 모양(seq 증가 = 진행 방향)에 S0..S10, 상행 모양은 반대 순서. */
function fakeReference(): SubwayReference {
	const ids = Array.from({ length: 11 }, (_, i) => `S${i}`);
	const down = ids.map((statnId, seq) => ({
		branchKey: "main",
		direction: "down",
		distanceM: seq * STATION_SPACING_M,
		lineKey: "line7",
		seq,
		statnId,
		trackShapeId: 1,
	}));
	const up = [...ids].reverse().map((statnId, seq) => ({
		branchKey: "main",
		direction: "up",
		distanceM: seq * STATION_SPACING_M,
		lineKey: "line7",
		seq,
		statnId,
		trackShapeId: 2,
	}));
	return buildSubwayReference({
		batchIds: { crosswalk: 1, timetable: 1, track: 1 },
		crosswalk: ids.map((statnId) => ({ lineKey: "line7", statnId })),
		trackStations: [...down, ...up],
		trips: [],
	});
}

function arrival(overrides: Partial<ArrivalRow>): ArrivalRow {
	return {
		arvlCd: "99",
		bstatnId: "S10",
		btrainNo: "7001",
		btrainSttus: "일반",
		lstcarAt: "0",
		ordkey: "11000S100",
		recptnDt: "2026-11-03 13:00:00",
		statnFid: "",
		statnId: "S0",
		statnNm: "",
		statnTid: "",
		subwayId: "1007",
		updnLine: "하행",
		...overrides,
	};
}

describe("reduceArrivals", () => {
	const ref = fakeReference();

	it("maps arrival codes to station states", () => {
		const { trains } = reduceArrivals(
			[
				arrival({ arvlCd: "0", btrainNo: "7001", statnId: "S3" }),
				arrival({ arvlCd: "3", btrainNo: "7001", statnId: "S2" }),
				arrival({ arvlCd: "99", btrainNo: "7001", statnId: "S5" }),
				arrival({
					arvlCd: "4",
					btrainNo: "7003",
					statnFid: "S6",
					statnId: "S7",
				}),
				arrival({
					arvlCd: "5",
					btrainNo: "7005",
					statnFid: "S8",
					statnId: "S9",
				}),
			],
			ref
		);
		const byNo = new Map(trains.map((t) => [t.btrainNo, t]));
		expect(byNo.get("7001")).toMatchObject({
			statnId: "S3",
			status: "approach",
		});
		expect(byNo.get("7003")).toMatchObject({
			statnId: "S6",
			status: "approach",
		});
		expect(byNo.get("7005")).toMatchObject({
			statnId: "S8",
			status: "arrive",
		});
	});

	it("maps codes 1, 2 and 3 to the row station", () => {
		const { trains } = reduceArrivals(
			[
				arrival({ arvlCd: "1", btrainNo: "7011", statnId: "S1" }),
				arrival({ arvlCd: "2", btrainNo: "7013", statnId: "S2" }),
				arrival({ arvlCd: "3", btrainNo: "7015", statnId: "S3" }),
			],
			ref
		);
		expect(trains.map((t) => [t.btrainNo, t.statnId, t.status])).toEqual([
			["7011", "S1", "arrive"],
			["7013", "S2", "depart"],
			["7015", "S3", "prev-depart"],
		]);
	});

	it("picks the most advanced candidate", () => {
		const { trains, flags } = reduceArrivals(
			[
				arrival({ arvlCd: "1", statnId: "S3" }),
				arrival({ arvlCd: "0", statnId: "S4" }),
			],
			ref
		);
		expect(trains).toHaveLength(1);
		expect(trains[0]).toMatchObject({ statnId: "S4", status: "approach" });
		expect(flags.get("1007|7001") ?? []).not.toContain("conflicting-rows");
	});

	it("uses the direction's own station order", () => {
		const { trains } = reduceArrivals(
			[
				arrival({ arvlCd: "1", statnId: "S4", updnLine: "상행" }),
				arrival({ arvlCd: "0", statnId: "S3", updnLine: "상행" }),
			],
			ref
		);
		expect(trains[0]).toMatchObject({ statnId: "S3", status: "approach" });
	});

	it("breaks a same-station tie by status progress", () => {
		const { trains } = reduceArrivals(
			[
				arrival({ arvlCd: "0", statnId: "S4" }),
				arrival({ arvlCd: "2", statnId: "S4" }),
				arrival({ arvlCd: "1", statnId: "S4" }),
			],
			ref
		);
		expect(trains[0]).toMatchObject({ statnId: "S4", status: "depart" });
	});

	it("flags conflicting rows", () => {
		const { trains, flags } = reduceArrivals(
			[
				arrival({ arvlCd: "1", statnId: "S3" }),
				arrival({ arvlCd: "1", statnId: "S9" }),
			],
			ref
		);
		expect(trains[0]).toMatchObject({ statnId: "S9", status: "arrive" });
		expect(flags.get("1007|7001")).toContain("conflicting-rows");
		expect(trains[0]?.flags).toContain("conflicting-rows");
	});

	it("falls back to the smallest ordkey when distance is unknown", () => {
		const { trains } = reduceArrivals(
			[
				arrival({ arvlCd: "1", ordkey: "12001X0", statnId: "X1" }),
				arrival({ arvlCd: "0", ordkey: "11000X0", statnId: "X2" }),
			],
			ref
		);
		expect(trains[0]).toMatchObject({ statnId: "X2", status: "approach" });
	});

	it("keeps unknown-position trains with a flag", () => {
		const { trains, flags } = reduceArrivals(
			[
				arrival({ arvlCd: "99", ordkey: "13002S100", statnId: "S5" }),
				arrival({ arvlCd: "99", ordkey: "11000S100", statnId: "S6" }),
			],
			ref
		);
		expect(trains).toHaveLength(1);
		expect(trains[0]).toMatchObject({ statnId: null, status: null });
		expect(trains[0]?.row.statnId).toBe("S6");
		expect(flags.get("1007|7001")).toEqual(["position-unknown"]);
	});

	it("handles the wrap of a loop line", () => {
		const ids = Array.from({ length: 10 }, (_, i) => `L${i}`);
		const loopRef = buildSubwayReference({
			batchIds: { crosswalk: 1, timetable: 1, track: 1 },
			crosswalk: [],
			trackStations: ids.map((statnId, seq) => ({
				branchKey: "main",
				direction: "up",
				distanceM: seq * STATION_SPACING_M,
				lineKey: "line2",
				seq,
				statnId,
				trackShapeId: 9,
			})),
			trips: [],
		});
		const { trains, flags } = reduceArrivals(
			[
				arrival({
					arvlCd: "1",
					btrainNo: "2001",
					statnId: "L9",
					subwayId: "1002",
					updnLine: "내선",
				}),
				arrival({
					arvlCd: "0",
					btrainNo: "2001",
					statnId: "L0",
					subwayId: "1002",
					updnLine: "내선",
				}),
			],
			loopRef
		);
		expect(trains[0]).toMatchObject({ statnId: "L0", status: "approach" });
		expect(flags.get("1002|2001") ?? []).not.toContain("conflicting-rows");
	});
});
