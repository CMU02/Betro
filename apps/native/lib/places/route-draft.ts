import { DEFAULT_LEAD_MINUTES, DEFAULT_TIMEZONE } from "@Betro/commute/config";
import {
	type CommutePlan,
	type Leg,
	parsePlan,
	type Route,
} from "@Betro/commute/plan";

/** 고르는 중인 경로 하나. 구간이 있으면 `walkMinutes` 길이는 구간 수 + 1이다. */
export interface RouteDraft {
	legs: Leg[];
	walkMinutes: number[];
}

export type DraftIssue =
	| "no-leg"
	| "too-many-legs"
	| "too-many-routes"
	| "no-day"
	| "name-required"
	| "invalid";

export interface BuildPlanInput {
	days: number[];
	includeHolidays: boolean;
	leaveMinute: number;
	planId: string;
	/** `routes[0]`이 기본 경로이고, 나머지가 대안이다. */
	routes: RouteDraft[];
}

export type BuildPlanResult =
	| { ok: true; plan: CommutePlan }
	| { ok: false; issues: DraftIssue[] };

/** 출발지 → 첫 승차, 마지막 하차 → 목적지 도보 기본값(분) */
const DEFAULT_END_WALK = 5;
/** 환승 사이 도보 기본값(분) */
const DEFAULT_TRANSFER_WALK = 3;
const MIN_WALK = 0;
const MAX_WALK = 60;
const MAX_LEGS = 4;
const MAX_ALTERNATIVES = 3;

export function emptyRoute(): RouteDraft {
	return { legs: [], walkMinutes: [] };
}

/** 구간을 끝에 더한다. 첫 도보와 마지막 도보는 남기고, 새 환승 도보에 기본값을 넣는다. */
export function addLeg(route: RouteDraft, leg: Leg): RouteDraft {
	if (route.legs.length === 0) {
		return { legs: [leg], walkMinutes: [DEFAULT_END_WALK, DEFAULT_END_WALK] };
	}
	const last = route.walkMinutes.at(-1) ?? DEFAULT_END_WALK;
	return {
		legs: [...route.legs, leg],
		walkMinutes: [
			...route.walkMinutes.slice(0, -1),
			DEFAULT_TRANSFER_WALK,
			last,
		],
	};
}

/**
 * 구간 하나를 뺀다. 빠진 구간 양옆의 도보 둘 가운데 환승 도보를 버려
 * 출발지 도보와 목적지 도보는 사용자가 고친 값을 남긴다.
 */
export function removeLeg(route: RouteDraft, index: number): RouteDraft {
	const count = route.legs.length;
	if (!Number.isInteger(index) || index < 0 || index >= count) {
		return route;
	}
	if (count === 1) {
		return emptyRoute();
	}
	const dropWalk = index === count - 1 ? index : index + 1;
	return {
		legs: route.legs.filter((_, i) => i !== index),
		walkMinutes: route.walkMinutes.filter((_, i) => i !== dropWalk),
	};
}

/** 도보 시간 하나를 고친다. 0~60분 정수로 맞춘다. */
export function setWalk(
	route: RouteDraft,
	index: number,
	minutes: number
): RouteDraft {
	const isKnownIndex =
		Number.isInteger(index) && index >= 0 && index < route.walkMinutes.length;
	if (!(isKnownIndex && Number.isFinite(minutes))) {
		return route;
	}
	const clamped = Math.min(MAX_WALK, Math.max(MIN_WALK, Math.round(minutes)));
	return {
		...route,
		walkMinutes: route.walkMinutes.map((value, i) =>
			i === index ? clamped : value
		),
	};
}

function issuesOf(
	primary: RouteDraft | undefined,
	alternatives: RouteDraft[],
	days: number[]
): DraftIssue[] {
	const issues: DraftIssue[] = [];
	if (primary === undefined || primary.legs.length === 0) {
		issues.push("no-leg");
	}
	const routes =
		primary === undefined ? alternatives : [primary, ...alternatives];
	if (routes.some((route) => route.legs.length > MAX_LEGS)) {
		issues.push("too-many-legs");
	}
	if (alternatives.length > MAX_ALTERNATIVES) {
		issues.push("too-many-routes");
	}
	if (days.length === 0) {
		issues.push("no-day");
	}
	return issues;
}

/**
 * 고른 경로와 예약을 서버에 올릴 `CommutePlan`으로 만든다.
 * 구간이 없는 대안은 뺀다. 시간대와 미리 띄우는 시간은 `@Betro/commute/config`의 기본값이다.
 * 마지막에 서버와 같은 `parsePlan`을 통과시키고, 통과하지 못하면 `"invalid"`를 준다.
 */
export function buildPlan(input: BuildPlanInput): BuildPlanResult {
	const [primary, ...rest] = input.routes;
	const alternatives = rest.filter((route) => route.legs.length > 0);
	const issues = issuesOf(primary, alternatives, input.days);
	if (primary === undefined || issues.length > 0) {
		return { issues, ok: false };
	}
	const routes: Route[] = [primary, ...alternatives].map((route, rank) => ({
		legs: route.legs,
		rank,
		walkMinutes: route.walkMinutes,
	}));
	const parsed = parsePlan({
		enabled: true,
		planId: input.planId,
		routes,
		schedule: {
			days: [...new Set(input.days)].sort((a, b) => a - b),
			includeHolidays: input.includeHolidays,
			leadMinutes: DEFAULT_LEAD_MINUTES,
			leaveMinute: input.leaveMinute,
			timezone: DEFAULT_TIMEZONE,
		},
	});
	if (!parsed.ok) {
		return { issues: ["invalid"], ok: false };
	}
	return { ok: true, plan: parsed.plan };
}
