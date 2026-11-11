import type { BusLeg, SubwayLeg } from "@Betro/commute/plan";
import type { LineRef, StopRef } from "@Betro/commute/refs";

import type { MessageKey, MessageParams } from "../i18n/translate";
import type {
	BusRouteMatch,
	BusStop,
	RefResult,
	SubwayBranch,
	SubwayLine,
} from "../ref/ref-client";
import type { LineBadgeInput } from "../transit/line-badge-model";
import type { BusMeta } from "./places";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface StopChoice {
	disabled: boolean;
	label: string;
	stop: BusStop;
	/** 같은 이름이 한 노선에 두 번 나올 때 구분하는 글자(방면, 없으면 정류장 번호). 아니면 null. */
	sub: string | null;
}

export interface StationChoice {
	disabled: boolean;
	name: string;
	stop: string;
}

export interface BranchChoices {
	branchKey: string;
	stations: StationChoice[];
}

export interface StationPick {
	name: string;
	stop: string;
}

/** 구간 고르기의 단계. 화면 하나 안에서 바뀐다. */
export type LegStep =
	| { kind: "mode" }
	| { kind: "bus-search" }
	| { kind: "bus-board"; route: BusRouteMatch }
	| { board: BusStop; kind: "bus-alight"; route: BusRouteMatch }
	| { kind: "subway-line" }
	| { kind: "subway-board"; line: SubwayLine }
	| { board: StationPick; kind: "subway-alight"; line: SubwayLine };

export type SearchView = "hint" | "loading" | "failed" | "empty" | "results";
export type DirectionView = "checking" | "ready" | "not-direct" | "failed";
export type LookupView = "loading" | "failed" | "not-found" | "ready";

export interface BusRouteRow {
	badge: LineBadgeInput;
	/** "서울 간선", "경기 버스" */
	sub: string;
	title: string;
}

const ROUTE_TYPE_KEYS: Record<string, MessageKey> = {
	"1": "legPicker.routeType.airport",
	"2": "legPicker.routeType.village",
	"3": "legPicker.routeType.trunk",
	"4": "legPicker.routeType.branch",
	"5": "legPicker.routeType.circular",
	"6": "legPicker.routeType.express",
};

const REGION_KEYS = {
	gyeonggi: "legPicker.region.gyeonggi",
	incheon: "legPicker.region.incheon",
	seoul: "legPicker.region.seoul",
} as const satisfies Record<BusRouteMatch["region"], MessageKey>;

const BRANCH_KEYS: Record<string, MessageKey> = {
	gwangmyeong: "legPicker.branch.gwangmyeong",
	gwangundae: "legPicker.branch.gwangundae",
	gyeongbu: "legPicker.branch.gyeongbu",
	"gyeongwon-gyeongin": "legPicker.branch.gyeongwon-gyeongin",
	imjingang: "legPicker.branch.imjingang",
	jipyeong: "legPicker.branch.jipyeong",
	macheon: "legPicker.branch.macheon",
	main: "legPicker.branch.main",
	north: "legPicker.branch.north",
	seodongtan: "legPicker.branch.seodongtan",
	seongsu: "legPicker.branch.seongsu",
	"seoul-station": "legPicker.branch.seoul-station",
	sinjeong: "legPicker.branch.sinjeong",
	south: "legPicker.branch.south",
};

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | null) {
	const counts = new Map<string, number>();
	for (const item of items) {
		const key = keyOf(item);
		if (key !== null) {
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

/**
 * 같은 이름 정류장(순환, 왕복)을 구분하는 글자. 그 무리 안에서 방면이 하나뿐이면 방면을 쓰고,
 * 방면이 같거나 없으면 정류장 번호를 쓴다. `t`가 있으면 방면에 "방면"을 붙인다.
 */
function subsOf(stops: BusStop[], t?: Translate): (string | null)[] {
	const nameCounts = countBy(stops, (stop) => stop.name);
	return stops.map((stop) => {
		if ((nameCounts.get(stop.name) ?? 0) < 2) {
			return null;
		}
		const sameName = stops.filter((other) => other.name === stop.name);
		const directionCounts = countBy(sameName, (other) => other.directionName);
		const { arsId, directionName } = stop;
		const directionIsUnique =
			directionName !== null && directionCounts.get(directionName) === 1;
		if (directionIsUnique || (arsId === null && directionName !== null)) {
			return t
				? t("legPicker.towards", { name: directionName })
				: directionName;
		}
		return arsId;
	});
}

function choicesOf(
	stops: BusStop[],
	isDisabled: (stop: BusStop, index: number) => boolean,
	t?: Translate
): StopChoice[] {
	const subs = subsOf(stops, t);
	return stops.map((stop, index) => ({
		disabled: isDisabled(stop, index),
		label: stop.name,
		stop,
		sub: subs[index] ?? null,
	}));
}

/** 승차 후보. 마지막 정류장에서는 탈 수 없다. */
export function boardChoices(stops: BusStop[], t?: Translate): StopChoice[] {
	const last = stops.length - 1;
	return choicesOf(stops, (_, index) => index === last, t);
}

/** 하차 후보. 승차 정류장과 그 앞(`seq <= board.seq`)은 고를 수 없다. */
export function alightChoices(
	stops: BusStop[],
	board: BusStop,
	t?: Translate
): StopChoice[] {
	return choicesOf(stops, (stop) => stop.seq <= board.seq, t);
}

/**
 * 고른 버스 구간. 조회 API의 ID(`seoul-bus:…`)를 그대로 쓰고, 노선 이름은 지역이 붙지 않은 `shortName`이다.
 * 정류장은 `parsePlan`이 받는 필드만 담는다(`arsId`, `directionName`은 넣지 않는다).
 */
export function busLeg(
	route: BusRouteMatch,
	board: BusStop,
	alight: BusStop
): BusLeg {
	return {
		alight: {
			name: alight.name,
			seq: alight.seq,
			stop: alight.stop as StopRef,
		},
		board: { name: board.name, seq: board.seq, stop: board.stop as StopRef },
		line: route.line as LineRef,
		lineName: route.shortName,
		mode: "bus",
	};
}

/** 고른 버스 노선의 종류·지역. 구간(`Leg`)에는 담지 않고 기기의 `busMeta`에 둔다. */
export function busMetaOf(route: BusRouteMatch): BusMeta {
	return { region: route.region, routeType: route.routeType };
}

/** 승차역 후보. 모든 지선의 모든 역을 고를 수 있다. */
export function subwayBoardChoices(branches: SubwayBranch[]): BranchChoices[] {
	return branches.map((branch) => ({
		branchKey: branch.branchKey,
		stations: branch.stations.map((station) => ({
			disabled: false,
			name: station.name,
			stop: station.stop,
		})),
	}));
}

/** 하차역 후보. 승차역이 없는 지선은 통째로, 승차역 자신도 고를 수 없다. */
export function subwayAlightChoices(
	branches: SubwayBranch[],
	board: string
): BranchChoices[] {
	return branches.map((branch) => {
		const hasBoard = branch.stations.some((station) => station.stop === board);
		return {
			branchKey: branch.branchKey,
			stations: branch.stations.map((station) => ({
				disabled: !hasBoard || station.stop === board,
				name: station.name,
				stop: station.stop,
			})),
		};
	});
}

/** 승차역이 없어 통째로 고를 수 없는 지선인지. 승차역이 있는 지선은 승차역만 막혀 있다. */
export function isBranchUnavailable(
	branch: BranchChoices,
	board: string
): boolean {
	return !branch.stations.some((station) => station.stop === board);
}

/** 고른 지하철 구간. 노선 ID는 조회 API의 `seoul-subway:<lineKey>`를 그대로 쓴다. */
export function subwayLeg(
	line: SubwayLine,
	board: StationPick,
	alight: StationPick,
	direction: "up" | "down"
): SubwayLeg {
	return {
		alight: { name: alight.name, stop: alight.stop as StopRef },
		board: { name: board.name, stop: board.stop as StopRef },
		direction,
		line: line.line as LineRef,
		lineName: line.name,
		mode: "subway",
	};
}

/** 검색 결과 줄. 번호가 같은 서울·경기·인천 노선이 배지 옆 지역 글자와 아래 글자로 구분된다. */
export function busRouteRow(route: BusRouteMatch, t: Translate): BusRouteRow {
	const region = t(REGION_KEYS[route.region]);
	const typeKey = ROUTE_TYPE_KEYS[route.routeType];
	return {
		badge: {
			mode: "bus",
			name: route.shortName,
			region: route.region,
			routeType: route.routeType,
		},
		sub: typeKey
			? t("legPicker.routeSub", { region, type: t(typeKey) })
			: t("legPicker.routeSubPlain", { region }),
		title: route.name,
	};
}

/** 지선 이름. 아는 지선은 이름을, 모르는 지선은 "갈래 N"(1부터)을 준다. */
export function branchLabel(
	branchKey: string,
	index: number,
	t: Translate
): string {
	const key = BRANCH_KEYS[branchKey];
	return key ? t(key) : t("legPicker.branch.other", { n: index + 1 });
}

/** 검색 화면에 무엇을 보일지. 검색어가 비면 "찾는 노선이 없어요"가 아니라 안내를 보인다. */
export function searchView(
	query: string,
	result: RefResult<BusRouteMatch[]> | undefined,
	loading: boolean
): SearchView {
	if (query.trim() === "") {
		return "hint";
	}
	if (loading || result === undefined) {
		return "loading";
	}
	if (!result.ok) {
		return "failed";
	}
	return result.value.length === 0 ? "empty" : "results";
}

/** 정류장·노선·역 조회 결과를 화면 상태로 읽는다. */
export function lookupView(result: RefResult<unknown> | undefined): LookupView {
	if (result === undefined) {
		return "loading";
	}
	if (result.ok) {
		return "ready";
	}
	return result.reason === "not-found" ? "not-found" : "failed";
}

/** 한 단계 앞. 첫 단계(수단)에서는 null이고, 화면을 닫는다. */
export function previousStep(step: LegStep): LegStep | null {
	switch (step.kind) {
		case "mode":
			return null;
		case "bus-search":
		case "subway-line":
			return { kind: "mode" };
		case "bus-board":
			return { kind: "bus-search" };
		case "bus-alight":
			return { kind: "bus-board", route: step.route };
		case "subway-board":
			return { kind: "subway-line" };
		case "subway-alight":
			return { kind: "subway-board", line: step.line };
		default:
			return null;
	}
}

/** 두 역 사이 방향 조회를 화면 상태로 읽는다. `not-direct`면 하차역을 다시 고르게 한다. */
export function directionView(
	result:
		| RefResult<{ direction: "up" | "down"; stops: number }>
		| { ok: false; reason: "not-direct" }
		| undefined,
	loading: boolean
): DirectionView {
	if (loading || result === undefined) {
		return "checking";
	}
	if (result.ok) {
		return "ready";
	}
	return result.reason === "not-direct" ? "not-direct" : "failed";
}
