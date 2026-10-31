import { describe, expect, it } from "bun:test";
import {
	AIRPORT_EXPRESS_CSV_COLUMNS,
	parseAirportExpressCsv,
} from "./airport-express-csv";

const HEADER = AIRPORT_EXPRESS_CSV_COLUMNS.join(",");

describe("parseAirportExpressCsv", () => {
	it("makes one direct trip per row with a synthetic train number", () => {
		const text = `${HEADER}\ndown,서울역,05:20,인천공항2터미널,06:03\ndown,서울역,05:40,인천공항2터미널,06:23\n`;
		const { trips, errors } = parseAirportExpressCsv(text);
		expect(errors).toEqual([]);
		expect(trips).toHaveLength(2);
		expect(trips[0]?.trainNo).toBe("DIRECT-down-0520");
		expect(trips[0]?.express).toBe("direct");
		expect(trips[0]?.lineKey).toBe("airport");
		expect(trips[0]?.qualityFlags).toContain("synthetic-train-no");
		expect(trips[0]?.source).toBe("airport-express-csv");
		expect(trips[0]?.stops.map((s) => s.station.name)).toEqual([
			"서울역",
			"인천공항2터미널",
		]);
		expect(trips[0]?.stops[0]?.depart).toBe("05:20");
		expect(trips[0]?.stops[1]?.arrive).toBe("06:03");
	});

	it("drops rows with an unknown direction or station and reports them", () => {
		const text = `${HEADER}\nsideways,서울역,05:20,인천공항1터미널,06:00\nup,인천공항1터미널,07:00,홍대입구,07:50\n`;
		const { trips, errors } = parseAirportExpressCsv(text);
		expect(trips).toEqual([]);
		expect(errors).toHaveLength(2);
	});
});
