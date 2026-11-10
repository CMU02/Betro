import type { StationRow } from "@Betro/commute/sources/seoul-subway";
import type { HistoryLineCounts } from "@Betro/realtime/history";
import type { MetricsSource, SourceProgress } from "@Betro/realtime/metrics";
import { operatingWindow } from "@Betro/realtime/metrics";
import type { CollectorConfig } from "@Betro/realtime/schedule";
import { kstParts } from "@Betro/realtime/time";
import type { PartCounters } from "./history-writer";

const DAY_MS = 86_400_000;
const CORE_STATE_VERSION = 1;

/** `StateStore` 키. */
export const STATE_KEYS = {
	alerts: "alerts",
	boards: "boards",
	budget: "budget",
	core: "core",
	latest: "latest",
	schedule: "schedule",
} as const;

/** 한 역의 최근 ALL 행. */
export interface StationRowsEntry {
	/** 행을 받은 시각(ALL 응답을 받은 시각). */
	fetchedAt: number;
	rows: StationRow[];
}

/**
 * 출퇴근 세션이 보는 역의 도착판(`STATE_KEYS.boards`). DO가 잠들어도 남게 저장한다.
 * `watch`는 역 → 등록 만료 시각, `stations`는 역 → 마지막으로 받은 행.
 */
export interface StationBoardsSaved {
	stations: Record<string, StationRowsEntry>;
	watch: Record<string, number>;
}

export const emptyStationBoards = (): StationBoardsSaved => ({
	stations: {},
	watch: {},
});

/** 그날(KST) 소스를 멈춘 이유. 다음 KST 날 다시 시도한다. */
export type StopReason = "auth" | "quota-exhausted";

/** `CollectorCore`가 저장하는 나머지 값(`STATE_KEYS.core`). JSON 그대로. */
export interface CoreSaved {
	/** 소스별 마지막 401(auth) 시각. 알림 판단 입력. */
	authFailedAt: Partial<Record<MetricsSource, number>>;
	/** 소스별 최신 상태를 마지막으로 바꾼 호출 시각. 스냅샷 `generatedAt`(ETag를 고정). */
	changedAt: Partial<Record<MetricsSource, number>>;
	/** 이력 시간 파일별로 버퍼에 넣은 줄 수와 R2에 쓴 줄 수(오늘·어제). 예전 저장값에는 없다. */
	historyLines?: HistoryLineCounts;
	/** `sources[*].errorsToday`가 속한 KST 날짜. */
	kstDay: string;
	lastPrunedAt: number | null;
	/** 마지막으로 일일 보고서를 쓴 운행일. */
	lastReportDate: string;
	/** 이력 시간 파일별 다음 조각 번호. */
	parts: PartCounters;
	/** 원본 스트림별 직전 응답 본문 해시. 재시작 때 비운다(본문이 버퍼와 함께 사라질 수 있으므로). */
	rawHashes: Record<string, string>;
	/**
	 * 운행 종료(headerCd 8)로 쉬는 버스 노선 → 마지막으로 운행 종료를 받은 시각.
	 * 지금 운행 시간 안에 받은 것만 "쉬는 중"으로 본다.
	 */
	restingRoutes: Record<string, number>;
	sources: Record<MetricsSource, SourceProgress>;
	stopped: Partial<
		Record<MetricsSource, { at: number; day: string; reason: StopReason }>
	>;
	version: typeof CORE_STATE_VERSION;
}

const emptyProgress = (): SourceProgress => ({
	errorsToday: {},
	lastSourceAt: null,
	lastSuccessAt: null,
});

/**
 * 처음 깨어난 수집기의 값. 이미 끝난 운행일의 보고서는 쓰지 않는다
 * (지켜보지 않은 날을 통째로 "멈춤"으로 남기지 않게).
 */
export function initialCoreState(
	now: number,
	config: CollectorConfig
): CoreSaved {
	return {
		authFailedAt: {},
		changedAt: {},
		kstDay: kstParts(now).date,
		lastPrunedAt: null,
		lastReportDate: latestEndedOperatingDate(now, config),
		parts: {},
		rawHashes: {},
		restingRoutes: {},
		sources: { bus: emptyProgress(), subway: emptyProgress() },
		stopped: {},
		version: CORE_STATE_VERSION,
	};
}

export function restoreCoreState(
	saved: CoreSaved | undefined,
	now: number,
	config: CollectorConfig
): CoreSaved {
	if (saved?.version !== CORE_STATE_VERSION) {
		return initialCoreState(now, config);
	}
	return saved;
}

/** 지금 운행일 후보: 오늘·어제·그제(KST) 날짜, 최근 것부터. */
function candidateDates(now: number): string[] {
	return [0, 1, 2].map((days) => kstParts(now - days * DAY_MS).date);
}

/** 운행 시간이 이미 끝난 운행일 중 가장 최근 것(`YYYY-MM-DD`). */
export function latestEndedOperatingDate(
	now: number,
	config: CollectorConfig
): string {
	for (const date of candidateDates(now)) {
		if (operatingWindow(date, config).to <= now) {
			return date;
		}
	}
	// 운행 시간이 24시간을 넘지 않으므로 그제 운행일은 늘 끝나 있다.
	return candidateDates(now)[2] as string;
}

/** `now`가 든 운행 시간. 운행 시간 밖이면 null. */
export function currentOperatingWindow(
	now: number,
	config: CollectorConfig
): { from: number; to: number } | null {
	for (const date of candidateDates(now)) {
		const window = operatingWindow(date, config);
		if (window.from <= now && now < window.to) {
			return window;
		}
	}
	return null;
}

/** `now`가 든 운행 시간의 끝. 운행 시간 밖이면 null. */
export function currentOperatingEnd(
	now: number,
	config: CollectorConfig
): number | null {
	return currentOperatingWindow(now, config)?.to ?? null;
}

/** 운행일 `YYYY-MM-DD`의 전날. */
export function previousOperatingDate(
	date: string,
	config: CollectorConfig
): string {
	return kstParts(operatingWindow(date, config).from - DAY_MS).date;
}
