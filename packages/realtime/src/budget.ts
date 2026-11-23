import type { CollectorConfig } from "./schedule";
import { kstParts } from "./time";

/**
 * 예산을 따로 세는 소스. 재시도도 1건으로 센다. 지역 버스는 위치 오퍼레이션마다 따로 센다
 * (GBIS `getBusLocationListv2`, TAGO `getRouteAcctoBusLcList`, 5-B 설계 결정 1).
 */
export type BudgetKind = "subway" | "bus" | "gbis-position" | "tago-position";

/** 하루 예산 설정(`CollectorConfig.dailyBudget`)에서 각 소스의 키. */
const CONFIG_KEY = {
	bus: "bus",
	"gbis-position": "gbisPosition",
	subway: "subway",
	"tago-position": "tagoPosition",
} as const satisfies Record<BudgetKind, keyof CollectorConfig["dailyBudget"]>;

/**
 * KST 하루(00:00~24:00) 단위 호출 수. `kstDay`는 `YYYY-MM-DD`.
 * 지역 소스는 5-B 전에 저장한 값에 없을 수 있어 선택 필드다(없으면 0).
 */
export interface BudgetState {
	kstDay: string;
	used: { bus: number; subway: number } & Partial<
		Record<"gbis-position" | "tago-position", number>
	>;
}

export function emptyBudget(now: number): BudgetState {
	return {
		kstDay: kstParts(now).date,
		used: { bus: 0, "gbis-position": 0, subway: 0, "tago-position": 0 },
	};
}

/**
 * `now`의 KST 날짜로 맞춘 상태. 날이 바뀌었으면 0부터. 지역 소스가 없던 옛 저장값은
 * 그 소스를 0으로 채운다.
 */
function forDay(state: BudgetState, now: number): BudgetState {
	if (state.kstDay !== kstParts(now).date) {
		return emptyBudget(now);
	}
	return {
		kstDay: state.kstDay,
		used: { ...emptyBudget(now).used, ...state.used },
	};
}

export function consume(
	state: BudgetState,
	kind: BudgetKind,
	now: number,
	count = 1
): BudgetState {
	const today = forDay(state, now);
	return {
		kstDay: today.kstDay,
		used: { ...today.used, [kind]: (today.used[kind] ?? 0) + count },
	};
}

/** 그날(KST) 쓴 호출 수. 날이 바뀌었거나 옛 저장값에 없는 소스는 0. */
export function used(
	state: BudgetState,
	kind: BudgetKind,
	now: number
): number {
	return forDay(state, now).used[kind] ?? 0;
}

export function remaining(
	state: BudgetState,
	kind: BudgetKind,
	config: CollectorConfig,
	now: number
): number {
	return Math.max(
		0,
		config.dailyBudget[CONFIG_KEY[kind]] - used(state, kind, now)
	);
}
