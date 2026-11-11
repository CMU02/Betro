import type { Leg, Route } from "@Betro/commute/plan";

import type { MessageKey, MessageParams } from "../i18n/translate";
import { badgeOf, daysLabel, timeLabel } from "../places/place-card-model";
import type { BusMetaMap, Place } from "../places/places";
import { headerOf, placeNameOf } from "../places/plan-headers";
import type { LineBadgeInput } from "../transit/line-badge-model";
import type { ContentState } from "./content-state";
import {
	formatClock,
	type LockScreenModel,
	lockScreenModel,
} from "./lock-screen-model";
import type { ActiveSessionView, SessionRouteView } from "./session-client";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export type GuideTag = "live" | "estimated";

/** "같은 곳으로 가는 다른 방법"의 한 줄(Figma `RouteCompareRow` 93:2367). */
export interface GuideCompareRow {
	/** "08:41 도착", 예상이 없으면 null */
	arrival: string | null;
	badge: LineBadgeInput[];
	/** "6분 빨리", "3분 늦게". 어느 한쪽의 예상이 없거나 차이가 1분 미만이면 null */
	diff: string | null;
	rank: number;
	/** "천호 → 잠실 → 강남" */
	stops: string;
	tag: GuideTag;
	tagLabel: string;
	/** "360번", "8호선 · 2호선" */
	title: string;
}

/** 세션이 없을 때의 등록한 경로 한 줄. */
export interface GuideRouteRow {
	badge: LineBadgeInput[];
	/** "기본 경로 · 341번 → 2호선", "대안 · 360번" */
	label: string;
	rank: number;
	/** "천호역.현대백화점 → 강남역" */
	summary: string;
}

export interface ActiveGuide {
	card: LockScreenModel;
	/** 지금 구간의 배지 */
	cardBadge: LineBadgeInput;
	kind: "active";
	/** `card.nextLegs`와 같은 순서·길이의 배지 */
	nextLegBadges: LineBadgeInput[];
	others: GuideCompareRow[];
	/** "안내 종료"가 보낼 세션 */
	sessionId: string;
}

export interface IdleGuide {
	kind: "idle";
	/** "평일 08:10에 나가요 · 08:00부터 잠금화면에 떠요". 서버에 올라가기 전이면 "… · 아직 서버에 저장되지 않았어요" */
	next: string;
	routes: GuideRouteRow[];
}

export type GuideModel = ActiveGuide | IdleGuide;

export interface GuideInput {
	/** epoch 초(푸시 값과 같은 단위) */
	now: number;
	place: Place;
	session: ActiveSessionView | null;
	t: Translate;
	timezone: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_DAY = 24 * 60;
/**
 * 17은 `card.actions`를 쓰지 않고 "안내 종료" 버튼을 따로 둔다. 플랫폼에 따라 달라지는 것은
 * `actions`뿐이라 어느 값을 넘겨도 화면에 보이는 글자는 같다.
 */
const CARD_PLATFORM = "ios";

function byRank(routes: Route[]): Route[] {
	return [...routes].sort((a, b) => a.rank - b.rank);
}

/** 각 구간의 승차 정류장 + 마지막 하차 정류장. 예: "천호 → 잠실 → 강남" */
function stopsOf(legs: Leg[], t: Translate): string {
	const last = legs.at(-1);
	if (last === undefined) {
		return "";
	}
	const names = [...legs.map((leg) => leg.board.name), last.alight.name];
	return names.reduce((from, to) => t("places.legArrow", { from, to }));
}

function lineNameOf(leg: Leg, t: Translate): string {
	return leg.mode === "bus"
		? t("commuteGuide.lineBus", { name: leg.lineName })
		: leg.lineName;
}

/** "341번 → 2호선" */
function linesArrow(legs: Leg[], t: Translate): string {
	const [first, ...rest] = legs.map((leg) => lineNameOf(leg, t));
	return rest.reduce(
		(from, to) => t("places.legArrow", { from, to }),
		first ?? ""
	);
}

function nextLine(place: Place, t: Translate): string {
	const { days, leadMinutes, leaveMinute } = place.plan.schedule;
	const show = leaveMinute - leadMinutes;
	const params = {
		days: daysLabel(days, t),
		leave: timeLabel(leaveMinute),
	};
	// 서버에 올라가기 전에는 잠금화면 예약이 없으니 "…부터 잠금화면에 떠요"라고 말하지 않는다.
	if (place.sync === "pending") {
		return t("commuteGuide.next.notSynced", params);
	}
	if (show < 0) {
		return t("commuteGuide.next.previousDay", {
			...params,
			show: timeLabel(show + MINUTES_PER_DAY),
		});
	}
	return t("commuteGuide.next.sameDay", { ...params, show: timeLabel(show) });
}

function idleGuide(place: Place, t: Translate): IdleGuide {
	return {
		kind: "idle",
		next: nextLine(place, t),
		routes: byRank(place.plan.routes).map((route) => ({
			badge: route.legs.map((leg) => badgeOf(leg, place.busMeta)),
			label: t(
				route.rank === 0
					? "commuteGuide.routeLabel.main"
					: "commuteGuide.routeLabel.alternative",
				{ lines: linesArrow(route.legs, t) }
			),
			rank: route.rank,
			summary: stopsOf(route.legs, t),
		})),
	};
}

/** 잠금화면 태그와 같은 규칙: 시각과 위치가 모두 실시간일 때만 "실시간". */
function tagOf(view: SessionRouteView | undefined): GuideTag {
	return view?.etaState === "live" && view.positionState === "live"
		? "live"
		: "estimated";
}

function diffLine(
	main: number | null,
	alternative: number | null,
	t: Translate
): string | null {
	if (main === null || alternative === null) {
		return null;
	}
	const gap = alternative - main;
	const minutes = Math.floor(Math.abs(gap) / SECONDS_PER_MINUTE);
	if (minutes < 1) {
		return null;
	}
	return t(gap < 0 ? "commuteGuide.diff.earlier" : "commuteGuide.diff.later", {
		m: minutes,
	});
}

function compareRow(
	route: Route,
	views: SessionRouteView[],
	mainEta: number | null,
	input: GuideInput
): GuideCompareRow {
	const { t, timezone } = input;
	const view = views.find((entry) => entry.rank === route.rank);
	const destination = view?.destinationEtaEpoch ?? null;
	const tag = tagOf(view);
	return {
		arrival:
			destination === null
				? null
				: t("commuteGuide.arrival", {
						time: formatClock(destination, timezone),
					}),
		badge: route.legs.map((leg) => badgeOf(leg, input.place.busMeta)),
		diff: diffLine(mainEta, destination, t),
		rank: route.rank,
		stops: stopsOf(route.legs, t),
		tag,
		tagLabel: t(`commute.lock.tag.${tag}`),
		title: route.legs
			.map((leg) => lineNameOf(leg, t))
			.join(t("commuteGuide.lineJoiner")),
	};
}

/** 푸시 값에는 노선 키가 없어서, 장소의 기본 경로에서 같은 구간을 찾아 배지를 만든다. */
function badgeAt(
	main: Route | undefined,
	busMeta: BusMetaMap,
	index: number,
	fallback: { lineName: string; mode: "bus" | "subway" }
): LineBadgeInput {
	const leg = main?.legs[index];
	if (
		leg !== undefined &&
		leg.mode === fallback.mode &&
		leg.lineName === fallback.lineName
	) {
		return badgeOf(leg, busMeta);
	}
	if (fallback.mode === "subway") {
		return { line: "", mode: "subway", name: fallback.lineName };
	}
	return {
		mode: "bus",
		name: fallback.lineName,
		region: "seoul",
		routeType: "",
	};
}

function cardOf(
	content: ContentState,
	input: Pick<GuideInput, "now" | "place" | "t" | "timezone">
): LockScreenModel {
	return lockScreenModel(content, {
		header: headerOf(input.place, input.t),
		now: input.now,
		platform: CARD_PLATFORM,
		t: input.t,
		timezone: input.timezone,
	});
}

function activeGuide(
	session: ActiveSessionView,
	input: GuideInput
): ActiveGuide {
	const { content, routes: views } = session;
	const routes = byRank(input.place.plan.routes);
	const main = routes.find((route) => route.rank === 0);
	const mainEta =
		views.find((view) => view.rank === 0)?.destinationEtaEpoch ?? null;
	const card = cardOf(content, input);
	return {
		card,
		cardBadge: badgeAt(main, input.place.busMeta, content.legIndex, content),
		kind: "active",
		nextLegBadges: card.nextLegs.map((leg, offset) =>
			badgeAt(main, input.place.busMeta, content.legIndex + 1 + offset, leg)
		),
		others: routes
			.filter((route) => route.rank !== 0)
			.map((route) => compareRow(route, views, mainEta, input)),
		sessionId: session.sessionId,
	};
}

/**
 * 17 출퇴근 안내에 보이는 값. 이 장소의 세션이 돌고 있으면 잠금화면과 같은 카드와 등록한 대안의 비교,
 * 아니면 다음 안내 시각과 등록한 경로 목록이다.
 */
export function guideModel(input: GuideInput): GuideModel {
	const { place, session, t } = input;
	if (session === null || session.planId !== place.plan.planId) {
		return idleGuide(place, t);
	}
	return activeGuide(session, input);
}

/** 상단 막대. 예: "회사 가는 길" */
export function guideTitle(place: Place, t: Translate): string {
	return t("commuteGuide.title", { name: placeNameOf(place, t) });
}

/** 15 맨 위 진행 중 세션 띠(Figma `SessionStrip` 93:2382). */
export interface SessionStripModel {
	badge: LineBadgeInput;
	/** "출근 · 회사까지 안내 중" */
	header: string;
	placeId: string;
	/** "2정거장 전 · 3분" */
	status: string;
	tag: LockScreenModel["tag"];
	tagLabel: string;
}

/** 세션이 없거나 기기가 모르는 예약의 세션이면 null. */
export function sessionStripModel(input: {
	now: number;
	places: Place[];
	session: ActiveSessionView | null;
	t: Translate;
	timezone: string;
}): SessionStripModel | null {
	const { places, session, t } = input;
	if (session === null) {
		return null;
	}
	const place = places.find((entry) => entry.plan.planId === session.planId);
	if (place === undefined) {
		return null;
	}
	const { content } = session;
	const card = cardOf(content, { ...input, place });
	const main = place.plan.routes.find((route) => route.rank === 0);
	return {
		badge: badgeAt(main, place.busMeta, content.legIndex, content),
		header: t("commuteGuide.strip.header", { header: card.header }),
		placeId: place.id,
		status:
			card.minutes === null
				? card.status
				: t("commuteGuide.strip.status", {
						minutes: card.minutes,
						status: card.status,
					}),
		tag: card.tag,
		tagLabel: card.tagLabel,
	};
}
