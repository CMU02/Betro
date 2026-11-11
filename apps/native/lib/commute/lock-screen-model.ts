import type { MessageKey, MessageParams } from "../i18n/translate";
import type { ContentState, NextLegContent } from "./content-state";

export type LockScreenAction = "end";
export type LockScreenTag = "live" | "estimated" | "delayed";

export interface LockScreenNextLeg {
	lineName: string;
	mode: "bus" | "subway";
	text: string;
}

export interface LockScreenModel {
	/** iOS는 버튼이 없고, Android는 "종료" 하나다. */
	actions: LockScreenAction[];
	detail: string;
	header: string;
	lineName: string;
	minutes: string | null;
	mode: "bus" | "subway";
	/** 남은 구간이 3개 이상이면 "외 {n}구간"(n = 남은 수 - 2). */
	moreLegs: string | null;
	/** 지금 구간 뒤에 남은 구간 줄. 최대 2줄. */
	nextLegs: LockScreenNextLeg[];
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
const MAX_NEXT_LEG_LINES = 2;

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

/** "지나갔어요"를 쓰는 경우. 나가기 전 문구보다 앞선다. */
function showsPassed(state: ContentState): boolean {
	return state.passed !== null && state.etaEpoch !== null;
}

/** 첫 구간 walk 단계에서 나가는 시각이 아직 오지 않았으면 그 시각과 탑승 시각을 보인다. */
function beforeLeaveOf(
	state: ContentState,
	now: number
): { etaEpoch: number; leaveEpoch: number } | null {
	const { etaEpoch, leaveEpoch } = state;
	if (
		showsPassed(state) ||
		state.stage !== "walk" ||
		state.legIndex !== 0 ||
		leaveEpoch === null ||
		etaEpoch === null ||
		now >= leaveEpoch
	) {
		return null;
	}
	return { etaEpoch, leaveEpoch };
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
	const beforeLeave = beforeLeaveOf(state, now);
	if (beforeLeave) {
		return t("commute.lock.status.beforeLeave", {
			leave: clock(beforeLeave.leaveEpoch),
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
	deps: LockScreenDeps,
	clock: (epoch: number) => string
): string {
	const { t } = deps;
	const beforeLeave = beforeLeaveOf(state, deps.now);
	if (beforeLeave) {
		return t("commute.lock.detail.beforeLeave", {
			eta: clock(beforeLeave.etaEpoch),
			stop: state.stopName,
		});
	}
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

function actionsOf(platform: LockScreenDeps["platform"]): LockScreenAction[] {
	return platform === "android" ? ["end"] : [];
}

function nextLegText(
	leg: NextLegContent,
	t: Translate,
	clock: (epoch: number) => string
): string {
	if (leg.boardEtaEpoch === null) {
		return t("commute.lock.nextLeg.noEta", { stop: leg.stopName });
	}
	const key =
		leg.etaState === "live"
			? "commute.lock.nextLeg.eta"
			: "commute.lock.nextLeg.etaEstimated";
	return t(key, { eta: clock(leg.boardEtaEpoch), stop: leg.stopName });
}

function nextLegLines(
	state: ContentState,
	t: Translate,
	clock: (epoch: number) => string
): LockScreenNextLeg[] {
	return state.nextLegs.slice(0, MAX_NEXT_LEG_LINES).map((leg) => ({
		lineName: leg.lineName,
		mode: leg.mode,
		text: nextLegText(leg, t, clock),
	}));
}

function moreLegsLine(state: ContentState, t: Translate): string | null {
	const rest = state.nextLegs.length - MAX_NEXT_LEG_LINES;
	return rest >= 1 ? t("commute.lock.nextLeg.more", { n: rest }) : null;
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
		actions: actionsOf(deps.platform),
		detail: detailLine(state, deps, clock),
		header: deps.header ?? deps.t("commute.lock.header.fallback"),
		lineName: state.lineName,
		minutes: minutesLabel(state, deps),
		mode: state.mode,
		moreLegs: moreLegsLine(state, deps.t),
		nextLegs: nextLegLines(state, deps.t, clock),
		status: statusLine(state, deps, clock),
		suggestion: suggestionLine(state, deps),
		tag,
		tagLabel: deps.t(`commute.lock.tag.${tag}`),
	};
}
