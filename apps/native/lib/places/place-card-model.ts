import type { Leg } from "@Betro/commute/plan";

import type { MessageKey, MessageParams } from "../i18n/translate";
import type { LineBadgeInput } from "../transit/line-badge-model";
import type { BusMetaMap, Place } from "./places";
import { placeNameOf } from "./plan-headers";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface PlaceCardLeg {
	badge: LineBadgeInput;
	from: string;
	to: string;
}

export interface PlaceCardModel {
	/** "대안 2개", 없으면 null */
	alternatives: string | null;
	/** 기본 경로의 구간 */
	legs: PlaceCardLeg[];
	notSynced: boolean;
	/** "평일 08:10 출발" */
	schedule: string;
	title: string;
}

const MINUTES_PER_HOUR = 60;
const TIME_DIGITS = 2;
const DAYS_PER_WEEK = 7;

/** `days`의 값은 0 일요일 ~ 6 토요일이다. */
export const DAY_KEYS = [
	"places.day.sun",
	"places.day.mon",
	"places.day.tue",
	"places.day.wed",
	"places.day.thu",
	"places.day.fri",
	"places.day.sat",
] as const satisfies readonly MessageKey[];

/** 월요일부터 일요일까지 읽는 순서 */
const MONDAY_FIRST_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
const WEEKEND: readonly number[] = [0, 6];

function sameDays(days: readonly number[], expected: readonly number[]) {
	return (
		days.length === expected.length &&
		expected.every((day) => days.includes(day))
	);
}

/** "평일", "주말", "매일", 그 밖은 "월·수·금"처럼 월요일부터. */
export function daysLabel(days: number[], t: Translate): string {
	const unique = [...new Set(days)];
	if (unique.length === DAYS_PER_WEEK) {
		return t("places.daysEvery");
	}
	if (sameDays(unique, WEEKDAYS)) {
		return t("places.daysWeekdays");
	}
	if (sameDays(unique, WEEKEND)) {
		return t("places.daysWeekend");
	}
	return MONDAY_FIRST_ORDER.filter((day) => unique.includes(day))
		.map((day) => t(DAY_KEYS[day] ?? "places.day.mon"))
		.join(t("places.dayJoiner"));
}

/** 24시간 `HH:MM`. 예: 490 → "08:10" */
export function timeLabel(leaveMinute: number): string {
	const hours = Math.floor(leaveMinute / MINUTES_PER_HOUR);
	const minutes = leaveMinute % MINUTES_PER_HOUR;
	return `${String(hours).padStart(TIME_DIGITS, "0")}:${String(minutes).padStart(TIME_DIGITS, "0")}`;
}

/** "평일 08:10 출발", "월·수·금 00:05 출발" */
export function scheduleLabel(
	days: number[],
	leaveMinute: number,
	t: Translate
): string {
	return t("places.schedule", {
		days: daysLabel(days, t),
		time: timeLabel(leaveMinute),
	});
}

/**
 * 저장된 구간에는 버스 종류(routeType)와 지역이 없어서 기기에 둔 `busMeta`에서 찾는다. 맵에 없는 버스
 * (맵이 생기기 전에 저장한 장소, 서버에서 가져온 장소)는 `routeType: ""`로 두어 기본 색으로 그리고,
 * 지역은 서울로 둔다(`LineBadgeInput`이 요구하는 값).
 */
export function badgeOf(leg: Leg, busMeta: BusMetaMap): LineBadgeInput {
	if (leg.mode === "subway") {
		return { line: leg.line, mode: "subway", name: leg.lineName };
	}
	const meta = busMeta[leg.line];
	return {
		mode: "bus",
		name: leg.lineName,
		region: meta?.region ?? "seoul",
		routeType: meta?.routeType ?? "",
	};
}

export function placeCardModel(place: Place, t: Translate): PlaceCardModel {
	const { routes, schedule } = place.plan;
	const main = routes.find((route) => route.rank === 0);
	const alternativeCount = routes.filter((route) => route.rank !== 0).length;
	return {
		alternatives:
			alternativeCount === 0
				? null
				: t("places.alternatives", { n: alternativeCount }),
		legs: (main?.legs ?? []).map((leg) => ({
			badge: badgeOf(leg, place.busMeta),
			from: leg.board.name,
			to: leg.alight.name,
		})),
		notSynced: place.sync === "pending",
		schedule: scheduleLabel(schedule.days, schedule.leaveMinute, t),
		title: placeNameOf(place, t),
	};
}

/** 카드 아래 줄. "평일 08:10 출발", 대안이 있으면 "평일 08:10 출발 · 대안 2개" */
export function placeCardSummary(
	model: Pick<PlaceCardModel, "alternatives" | "schedule">,
	t: Translate
): string {
	if (model.alternatives === null) {
		return model.schedule;
	}
	return t("places.summaryWithAlternatives", {
		alternatives: model.alternatives,
		schedule: model.schedule,
	});
}
