import type { Leg } from "@Betro/commute/plan";

import type { MessageKey, MessageParams } from "../i18n/translate";
import type { LineBadgeInput } from "../transit/line-badge-model";
import { badgeOf } from "./place-card-model";
import type { BusMeta, BusMetaMap, Place, PlaceKind } from "./places";
import { placeNameOf } from "./plan-headers";
import type { SaveResult } from "./plan-sync";
import {
	addLeg,
	buildPlan,
	type DraftIssue,
	emptyRoute,
	type RouteDraft,
	removeLeg,
	setWalk,
} from "./route-draft";
import type { SetupDraft } from "./setup-draft";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export type PlaceFromDraftResult =
	| { ok: true; place: Place }
	| { ok: false; issues: DraftIssue[] };

/** 문구를 보일 구역. `save`는 저장 버튼 위다. */
export type FormSection = "name" | "routes" | "schedule" | "save";

export type SaveOutcome =
	| { kind: "close" }
	| { kind: "error"; message: MessageKey };

export type RouteRow =
	| { kind: "walk"; label: string; minutes: number; walkIndex: number }
	| {
			badge: LineBadgeInput;
			detail: string;
			kind: "ride";
			legIndex: number;
			title: string;
	  };

const MAX_LEGS = 4;
const MAX_ROUTES = 4;
const MINUTES_PER_HOUR = 60;
const DIGITS_ONLY = /^\d+$/;

const ISSUE_NOTICES: Record<
	DraftIssue,
	{ key: MessageKey; section: FormSection }
> = {
	invalid: { key: "placeSetup.issue.invalid", section: "save" },
	"name-required": { key: "placeSetup.issue.nameRequired", section: "name" },
	"no-day": { key: "placeSetup.issue.noDay", section: "schedule" },
	"no-leg": { key: "placeSetup.issue.noLeg", section: "routes" },
	"too-many-legs": { key: "placeSetup.issue.tooManyLegs", section: "routes" },
	"too-many-routes": {
		key: "placeSetup.issue.tooManyRoutes",
		section: "routes",
	},
};

/** 경로에 남은 버스 노선의 `busMeta`만. 지운 구간의 노선은 장소에 남기지 않는다. */
function busMetaInRoutes(
	busMeta: BusMetaMap,
	routes: RouteDraft[]
): BusMetaMap {
	const kept: BusMetaMap = {};
	for (const route of routes) {
		for (const leg of route.legs) {
			const meta = busMeta[leg.line];
			if (leg.mode === "bus" && meta !== undefined) {
				kept[leg.line] = meta;
			}
		}
	}
	return kept;
}

/**
 * 임시 값을 저장할 장소로 만든다. 기타 장소는 이름이 있어야 한다(`name-required`).
 * 종류 이름이 따로 있는 장소(집, 회사, 학교)는 이름을 비워 둔다. `sync`는 `savePlace`가 다시 정한다.
 */
export function placeFromDraft(
	draft: SetupDraft,
	now: number
): PlaceFromDraftResult {
	const name = draft.kind === "other" ? draft.name.trim() : "";
	const built = buildPlan({
		days: draft.days,
		includeHolidays: draft.includeHolidays,
		leaveMinute: draft.leaveMinute,
		planId: draft.planId,
		routes: draft.routes,
	});
	const nameMissing = draft.kind === "other" && name === "";
	if (!built.ok) {
		return {
			issues: nameMissing ? ["name-required", ...built.issues] : built.issues,
			ok: false,
		};
	}
	if (nameMissing) {
		return { issues: ["name-required"], ok: false };
	}
	return {
		ok: true,
		place: {
			busMeta: busMetaInRoutes(draft.busMeta, draft.routes),
			id: draft.placeId,
			kind: draft.kind,
			name,
			plan: built.plan,
			sync: "pending",
			updatedAt: now,
		},
	};
}

/** 사유별 문구를 구역마다 하나씩. 한 구역에 사유가 여럿이면 앞의 것을 보인다. */
export function issueNotices(
	issues: DraftIssue[]
): Partial<Record<FormSection, MessageKey>> {
	const notices: Partial<Record<FormSection, MessageKey>> = {};
	for (const issue of issues) {
		const { key, section } = ISSUE_NOTICES[issue];
		notices[section] ??= key;
	}
	return notices;
}

/** `saved`와 `pending`은 15로 돌아가고(15 카드에 표시가 보인다), 나머지는 화면에 남아 문구를 보인다. */
export function saveOutcome(result: SaveResult): SaveOutcome {
	if (result === "saved" || result === "pending") {
		return { kind: "close" };
	}
	if (result === "limit") {
		return { kind: "error", message: "placeSetup.save.limit" };
	}
	return { kind: "error", message: "placeSetup.save.rejected" };
}

/** 요일 하나를 켜거나 끈다. 0 일요일 ~ 6 토요일, 오름차순. */
export function toggleDay(days: number[], day: number): number[] {
	const next = days.includes(day)
		? days.filter((entry) => entry !== day)
		: [...days, day];
	return [...new Set(next)].sort((a, b) => a - b);
}

/** 시각 고르기에 넘길 날짜. 기기 시계의 시·분만 쓴다(시간대 계산 없음). */
export function dateFromMinute(minute: number, base: Date): Date {
	const date = new Date(base.getTime());
	date.setHours(
		Math.floor(minute / MINUTES_PER_HOUR),
		minute % MINUTES_PER_HOUR,
		0,
		0
	);
	return date;
}

/** 시각 고르기가 준 날짜의 시·분을 하루 안의 분으로. */
export function minuteFromDate(date: Date): number {
	return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
}

/** 마지막 도보 줄의 목적지. 이름 없는 기타 장소는 "목적지"다. */
export function destinationName(
	draft: Pick<SetupDraft, "kind" | "name">,
	t: Translate
): string {
	if (draft.kind === "other" && draft.name.trim() === "") {
		return t("placeSetup.destination");
	}
	return placeNameOf(draft, t);
}

/** 화면 제목. 새 장소는 "장소 추가", 고칠 때는 "회사 설정". */
export function setupTitle(
	mode: "new" | "edit",
	draft: { kind: PlaceKind; name: string },
	t: Translate
): string {
	if (mode === "new") {
		return t("placeSetup.title.new");
	}
	return t("placeSetup.title.edit", { name: placeNameOf(draft, t) });
}

function rideDetail(leg: Leg, t: Translate): string {
	if (leg.mode === "subway") {
		return leg.lineName;
	}
	return t("placeSetup.leg.busDetail", {
		line: leg.lineName,
		n: leg.alight.seq - leg.board.seq,
	});
}

/**
 * 경로 카드의 줄. 도보 → 탑승 → 도보 … 순서다. 도보 줄은 다음 승차 정류장(마지막은 목적지)까지다.
 * 구간이 없으면 빈 목록이다.
 */
export function routeRows(
	route: RouteDraft,
	busMeta: BusMetaMap,
	destination: string,
	t: Translate
): RouteRow[] {
	const rows: RouteRow[] = [];
	route.legs.forEach((leg, legIndex) => {
		rows.push({
			kind: "walk",
			label: t("placeSetup.leg.walk", { stop: leg.board.name }),
			minutes: route.walkMinutes[legIndex] ?? 0,
			walkIndex: legIndex,
		});
		rows.push({
			badge: badgeOf(leg, busMeta),
			detail: rideDetail(leg, t),
			kind: "ride",
			legIndex,
			title: t("places.legArrow", {
				from: leg.board.name,
				to: leg.alight.name,
			}),
		});
	});
	if (route.legs.length > 0) {
		const walkIndex = route.legs.length;
		rows.push({
			kind: "walk",
			label: t("placeSetup.leg.walk", { stop: destination }),
			minutes: route.walkMinutes[walkIndex] ?? 0,
			walkIndex,
		});
	}
	return rows;
}

/** 구간 하나를 지운다. 대안이 비면 그 대안을 빼고, 기본 경로는 비어도 남긴다. */
export function removeLegAt(
	routes: RouteDraft[],
	routeIndex: number,
	legIndex: number
): RouteDraft[] {
	const route = routes[routeIndex];
	if (route === undefined) {
		return routes;
	}
	const next = removeLeg(route, legIndex);
	if (routeIndex > 0 && next.legs.length === 0) {
		return routes.filter((_, i) => i !== routeIndex);
	}
	return routes.map((entry, i) => (i === routeIndex ? next : entry));
}

/** 대안 하나를 뺀다. 기본 경로(0)는 빼지 않는다. */
export function removeRoute(
	routes: RouteDraft[],
	routeIndex: number
): RouteDraft[] {
	if (routeIndex <= 0 || routeIndex >= routes.length) {
		return routes;
	}
	return routes.filter((_, i) => i !== routeIndex);
}

/** 한 경로의 도보 시간 하나를 고친다(0~60분). */
export function setWalkAt(
	routes: RouteDraft[],
	routeIndex: number,
	walkIndex: number,
	minutes: number
): RouteDraft[] {
	return routes.map((route, i) =>
		i === routeIndex ? setWalk(route, walkIndex, minutes) : route
	);
}

/** 고른 구간을 더한 경로. `routeIndex`가 경로 수와 같으면 새 대안이다. */
export function routeWithLeg(
	routes: RouteDraft[],
	routeIndex: number,
	leg: Leg
): RouteDraft {
	return addLeg(routes[routeIndex] ?? emptyRoute(), leg);
}

/**
 * 구간 고르기가 고른 구간을 넣은 임시 값. `routeIndex`가 경로 수와 같으면 새 대안으로 더하고, 그보다 크거나
 * 음수면 그대로 돌려준다. 버스 구간이면 고른 노선의 종류·지역(`busMeta`)을 `leg.line` 키로 같이 둔다.
 */
export function draftWithLeg(
	draft: SetupDraft,
	routeIndex: number,
	leg: Leg,
	busMeta?: BusMeta
): SetupDraft {
	const count = draft.routes.length;
	if (!Number.isInteger(routeIndex) || routeIndex < 0 || routeIndex > count) {
		return draft;
	}
	const route = routeWithLeg(draft.routes, routeIndex, leg);
	const routes =
		routeIndex === count
			? [...draft.routes, route]
			: draft.routes.map((entry, i) => (i === routeIndex ? route : entry));
	return {
		...draft,
		busMeta:
			busMeta === undefined
				? draft.busMeta
				: { ...draft.busMeta, [leg.line]: busMeta },
		routes,
	};
}

export function canAddLeg(route: RouteDraft): boolean {
	return route.legs.length < MAX_LEGS;
}

/** 기본 경로 1개 + 대안 3개까지. */
export function canAddAlternative(routes: RouteDraft[]): boolean {
	return routes.length < MAX_ROUTES;
}

/**
 * 구간 고르기 화면의 `route` 값. 있는 경로이거나 새 대안 자리(경로 수와 같음)여야 하고,
 * 경로는 4개를 넘지 않는다. 아니면 null.
 */
export function parseRouteIndex(
	raw: string | string[] | undefined,
	routeCount: number
): number | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (value === undefined || !DIGITS_ONLY.test(value)) {
		return null;
	}
	const index = Number(value);
	if (index > routeCount || index >= MAX_ROUTES) {
		return null;
	}
	return index;
}
