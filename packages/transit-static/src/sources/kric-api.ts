import type { ServiceDay, TrackDirection } from "@Betro/db/schema/transit";
import type { LineKey } from "../lines";
import type { SourceStop, SourceTrip } from "../timetable/model";

/**
 * KRIC 도시철도 역별 시간표 API(id=162). 서비스키가 없어 아직 실호출로 확인하지 못했다(키 대기).
 * 요청 파라미터와 응답 필드명은 명세 기억에 기댄 값이므로 키가 생기면 실응답으로 대조한다.
 */
export const KRIC_API_BASE =
	"https://openapi.kric.go.kr/openapi/trainUseInfo/subwayTimetable";

/**
 * GTX-A 노선·운영기관 코드. 연구 보고서 KRIC 코드표(2026.07.11): GX GTX-A(lnCd A, 동탄 X111만 SR).
 */
export const GTX_A_LN_CD = "A";
export const GTX_A_RAIL_OPR_ISTT_CD = "GX";
export const GTX_A_DONGTAN_STIN_CD = "X111";
export const GTX_A_DONGTAN_RAIL_OPR_ISTT_CD = "SR";

/** 역별 운영기관 코드. 동탄(X111)만 SR, 나머지는 GX. */
export function gtxARailOprIsttCd(stinCd: string): string {
	return stinCd === GTX_A_DONGTAN_STIN_CD
		? GTX_A_DONGTAN_RAIL_OPR_ISTT_CD
		: GTX_A_RAIL_OPR_ISTT_CD;
}

export const KRIC_MISSING_KEY_MESSAGE =
	"KRIC_SERVICE_KEY가 없습니다. 국가철도공단 철도산업정보센터(KRIC)에서 서비스키를 발급받아 설정하세요.";

export type KricDayCode = "7" | "8" | "9";

/** 평일 8, 토요일 7, 휴일 9(확인 필요). */
const DAY_CODE_SERVICE_DAYS: Readonly<Record<string, ServiceDay>> = {
	"7": "saturday",
	"8": "weekday",
	"9": "holiday",
};

const RESULT_OK = "00";
/** HHMMSS가 이 값이면 그쪽 시각이 없는 것으로 본다(기점의 도착, 종점의 출발). */
const NO_TIME = "000000";
const COMPACT_TIME_PATTERN = /^(\d{2})(\d{2})(\d{2})$/;
/** kric-packed.ts의 LATE_NIGHT_CUTOFF_HOUR와 같은 기준. */
const MIDNIGHT_HOURS = 3;
const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** 응답 한 건: 한 역에서 한 열차의 도착·출발. 시각은 HHMMSS. */
export interface KricTimetableRow {
	arvTm: string;
	dayCd: string;
	dptTm: string;
	lnCd: string;
	railOprIsttCd: string;
	stinCd: string;
	stinNm?: string;
	trnNo: string;
	/** U 상행, D 하행(확인 필요). */
	upbdnbSttsCd?: string;
}

export function readKricServiceKey(
	env: Record<string, string | undefined>
): string | undefined {
	const key = env.KRIC_SERVICE_KEY;
	return key ? key : undefined;
}

export async function fetchKricTimetable(
	args: {
		serviceKey: string;
		lnCd: string;
		railOprIsttCd: string;
		stinCd: string;
		dayCd: KricDayCode;
	},
	fetchImpl: typeof fetch = fetch
): Promise<KricTimetableRow[]> {
	const params = new URLSearchParams({
		dayCd: args.dayCd,
		format: "json",
		lnCd: args.lnCd,
		railOprIsttCd: args.railOprIsttCd,
		serviceKey: args.serviceKey,
		stinCd: args.stinCd,
	});
	const response = await fetchImpl(`${KRIC_API_BASE}?${params.toString()}`);
	if (!response.ok) {
		throw new Error(`KRIC API HTTP ${response.status}`);
	}
	const json = (await response.json()) as {
		body?: KricTimetableRow[];
		header?: { resultCode?: string; resultMsg?: string };
	};
	const code = json.header?.resultCode;
	if (code !== RESULT_OK) {
		throw new Error(
			`KRIC API error ${code ?? "?"}: ${json.header?.resultMsg ?? "no header"}`
		);
	}
	return json.body ?? [];
}

/** HHMMSS를 서비스일 기준 "HH:MM:SS"로 바꾼다. 3시 전 시각은 24~26시로 올린다. */
function toClock(compact: string): string | null {
	if (compact === "" || compact === NO_TIME) {
		return null;
	}
	const match = COMPACT_TIME_PATTERN.exec(compact);
	if (!match) {
		throw new Error(`Unrecognized KRIC time: "${compact}"`);
	}
	const hour = Number(match[1]);
	const shifted = hour < MIDNIGHT_HOURS ? hour + HOURS_PER_DAY : hour;
	return `${String(shifted).padStart(2, "0")}:${match[2]}:${match[3]}`;
}

/** 정렬용 초. toClock이 이미 새벽(3시 전) 시각에 24시간을 더해 서비스일 기준으로 내보낸다. */
function sortKey(row: KricTimetableRow): number {
	const clock = toClock(row.dptTm) ?? toClock(row.arvTm) ?? "00:00:00";
	const [h = 0, m = 0, s = 0] = clock.split(":").map(Number);
	return h * SECONDS_PER_HOUR + m * SECONDS_PER_MINUTE + s;
}

/** 역 단위 응답을 trnNo로 묶어 열차 trip으로 만든다. 정차 순서는 시각 순이다. */
export function assembleKricApiTrips(
	rowsByStation: Map<string, KricTimetableRow[]>,
	lineKey: LineKey
): SourceTrip[] {
	const groups = new Map<string, KricTimetableRow[]>();
	for (const rows of rowsByStation.values()) {
		for (const row of rows) {
			const key = [row.dayCd, row.upbdnbSttsCd ?? "", row.trnNo].join("|");
			const group = groups.get(key);
			if (group) {
				group.push(row);
			} else {
				groups.set(key, [row]);
			}
		}
	}
	const trips: SourceTrip[] = [];
	for (const rows of groups.values()) {
		const [first] = rows;
		const serviceDay = first ? DAY_CODE_SERVICE_DAYS[first.dayCd] : undefined;
		if (!(first && serviceDay)) {
			continue;
		}
		const direction: TrackDirection =
			first.upbdnbSttsCd === "D" ? "down" : "up";
		const stops: SourceStop[] = [...rows]
			.sort((a, b) => sortKey(a) - sortKey(b))
			.map((row, index) => ({
				arrive: toClock(row.arvTm),
				depart: toClock(row.dptTm),
				seq: index + 1,
				station: { code: row.stinCd, name: row.stinNm },
			}));
		trips.push({
			direction,
			express: "local",
			lineKey,
			qualityFlags: [],
			serviceDay,
			serviceDaySource: "source",
			source: "kric-api",
			stops,
			trainNo: first.trnNo,
		});
	}
	return trips;
}
