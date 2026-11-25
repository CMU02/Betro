import { useEffect, useState } from "react";

/** 신선도 표시가 초 단위로 바뀌므로 1초마다 시각을 갱신한다. */
const CLOCK_TICK_MS = 1000;

/** 일정 간격으로 현재 시각을 알린다. 반환한 함수로 멈춘다. */
export function startClock(
	onTick: (now: number) => void,
	intervalMs: number,
	nowFn: () => number = Date.now
): () => void {
	const timer = setInterval(() => onTick(nowFn()), intervalMs);
	return () => clearInterval(timer);
}

/** 화면이 보이는 동안 1초마다 갱신되는 현재 시각. 가려지면 멈추고 다시 보일 때 바로 갱신한다. */
export function useNowMs(active: boolean): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!active) {
			return;
		}
		setNow(Date.now());
		return startClock(setNow, CLOCK_TICK_MS);
	}, [active]);
	return now;
}
