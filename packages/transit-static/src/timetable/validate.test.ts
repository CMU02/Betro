import { describe, expect, it } from "bun:test";
import type { StopTime, Trip } from "./model";
import { validateTrips } from "./validate";

const A = "1000000001";
const B = "1000000002";
const C = "1000000003";
const known = new Set([A, B, C]);

const st = (
	seq: number,
	statnId: string,
	arriveSec: number | null,
	departSec: number | null = arriveSec
): StopTime => ({ arriveSec, departSec, qualityFlags: [], seq, statnId });

const trip = (trainNo: string, stops: StopTime[]): Trip => ({
	direction: "up",
	express: "local",
	lineKey: "line2",
	qualityFlags: [],
	serviceDay: "weekday",
	serviceDaySource: "source",
	source: "seoul-metro-csv",
	sourceVersion: "2026-10-01",
	stops,
	trainNo,
});

const clean = (trainNo: string, start: number, abSec = 120): Trip =>
	trip(trainNo, [
		st(1, A, null, start),
		st(2, B, start + abSec, start + abSec + 30),
		st(3, C, start + abSec + 150, null),
	]);

describe("validateTrips", () => {
	it("reports nothing for clean trips", () => {
		expect(
			validateTrips([clean("2001", 18_000), clean("2003", 18_600)], known)
		).toEqual([]);
	});
	it("errors on a station missing from the crosswalk", () => {
		const issues = validateTrips(
			[trip("2001", [st(1, A, 18_000), st(2, "9999999999", 18_120)])],
			known
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			code: "unknown-station",
			lineKey: "line2",
			serviceDay: "weekday",
			severity: "error",
			trainNo: "2001",
		});
	});
	it("errors when times go backwards, including arrive after depart", () => {
		const issues = validateTrips(
			[trip("2001", [st(1, A, 18_000), st(2, B, 18_120, 18_100)])],
			known
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			code: "non-monotonic",
			severity: "error",
		});
	});
	it("errors on a trip with one stop or fewer", () => {
		const issues = validateTrips([trip("2001", [st(1, A, 18_000)])], known);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ code: "empty-trip", severity: "error" });
	});
	it("warns when a segment takes 3x the median of the same segment", () => {
		const issues = validateTrips(
			[
				clean("2001", 18_000),
				clean("2003", 18_600),
				clean("2005", 19_200),
				clean("2007", 19_800, 600),
			],
			known
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			code: "segment-outlier",
			severity: "warn",
			trainNo: "2007",
		});
	});
	it("skips segments with fewer than 3 samples", () => {
		expect(
			validateTrips([clean("2001", 18_000), clean("2003", 18_600, 600)], known)
		).toEqual([]);
	});
	it("warns when a trip visits the same station twice", () => {
		const issues = validateTrips(
			[trip("2001", [st(1, A, 18_000), st(2, B, 18_120), st(3, A, 18_240)])],
			known
		);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			code: "duplicate-stop",
			severity: "warn",
		});
	});
});
