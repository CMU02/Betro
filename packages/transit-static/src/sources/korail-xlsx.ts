import type { ServiceDay, TrackDirection } from "@Betro/db/schema/transit";
import readXlsxFile from "read-excel-file/node";
import type { LineKey } from "../lines";
import type { SourceStop, SourceTrip } from "../timetable/model";
import { copyAsSaturday } from "./kric-korail-rows";

/**
 * korail.com에서 사람이 내려받아 data/manual/timetables/에 넣는 노선별 시간표 XLSX.
 * 실제 파일 형식은 아직 확인하지 못했다(README "확인 필요"). 지금은 아래 가정으로 읽는다.
 * - 시트 이름에 "평일" 또는 "휴일"이 들어간 시트 하나씩.
 * - 열차 1편 = 열 하나. 0행은 "열차번호" + 열차번호들, 1행은 "방향" + 상행/하행, 2행부터 역 이름 + 시각(HH:MM).
 * - 빈 칸은 그 열차가 서지 않는 역이다.
 */
export const KORAIL_XLSX_SHEET_LABELS: Readonly<Record<string, ServiceDay>> = {
	평일: "weekday",
	휴일: "holiday",
};

const TRAIN_NO_ROW = 0;
const DIRECTION_ROW = 1;
const FIRST_STATION_ROW = 2;
const DIRECTION_LABELS: Readonly<Record<string, TrackDirection>> = {
	상행: "up",
	하행: "down",
};

function cellText(cell: unknown): string {
	if (cell === null || cell === undefined) {
		return "";
	}
	return String(cell).trim();
}

function parseSheetTrips(
	data: unknown[][],
	lineKey: LineKey,
	serviceDay: ServiceDay,
	sheetName: string,
	errors: string[]
): SourceTrip[] {
	const trainRow = data[TRAIN_NO_ROW] ?? [];
	const directionRow = data[DIRECTION_ROW] ?? [];
	const trips: SourceTrip[] = [];
	for (let col = 1; col < trainRow.length; col += 1) {
		const trainNo = cellText(trainRow[col]);
		if (trainNo === "") {
			continue;
		}
		const direction = DIRECTION_LABELS[cellText(directionRow[col])];
		if (!direction) {
			errors.push(
				`direction-unknown ${sheetName} ${trainNo} "${cellText(directionRow[col])}"`
			);
			continue;
		}
		const stops: SourceStop[] = [];
		for (const row of data.slice(FIRST_STATION_ROW)) {
			const time = cellText(row[col]);
			const name = cellText(row[0]);
			if (time === "" || name === "") {
				continue;
			}
			stops.push({
				arrive: time,
				depart: time,
				seq: stops.length + 1,
				station: { name },
			});
		}
		trips.push({
			direction,
			express: "local",
			lineKey,
			qualityFlags: [],
			serviceDay,
			serviceDaySource: "source",
			source: "korail-xlsx",
			stops,
			trainNo,
		});
	}
	return trips;
}

/** 평일·휴일 두 시트를 읽는다. 토요일 시트가 없으므로 휴일 trip을 토요일로 복제한다. */
export async function parseKorailXlsx(
	bytes: Uint8Array,
	lineKey: LineKey
): Promise<{ trips: SourceTrip[]; errors: string[]; sheets: string[] }> {
	const workbook = await readXlsxFile(Buffer.from(bytes));
	const errors: string[] = [];
	const sheets = workbook.map((sheet) => sheet.sheet);
	const trips: SourceTrip[] = [];
	for (const [label, serviceDay] of Object.entries(KORAIL_XLSX_SHEET_LABELS)) {
		const sheet = workbook.find((s) => s.sheet.includes(label));
		if (!sheet) {
			errors.push(`missing-sheet ${label}`);
			continue;
		}
		trips.push(
			...parseSheetTrips(
				sheet.data as unknown[][],
				lineKey,
				serviceDay,
				sheet.sheet,
				errors
			)
		);
	}
	const copies = trips
		.filter((trip) => trip.serviceDay === "holiday")
		.map(copyAsSaturday);
	return { errors, sheets, trips: [...trips, ...copies] };
}
