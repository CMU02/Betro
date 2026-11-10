import type { MessageKey, MessageParams } from "../i18n/translate";
import type { ContentState } from "./content-state";

export type LockScreenAction = "boarded" | "next" | "end";
export type LockScreenTag = "live" | "estimated" | "delayed";

export interface LockScreenModel {
	actions: LockScreenAction[];
	detail: string;
	header: string;
	lineName: string;
	minutes: string | null;
	mode: "bus" | "subway";
	progress: { current: number; nodes: number };
	status: string;
	suggestion: string | null;
	tag: LockScreenTag;
	tagLabel: string;
}

export interface LockScreenDeps {
	header: string | null;
	/** epoch 초 */
	now: number;
	platform: "ios" | "android";
	t: (key: MessageKey, params?: MessageParams) => string;
	timezone: string;
}

type Translate = LockScreenDeps["t"];

const SECONDS_PER_MINUTE = 60;
const DELAYED_MINUTES = 5;
const MS_PER_SECOND = 1000;
const NODES_BASE = 2;
const NODES_PER_LEG = 2;
const RIDE_OFFSET = 1.5;

function formatClock(epochSeconds: number, timezone: string): string {
	return new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		timeZone: timezone,
	}).format(new Date(epochSeconds * MS_PER_SECOND));
}

function knownStops(stopsAway: number | null): number | null {
	return stopsAway !== null && stopsAway >= 0 ? Math.floor(stopsAway) : null;
}

function statusLine(
	state: ContentState,
	deps: LockScreenDeps,
	clock: (epoch: number) => string
): string {
	const { t, now } = deps;
	const { etaEpoch, stage } = state;
	if (state.passed && etaEpoch !== null) {
		const passedKey =
			state.mode === "subway"
				? "commute.lock.status.passedSubway"
				: "commute.lock.status.passedBus";
		return t(passedKey, {
			eta: clock(etaEpoch),
			passedLine: state.passed.lineName,
		});
	}
	const isBeforeLeave =
		stage === "walk" &&
		state.legIndex === 0 &&
		state.leaveEpoch !== null &&
		etaEpoch !== null &&
		now < state.leaveEpoch;
	if (isBeforeLeave && state.leaveEpoch !== null && etaEpoch !== null) {
		return t("commute.lock.status.beforeLeave", {
			eta: clock(etaEpoch),
			leave: clock(state.leaveEpoch),
			line: state.lineName,
		});
	}
	const stops = knownStops(state.stopsAway);
	if (stage === "walk" || stage === "wait") {
		if (stops === null) {
			return t("commute.lock.status.unknown");
		}
		return stops >= 1
			? t("commute.lock.status.stopsAway", { n: stops })
			: t("commute.lock.status.arriving");
	}
	if (stage === "ride") {
		if (stops === null) {
			return t("commute.lock.status.rideUnknown");
		}
		return stops >= 1
			? t("commute.lock.status.ride", { n: stops })
			: t("commute.lock.status.rideLast");
	}
	return t("commute.lock.status.arrived", { stop: state.stopName });
}

function detailLine(
	state: ContentState,
	t: Translate,
	clock: (epoch: number) => string
): string {
	if (state.etaEpoch === null) {
		return t("commute.lock.detail.noEta", { stop: state.stopName });
	}
	const key =
		state.etaState === "live"
			? "commute.lock.detail.eta"
			: "commute.lock.detail.etaEstimated";
	return t(key, { eta: clock(state.etaEpoch), stop: state.stopName });
}

function minutesLabel(
	state: ContentState,
	deps: LockScreenDeps
): string | null {
	if (
		state.etaEpoch === null ||
		state.stage === "arrived" ||
		state.stage === "ended"
	) {
		return null;
	}
	const remaining = state.etaEpoch - deps.now;
	if (remaining < SECONDS_PER_MINUTE) {
		return deps.t("commute.lock.minutes.soon");
	}
	return deps.t("commute.lock.minutes.value", {
		m: Math.floor(remaining / SECONDS_PER_MINUTE),
	});
}

function tagOf(state: ContentState): LockScreenTag {
	if (state.etaState === "estimated" || state.positionState !== "live") {
		return "estimated";
	}
	return state.delayMinutes >= DELAYED_MINUTES ? "delayed" : "live";
}

function suggestionLine(
	state: ContentState,
	deps: LockScreenDeps
): string | null {
	if (!state.suggestion) {
		return null;
	}
	const minutes = Math.max(
		1,
		Math.floor((state.suggestion.boardEtaEpoch - deps.now) / SECONDS_PER_MINUTE)
	);
	const key =
		state.suggestion.mode === "subway"
			? "commute.lock.suggestion.subway"
			: "commute.lock.suggestion.bus";
	return deps.t(key, {
		line: state.suggestion.lineName,
		m: minutes,
		saves: state.suggestion.savesMinutes,
	});
}

function actionsOf(
	state: ContentState,
	platform: LockScreenDeps["platform"]
): LockScreenAction[] {
	const beforeBoarding = state.stage === "walk" || state.stage === "wait";
	if (platform === "ios") {
		return beforeBoarding ? ["boarded", "next"] : [];
	}
	return beforeBoarding ? ["boarded", "next", "end"] : ["end"];
}

function progressOf(state: ContentState): LockScreenModel["progress"] {
	const nodes = NODES_BASE + state.legCount * NODES_PER_LEG;
	const base = state.legIndex * NODES_PER_LEG;
	let current: number;
	switch (state.stage) {
		case "walk":
			current = base;
			break;
		case "wait":
			current = base + 1;
			break;
		case "ride":
			current = base + RIDE_OFFSET;
			break;
		default:
			current = nodes - 1;
	}
	return { current: Math.min(Math.max(current, 0), nodes - 1), nodes };
}

/**
 * 푸시 값을 잠금화면 화면 모델로 바꾼다. 문구 규칙은 계획 2-F의 "잠금화면 문구 표"이고
 * iOS 확장의 Swift 구현이 같은 규칙을 따른다.
 */
export function lockScreenModel(
	state: ContentState,
	deps: LockScreenDeps
): LockScreenModel {
	const clock = (epoch: number) => formatClock(epoch, deps.timezone);
	const tag = tagOf(state);
	return {
		actions: actionsOf(state, deps.platform),
		detail: detailLine(state, deps.t, clock),
		header: deps.header ?? deps.t("commute.lock.header.fallback"),
		lineName: state.lineName,
		minutes: minutesLabel(state, deps),
		mode: state.mode,
		progress: progressOf(state),
		status: statusLine(state, deps, clock),
		suggestion: suggestionLine(state, deps),
		tag,
		tagLabel: deps.t(`commute.lock.tag.${tag}`),
	};
}
