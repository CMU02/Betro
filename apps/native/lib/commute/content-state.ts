/**
 * 서버가 보내는 출퇴근 푸시 값 v1. 필드의 원본은 2-C 계획 Task 7의 `ContentState`다.
 * 시각은 epoch 초다.
 */
export type CommuteStage = "walk" | "wait" | "ride" | "arrived" | "ended";
export type CommuteMode = "bus" | "subway";
export type PositionState = "live" | "stale" | "none";
export type EtaState = "live" | "estimated";

export interface ContentStateSuggestion {
	boardEtaEpoch: number;
	lineName: string;
	mode: CommuteMode;
	rank: number;
	savesMinutes: number;
}

/** 기본 경로에서 지금 구간 뒤에 남은 구간 하나(서버 `NextLegContent`와 같은 모양). */
export interface NextLegContent {
	/** 그 구간의 승차 예상(epoch 초). */
	boardEtaEpoch: number | null;
	etaState: EtaState;
	lineName: string;
	mode: CommuteMode;
	/** 그 구간의 승차 정류장(역). */
	stopName: string;
}

export interface ContentState {
	delayMinutes: number;
	destinationEtaEpoch: number | null;
	etaEpoch: number | null;
	etaState: EtaState;
	leaveEpoch: number | null;
	legCount: number;
	legIndex: number;
	lineName: string;
	mode: CommuteMode;
	/** 지금 구간 뒤에 남은 구간(최대 3개). 배포된 옛 서버의 값에는 없어서 []로 읽는다. */
	nextLegs: NextLegContent[];
	passed: { lineName: string } | null;
	positionState: PositionState;
	sentAt: number;
	seq: number;
	stage: CommuteStage;
	stopName: string;
	stopsAway: number | null;
	suggestion: ContentStateSuggestion | null;
	v: 1;
}

const STAGES: readonly string[] = ["walk", "wait", "ride", "arrived", "ended"];
const MODES: readonly string[] = ["bus", "subway"];
const POSITION_STATES: readonly string[] = ["live", "stale", "none"];
const ETA_STATES: readonly string[] = ["live", "estimated"];

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly string[]
): value is T {
	return isString(value) && allowed.includes(value);
}

/** 없거나 null이면 null, 숫자면 그 값, 그 밖의 타입이면 undefined(잘못된 값). */
function nullableNumber(value: unknown): number | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	return isNumber(value) ? value : undefined;
}

function parsePassed(value: unknown): { lineName: string } | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (!(isRecord(value) && isString(value.lineName))) {
		return undefined;
	}
	return { lineName: value.lineName };
}

function parseSuggestion(
	value: unknown
): ContentStateSuggestion | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (
		!(
			isRecord(value) &&
			isNumber(value.rank) &&
			isString(value.lineName) &&
			oneOf<CommuteMode>(value.mode, MODES) &&
			isNumber(value.boardEtaEpoch) &&
			isNumber(value.savesMinutes)
		)
	) {
		return undefined;
	}
	return {
		boardEtaEpoch: value.boardEtaEpoch,
		lineName: value.lineName,
		mode: value.mode,
		rank: value.rank,
		savesMinutes: value.savesMinutes,
	};
}

function parseNextLeg(value: unknown): NextLegContent | undefined {
	if (!isRecord(value)) {
		return;
	}
	const boardEtaEpoch = nullableNumber(value.boardEtaEpoch);
	const { etaState, lineName, mode, stopName } = value;
	if (
		boardEtaEpoch === undefined ||
		!(
			oneOf<EtaState>(etaState, ETA_STATES) &&
			isString(lineName) &&
			oneOf<CommuteMode>(mode, MODES) &&
			isString(stopName)
		)
	) {
		return;
	}
	return { boardEtaEpoch, etaState, lineName, mode, stopName };
}

/** 키가 없으면 [](옛 값). 배열이 아니거나 항목 하나라도 모양이 틀리면 undefined(잘못된 값). */
function parseNextLegs(value: unknown): NextLegContent[] | undefined {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		return;
	}
	const legs: NextLegContent[] = [];
	for (const item of value) {
		const leg = parseNextLeg(item);
		if (leg === undefined) {
			return;
		}
		legs.push(leg);
	}
	return legs;
}

/** 모르는 필드는 버린다. 버전이나 필수 필드의 타입이 다르면 null. */
export function parseContentState(input: unknown): ContentState | null {
	if (!(isRecord(input) && input.v === 1)) {
		return null;
	}
	const {
		stage,
		mode,
		positionState,
		etaState,
		seq,
		sentAt,
		legIndex,
		legCount,
		delayMinutes,
		lineName,
		stopName,
	} = input;
	const stopsAway = nullableNumber(input.stopsAway);
	const etaEpoch = nullableNumber(input.etaEpoch);
	const leaveEpoch = nullableNumber(input.leaveEpoch);
	const destinationEtaEpoch = nullableNumber(input.destinationEtaEpoch);
	const passed = parsePassed(input.passed);
	const suggestion = parseSuggestion(input.suggestion);
	const nextLegs = parseNextLegs(input.nextLegs);
	if (
		!(
			oneOf<CommuteStage>(stage, STAGES) &&
			oneOf<CommuteMode>(mode, MODES) &&
			oneOf<PositionState>(positionState, POSITION_STATES) &&
			oneOf<EtaState>(etaState, ETA_STATES) &&
			isNumber(seq) &&
			isNumber(sentAt) &&
			isNumber(legIndex) &&
			isNumber(legCount) &&
			isNumber(delayMinutes) &&
			isString(lineName) &&
			isString(stopName)
		) ||
		stopsAway === undefined ||
		etaEpoch === undefined ||
		leaveEpoch === undefined ||
		destinationEtaEpoch === undefined ||
		passed === undefined ||
		suggestion === undefined ||
		nextLegs === undefined
	) {
		return null;
	}
	return {
		delayMinutes,
		destinationEtaEpoch,
		etaEpoch,
		etaState,
		leaveEpoch,
		legCount,
		legIndex,
		lineName,
		mode,
		nextLegs,
		passed,
		positionState,
		sentAt,
		seq,
		stage,
		stopName,
		stopsAway,
		suggestion,
		v: 1,
	};
}

/** 이미 그린 것보다 `seq`가 작거나 같은 값과 끝난 세션의 값은 버린다. */
export function shouldApply(
	last: { ended: boolean; seq: number } | null,
	next: ContentState
): boolean {
	if (last === null) {
		return true;
	}
	if (last.ended) {
		return false;
	}
	return next.seq > last.seq;
}
