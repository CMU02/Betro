export interface BusFreshness {
	/** 실시간 표시를 쓸지. */
	live: boolean;
	/** "버스 위치는 실시간으로 갱신돼요" 안내를 보일지. */
	showNotice: boolean;
	/** "N대 운행 중"을 보일지. */
	showRunning: boolean;
	/** 실시간·시간표 추정 표시를 보일지. */
	showTag: boolean;
}

/**
 * 07 버스 노선 상세의 갱신 표시. 실시간 자료가 없을 때(첫 스냅샷 전, 수집 한도, 조회 실패)
 * 지도에 차량이 0대라고 "0대 운행 중"이나 실시간 안내를 보이면 운행이 없는 것처럼 읽힌다.
 * 관측 요청 직후 1~2분은 도착이 실시간이어도 지도 차량이 아직 없다.
 * 그래서 대수는 지도에 차량이 있을 때만, 안내는 실시간일 때만 보인다.
 * 첫 응답을 기다리는 동안(`loading`)에는 아직 모르는 상태라 아무 표시도 하지 않는다.
 */
export function busFreshnessOf({
	etaState,
	loading = false,
	running,
}: {
	etaState: "live" | "estimated" | null;
	loading?: boolean;
	running: number;
}): BusFreshness {
	if (loading && etaState === null && running === 0) {
		return {
			live: false,
			showNotice: false,
			showRunning: false,
			showTag: false,
		};
	}
	const live = etaState === "live" || (etaState === null && running > 0);
	return { live, showNotice: live, showRunning: running > 0, showTag: true };
}
