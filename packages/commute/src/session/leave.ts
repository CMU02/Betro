import type { CommuteConfig } from "../config";
import { marginSecFor } from "../config";
import type { CommutePlan } from "../plan";
import type { ContentState } from "./content";
import { leaveShownAt } from "./content";
import type { SessionState } from "./stage";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 깜빡임 방지로 tight를 유지할 때 등록 시각과 같은 시각을 권하지 않도록 두는 최소 간격. */
const SAFE_LEAVE_GAP_MS = MINUTE_MS;

/** 나가는 시각의 여유 판단(스펙 4.2). 시각은 밀리초. */
export interface LeaveView {
	/** 밀리초. slack이 tight이고 당기는 폭이 상한 안일 때만 값. 분 단위 내림, leaveAt − 60초 이하. */
	safeLeaveAt: number | null;
	slack: "roomy" | "tight";
	vehicleId: string;
}

interface LeaveInput {
	boardEtaAt: number;
	firstWalkMs: number;
	marginMs: number;
	vehicleId: string;
}

/**
 * 계산할 수 있으면 입력을, 아니면 null(스펙 4.2의 계산하지 않는 경우).
 * 첫 구간 도보 단계에서 나가는 시각 전, 실시간 시각·위치가 있는 잡은 차량에만 계산한다.
 */
function leaveInputOf(
	state: SessionState,
	plan: CommutePlan,
	now: number,
	config: CommuteConfig
): LeaveInput | null {
	const isShowingLeave =
		state.stage === "walk" && state.legIndex === 0 && now < state.leaveAt;
	if (!isShowingLeave || state.passed !== null) {
		return null;
	}
	const route = plan.routes.find((candidate) => candidate.rank === 0);
	const leg = route?.legs[0];
	const estimate = state.estimates.find((candidate) => candidate.rank === 0)
		?.legs[0];
	if (route === undefined || leg === undefined || estimate === undefined) {
		return null;
	}
	const { boardEtaAt, vehicleId } = estimate;
	const isLive =
		estimate.etaState === "live" && estimate.positionState === "live";
	if (vehicleId === null || boardEtaAt === null || !isLive) {
		return null;
	}
	const marginSec = marginSecFor(config, leg.mode, leg.line);
	// 여유 폭 0은 "기능 끔"으로 읽는다.
	if (marginSec <= 0) {
		return null;
	}
	return {
		boardEtaAt,
		firstWalkMs: (route.walkMinutes[0] ?? 0) * MINUTE_MS,
		marginMs: marginSec * SECOND_MS,
		vehicleId,
	};
}

/**
 * 매 tick의 여유 판단. roomy → tight는 바로, tight → roomy는 같은 차량에서
 * 계산값이 leaveAt보다 깜빡임 방지 폭을 넘게 늦어져야 바꾼다. 차량이 바뀌면 처음부터 본다.
 */
export function nextLeaveView(
	prev: LeaveView | null,
	state: SessionState,
	plan: CommutePlan,
	now: number,
	config: CommuteConfig
): LeaveView | null {
	const input = leaveInputOf(state, plan, now, config);
	if (input === null) {
		return null;
	}
	const { leaveAt } = state;
	const raw = input.boardEtaAt - input.marginMs - input.firstWalkMs;
	const floored = Math.floor(raw / MINUTE_MS) * MINUTE_MS;
	const rawSlack = leaveAt <= raw ? "roomy" : "tight";
	const wasTight =
		prev !== null &&
		prev.vehicleId === input.vehicleId &&
		prev.slack === "tight";
	const isWithinHysteresis =
		raw - leaveAt <= config.leaveSlackHysteresisSec * SECOND_MS;
	const slack =
		wasTight && rawSlack === "roomy" && isWithinHysteresis ? "tight" : rawSlack;
	if (slack === "roomy") {
		return { safeLeaveAt: null, slack, vehicleId: input.vehicleId };
	}
	// 당기는 폭이 상한을 넘으면 당긴 시각을 권하지도, 잘라서 거짓 여유를 말하지도 않는다.
	const isPullTooFar = leaveAt - floored > config.leaveMarginMaxSec * SECOND_MS;
	const safeLeaveAt = isPullTooFar
		? null
		: Math.min(floored, leaveAt - SAFE_LEAVE_GAP_MS);
	return { safeLeaveAt, slack, vehicleId: input.vehicleId };
}

/**
 * 보낸 값이 보낸 순간 "safeLeave에 나가면 여유 있어요"를 보였으면 조기 탑승 기준을 남긴다(스펙 4.6).
 * 기준 시각은 safeLeaveEpoch + 첫 도보. 같은 차량이면 이른 쪽을 남기고, 차량이 바뀌면 바꾼다.
 * 보내지 못한 값은 사용자가 본 적이 없으므로 보낸 뒤에만 부른다.
 */
export function earlyBoardAfterSend(
	state: SessionState,
	sent: ContentState,
	plan: CommutePlan
): SessionState {
	const leave = state.leave ?? null;
	const safeLeaveEpoch = sent.safeLeaveEpoch ?? null;
	const isSafeShown = leaveShownAt(sent, sent.sentAt) === "safe";
	if (leave === null || safeLeaveEpoch === null || !isSafeShown) {
		return state;
	}
	const firstWalkMinutes =
		plan.routes.find((route) => route.rank === 0)?.walkMinutes[0] ?? 0;
	const at = safeLeaveEpoch * SECOND_MS + firstWalkMinutes * MINUTE_MS;
	const prev = state.earlyBoardFrom ?? null;
	const isSameVehicle = prev !== null && prev.vehicleId === leave.vehicleId;
	return {
		...state,
		earlyBoardFrom: {
			at: isSameVehicle ? Math.min(prev.at, at) : at,
			vehicleId: leave.vehicleId,
		},
	};
}
