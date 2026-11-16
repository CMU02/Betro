import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";

/** 설정의 "잠금화면 표본" 화면이 띄우는 사례 하나(`lock-screen-cases.json`). */
export interface LockSample {
	name: string;
	/** 사례의 기준 시각(epoch 초). 기대 문구는 이 시각에서 계산됐다. */
	now: number;
	state: ContentState;
	/** 기대하는 상태 문장. 목록에서 사례를 알아보는 데 쓴다. */
	status: string;
}

interface FixtureCase {
	expected: { status: string };
	name: string;
	now: number;
	state: ContentState;
}

export function lockSamples(): LockSample[] {
	return (fixture.cases as FixtureCase[]).map((item) => ({
		name: item.name,
		now: item.now,
		state: item.state,
		status: item.expected.status,
	}));
}

function shift(epoch: number | null, offset: number): number | null {
	return epoch === null ? null : epoch + offset;
}

/**
 * 사례의 시각을 지금으로 옮긴 푸시 값. 사례는 고정된 날(2026-11-10 08:00)의 값이라 그대로 띄우면
 * 모든 도착 시각이 지나 있다. 시각 필드를 모두 같은 만큼 옮겨 남은 분과 상태가 기대값과 같게 한다.
 */
export function lockSampleState(sample: LockSample, now: number): ContentState {
	const offset = Math.round(now) - sample.now;
	const { state } = sample;
	return {
		...state,
		destinationEtaEpoch: shift(state.destinationEtaEpoch, offset),
		etaEpoch: shift(state.etaEpoch, offset),
		leaveEpoch: shift(state.leaveEpoch, offset),
		nextLegs: state.nextLegs.map((leg) => ({
			...leg,
			boardEtaEpoch: shift(leg.boardEtaEpoch, offset),
		})),
		sentAt: state.sentAt + offset,
		suggestion: state.suggestion
			? {
					...state.suggestion,
					boardEtaEpoch: state.suggestion.boardEtaEpoch + offset,
				}
			: null,
	};
}
