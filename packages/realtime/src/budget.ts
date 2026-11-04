import type { CollectorConfig } from "./schedule";
import { kstParts } from "./time";

/** 예산을 따로 세는 소스. 재시도도 1건으로 센다. */
export type BudgetKind = "subway" | "bus";

/** KST 하루(00:00~24:00) 단위 호출 수. `kstDay`는 `YYYY-MM-DD`. */
export interface BudgetState {
	kstDay: string;
	used: { subway: number; bus: number };
}

export function emptyBudget(now: number): BudgetState {
	return { kstDay: kstParts(now).date, used: { bus: 0, subway: 0 } };
}

/** `now`의 KST 날짜로 맞춘 상태. 날이 바뀌었으면 0부터. */
function forDay(state: BudgetState, now: number): BudgetState {
	return state.kstDay === kstParts(now).date ? state : emptyBudget(now);
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
		used: { ...today.used, [kind]: today.used[kind] + count },
	};
}

export function remaining(
	state: BudgetState,
	kind: BudgetKind,
	config: CollectorConfig,
	now: number
): number {
	const today = forDay(state, now);
	return Math.max(0, config.dailyBudget[kind] - today.used[kind]);
}
