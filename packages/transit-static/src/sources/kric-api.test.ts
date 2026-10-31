import { describe, expect, it } from "bun:test";
import {
	assembleKricApiTrips,
	fetchKricTimetable,
	KRIC_MISSING_KEY_MESSAGE,
	type KricTimetableRow,
	readKricServiceKey,
} from "./kric-api";

function row(
	stinCd: string,
	stinNm: string,
	trnNo: string,
	arvTm: string,
	dptTm: string
): KricTimetableRow {
	return {
		arvTm,
		dayCd: "8",
		dptTm,
		lnCd: "A",
		railOprIsttCd: "SR",
		stinCd,
		stinNm,
		trnNo,
		upbdnbSttsCd: "U",
	};
}

describe("assembleKricApiTrips", () => {
	it("groups station responses by train number into trips with two stops", () => {
		const byStation = new Map<string, KricTimetableRow[]>([
			[
				"S1",
				[
					row("S1", "수서", "A101", "000000", "053000"),
					row("S1", "수서", "A103", "000000", "054000"),
				],
			],
			[
				"S2",
				[
					row("S2", "성남", "A101", "053400", "053430"),
					row("S2", "성남", "A103", "054400", "054430"),
				],
			],
		]);
		const trips = assembleKricApiTrips(byStation, "gtx-a");
		expect(trips).toHaveLength(2);
		const first = trips.find((t) => t.trainNo === "A101");
		expect(first?.stops).toHaveLength(2);
		expect(first?.stops.map((s) => s.station.name)).toEqual(["수서", "성남"]);
		expect(first?.stops[0]?.arrive).toBeNull();
		expect(first?.stops[0]?.depart).toBe("05:30:00");
		expect(first?.stops[1]?.arrive).toBe("05:34:00");
		expect(first?.source).toBe("kric-api");
		expect(first?.serviceDay).toBe("weekday");
		expect(first?.direction).toBe("up");
	});
});

describe("fetchKricTimetable", () => {
	it("passes the key and station params and returns the body rows", async () => {
		let requested = "";
		const fetchImpl = ((url: string) => {
			requested = url;
			return Promise.resolve(
				Response.json({
					body: [row("S1", "수서", "A101", "000000", "053000")],
					header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
				})
			);
		}) as unknown as typeof fetch;
		const rows = await fetchKricTimetable(
			{
				dayCd: "8",
				lnCd: "A",
				railOprIsttCd: "SR",
				serviceKey: "KEY",
				stinCd: "S1",
			},
			fetchImpl
		);
		expect(rows).toHaveLength(1);
		expect(requested).toContain("serviceKey=KEY");
		expect(requested).toContain("stinCd=S1");
	});

	it("throws when the API reports a non-00 result code", async () => {
		const fetchImpl = (() =>
			Promise.resolve(
				Response.json({
					header: { resultCode: "30", resultMsg: "SERVICE KEY" },
				})
			)) as unknown as typeof fetch;
		await expect(
			fetchKricTimetable(
				{
					dayCd: "8",
					lnCd: "A",
					railOprIsttCd: "SR",
					serviceKey: "BAD",
					stinCd: "S1",
				},
				fetchImpl
			)
		).rejects.toThrow("SERVICE KEY");
	});
});

describe("readKricServiceKey", () => {
	it("returns undefined and the message names KRIC_SERVICE_KEY when unset", () => {
		expect(readKricServiceKey({})).toBeUndefined();
		expect(KRIC_MISSING_KEY_MESSAGE).toContain("KRIC_SERVICE_KEY가 없습니다.");
		expect(readKricServiceKey({ KRIC_SERVICE_KEY: "k" })).toBe("k");
	});
});
