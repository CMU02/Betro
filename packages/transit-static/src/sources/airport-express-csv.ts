import type { ServiceDay, TrackDirection } from "@Betro/db/schema/transit";
import { parse } from "csv-parse/sync";
import type { SourceTrip } from "../timetable/model";

/**
 * 공항철도 직통열차 시각표. 공식 시각표를 사람이 옮겨 적은 CSV를 data/manual/timetables/에 넣는다.
 * direction은 up|down(상행=서울역 방면=up). 한 행 = 직통 1편(출발역 → 도착역).
 */
export const AIRPORT_EXPRESS_CSV_COLUMNS = [
	"direction",
	"departStation",
	"departTime",
	"arriveStation",
	"arriveTime",
] as const;

/** 직통은 서울역과 인천공항1·2터미널에만 선다. */
export const AIRPORT_EXPRESS_STATIONS: ReadonlySet<string> = new Set([
	"서울역",
	"인천공항1터미널",
	"인천공항2터미널",
]);

const DIRECTIONS: Readonly<Record<string, TrackDirection>> = {
	down: "down",
	up: "up",
	상행: "up",
	하행: "down",
};
const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;

function compactTime(time: string): string | undefined {
	const match = TIME_PATTERN.exec(time);
	return match ? `${match[1]?.padStart(2, "0")}${match[2]}` : undefined;
}

/** 직통 시각표 CSV를 trip으로 바꾼다. 요일 열이 없으므로 serviceDay는 호출자가 정한다(기본 평일). */
export function parseAirportExpressCsv(
	text: string,
	serviceDay: ServiceDay = "weekday"
): { trips: SourceTrip[]; errors: string[] } {
	const records = parse(text, {
		bom: true,
		columns: true,
		skip_empty_lines: true,
		trim: true,
	}) as Record<string, string>[];
	const trips: SourceTrip[] = [];
	const errors: string[] = [];
	for (const [index, record] of records.entries()) {
		const rowNumber = index + 2;
		const direction = DIRECTIONS[record.direction ?? ""];
		const { departStation, departTime, arriveStation, arriveTime } = record;
		if (!direction) {
			errors.push(`row ${rowNumber}: unknown direction "${record.direction}"`);
			continue;
		}
		if (
			!(
				departStation &&
				arriveStation &&
				AIRPORT_EXPRESS_STATIONS.has(departStation) &&
				AIRPORT_EXPRESS_STATIONS.has(arriveStation)
			)
		) {
			errors.push(
				`row ${rowNumber}: unknown station "${departStation}" -> "${arriveStation}"`
			);
			continue;
		}
		const key = compactTime(departTime ?? "");
		if (!(key && compactTime(arriveTime ?? ""))) {
			errors.push(
				`row ${rowNumber}: bad time "${departTime}" -> "${arriveTime}"`
			);
			continue;
		}
		trips.push({
			direction,
			express: "direct",
			lineKey: "airport",
			qualityFlags: ["synthetic-train-no"],
			serviceDay,
			serviceDaySource: "source",
			source: "airport-express-csv",
			stops: [
				{
					arrive: null,
					depart: departTime ?? null,
					seq: 1,
					station: { name: departStation },
				},
				{
					arrive: arriveTime ?? null,
					depart: null,
					seq: 2,
					station: { name: arriveStation },
				},
			],
			trainNo: `DIRECT-${direction}-${key}`,
		});
	}
	return { errors, trips };
}
