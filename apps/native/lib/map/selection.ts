import type { Leg } from "@Betro/commute/plan";
import type { ActiveSessionView } from "../commute/session-client";
import { t } from "../i18n/t";
import type { Place } from "../places/places";
import { placeNameOf } from "../places/plan-headers";

/** 지도에서 보고 있는 장소와 그 장소의 경로 rank. */
export interface MapSelection {
	placeId: string;
	rank: number;
}

export interface PlaceChip {
	id: string;
	label: string;
	selected: boolean;
}

export interface RouteOption {
	lineNames: string[];
	rank: number;
	selected: boolean;
}

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const BASE_RANK = 0;

/**
 * 사용자가 직접 고른 선택. 앱을 다시 열 때까지만 유지하고 저장하지 않는다(지도 설계 3장).
 * 모듈 수준 상태라 지도 탭이 언마운트돼도 남는다.
 */
let userSelection: MapSelection | null = null;

export function getUserSelection(): MapSelection | null {
	return userSelection;
}

export function setUserSelection(selection: MapSelection): void {
	userSelection = selection;
}

export function resetUserSelection(): void {
	userSelection = null;
}

/** 그 시각의 timezone 기준 하루 중 분(0~1439). */
function minuteOfDay(epochMs: number, timezone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		hourCycle: "h23",
		minute: "numeric",
		timeZone: timezone,
	}).formatToParts(epochMs);
	const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
	const minute = Number(
		parts.find((part) => part.type === "minute")?.value ?? 0
	);
	return (hour % 24) * MINUTES_PER_HOUR + minute;
}

/** 하루를 원으로 본 두 분 사이의 거리. */
function circularDistance(a: number, b: number): number {
	const diff = Math.abs(a - b) % MINUTES_PER_DAY;
	return Math.min(diff, MINUTES_PER_DAY - diff);
}

function legMatches(
	leg: Leg | undefined,
	mode: string,
	lineName: string
): boolean {
	return leg !== undefined && leg.mode === mode && leg.lineName === lineName;
}

/**
 * 세션 content가 따르는 경로 rank. content의 지금 구간(노선 이름과 종류)이 맞는 경로 중 앞선 것이다.
 * 알 수 없으면 0이다.
 */
function sessionRank(place: Place, session: ActiveSessionView): number {
	const { legIndex, lineName, mode } = session.content;
	const route = place.plan.routes
		.toSorted((a, b) => a.rank - b.rank)
		.find((candidate) => legMatches(candidate.legs[legIndex], mode, lineName));
	return route?.rank ?? BASE_RANK;
}

function closestToLeaveTime(
	places: readonly Place[],
	nowEpochMs: number
): Place | null {
	let best: Place | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const place of places) {
		const { leaveMinute, timezone } = place.plan.schedule;
		const distance = circularDistance(
			minuteOfDay(nowEpochMs, timezone),
			leaveMinute
		);
		if (distance < bestDistance) {
			best = place;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * 앱을 열었을 때 처음 선택. 세션이 있으면 그 장소와 경로, 없으면 지금 시각에 출발 시각이 가장 가까운
 * 장소의 기본 경로다(지도 설계 3장). 장소가 없으면 null이다.
 */
export function initialSelection(
	places: readonly Place[],
	session: ActiveSessionView | null,
	nowEpochMs: number
): MapSelection | null {
	if (places.length === 0) {
		return null;
	}
	const sessionPlace =
		session === null
			? undefined
			: places.find((place) => place.plan.planId === session.planId);
	if (session !== null && sessionPlace !== undefined) {
		return {
			placeId: sessionPlace.id,
			rank: sessionRank(sessionPlace, session),
		};
	}
	const closest = closestToLeaveTime(places, nowEpochMs);
	return closest === null ? null : { placeId: closest.id, rank: BASE_RANK };
}

/**
 * 사용자가 고른 선택이 아직 있는 장소와 경로를 가리키면 그대로, 아니면 null이다.
 * 장소나 대안 경로를 지운 뒤 빈 지도를 보이지 않게 한다.
 */
export function validSelection(
	places: readonly Place[],
	selection: MapSelection | null
): MapSelection | null {
	if (selection === null) {
		return null;
	}
	const place = places.find((candidate) => candidate.id === selection.placeId);
	const hasRoute =
		place?.plan.routes.some((route) => route.rank === selection.rank) ?? false;
	return hasRoute ? selection : null;
}

/** 장소 칩. 이름은 카드와 같이 종류 이름(집·회사·학교)이나 기타 장소의 이름이다. */
export function placeChips(
	places: readonly Place[],
	selection: MapSelection | null
): PlaceChip[] {
	return places.map((place) => ({
		id: place.id,
		label: placeNameOf(place, t),
		selected: selection?.placeId === place.id,
	}));
}

/** 칩 재탭 목록. 기본 경로와 대안 경로의 노선 이름을 rank 순서로 담는다. */
export function routeOptions(
	place: Place,
	selection: MapSelection
): RouteOption[] {
	return place.plan.routes
		.toSorted((a, b) => a.rank - b.rank)
		.map((route) => ({
			lineNames: route.legs.map((leg) => leg.lineName),
			rank: route.rank,
			selected: selection.placeId === place.id && selection.rank === route.rank,
		}));
}
