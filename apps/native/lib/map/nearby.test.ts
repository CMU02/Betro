import { expect, it } from "bun:test";
import type { SubwayStationPoint } from "./map-client";
import { locateOnce, NEARBY_RADIUS_M, nearbyLines } from "./nearby";

const HERE = { latitude: 37.5665, longitude: 126.978 };

/** 위도 0.001도는 약 111m다. 기준점 북쪽으로 `meters`만큼 떨어진 역을 만든다. */
function stationNorthOf(
	line: string,
	stop: string,
	meters: number
): SubwayStationPoint {
	const METERS_PER_LAT_DEGREE = 111_000;
	return {
		lat: HERE.latitude + meters / METERS_PER_LAT_DEGREE,
		line,
		lng: HERE.longitude,
		name: stop,
		stop,
	};
}

it("returns lines of stations within radius ordered by distance without duplicates", () => {
	const stations = [
		stationNorthOf("seoul-subway:2", "2-a", 900),
		stationNorthOf("seoul-subway:1", "1-a", 300),
		stationNorthOf("seoul-subway:2", "2-b", 100),
		stationNorthOf("seoul-subway:3", "3-far", NEARBY_RADIUS_M + 500),
		stationNorthOf("seoul-subway:4", "4-a", 600),
	];

	expect(nearbyLines(stations, HERE, NEARBY_RADIUS_M)).toEqual([
		"seoul-subway:2",
		"seoul-subway:1",
		"seoul-subway:4",
	]);
});

it("returns [] when nothing is within radius", () => {
	const stations = [stationNorthOf("seoul-subway:2", "2-far", 5000)];

	expect(nearbyLines(stations, HERE, NEARBY_RADIUS_M)).toEqual([]);
});

it("uses a 1500m default radius constant", () => {
	expect(NEARBY_RADIUS_M).toBe(1500);
});

it("locateOnce reads the position only when permission is granted", async () => {
	let calls = 0;
	const getPosition = () => {
		calls += 1;
		return Promise.resolve({ latitude: 37.5, longitude: 127.0 });
	};

	expect(await locateOnce("denied", getPosition)).toBeNull();
	expect(await locateOnce("undetermined", getPosition)).toBeNull();
	expect(calls).toBe(0);

	expect(await locateOnce("granted", getPosition)).toEqual({
		latitude: 37.5,
		longitude: 127.0,
	});
	expect(calls).toBe(1);
});
