import type { StopTime } from "./model";

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
/** 운행이 이어지는 시각(24~29시)까지 허용한다. */
const MAX_HOUR = 29;
const MAX_MINUTE = 59;
/**
 * 앞 시각보다 이만큼(12시간) 넘게 줄어들 때만 자정을 넘긴 것으로 본다.
 * 그보다 작은 역행은 데이터 오류이므로 그대로 두어 검증(non-monotonic)이 잡게 한다.
 */
const MIDNIGHT_WRAP_MIN_DROP_SEC = SECONDS_PER_DAY / 2;
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const EMPTY_MARKERS = new Set(["", "-"]);

/**
 * "HH:MM" 또는 "HH:MM:SS"를 서비스일 0시 기준 초로 바꾼다. 빈 값과 "-"는 null.
 * midnightIsNull이면 "00:00(:00)"도 null(서울교통공사 CSV처럼 0시를 빈 칸으로 쓰는 출처용).
 */
export function parseClock(
	text: string,
	opts: { midnightIsNull?: boolean } = {}
): number | null {
	const trimmed = text.trim();
	if (EMPTY_MARKERS.has(trimmed)) {
		return null;
	}
	const match = CLOCK_PATTERN.exec(trimmed);
	if (!match) {
		throw new Error(`Unrecognized clock text: "${text}"`);
	}
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3] ?? "0");
	if (hours > MAX_HOUR || minutes > MAX_MINUTE || seconds > MAX_MINUTE) {
		throw new Error(`Clock value out of range: "${text}"`);
	}
	const total =
		hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
	if (opts.midnightIsNull && total === 0) {
		return null;
	}
	return total;
}

/**
 * 정차 순서대로 도착·출발 시각을 훑어, 앞 시각보다 크게 줄어드는 지점(23:50 다음 00:05)부터 86,400을 더한다.
 * 이미 86,400 이상인 시각은 그대로 둔다. 입력은 바꾸지 않는다.
 */
export function normalizeTripTimes(stops: StopTime[]): StopTime[] {
	let offset = 0;
	let previous: number | undefined;
	const shift = (sec: number | null): number | null => {
		if (sec === null) {
			return null;
		}
		if (sec >= SECONDS_PER_DAY) {
			previous = sec;
			return sec;
		}
		let shifted = sec + offset;
		const wrapped =
			offset === 0 &&
			previous !== undefined &&
			previous - shifted > MIDNIGHT_WRAP_MIN_DROP_SEC;
		if (wrapped) {
			offset = SECONDS_PER_DAY;
			shifted = sec + offset;
		}
		previous = shifted;
		return shifted;
	};
	return stops.map((stop) => {
		const arriveSec = shift(stop.arriveSec);
		const departSec = shift(stop.departSec);
		return { ...stop, arriveSec, departSec };
	});
}
