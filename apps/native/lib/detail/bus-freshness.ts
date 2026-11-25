export interface BusFreshness {
	/** 실시간 표시를 쓸지. */
	live: boolean;
	/** "버스 위치는 실시간으로 갱신돼요" 안내를 보일지. */
	showNotice: boolean;
	/** "N대 운행 중"을 보일지. */
	showRunning: boolean;
}

/**
 * 07 버스 노선 상세의 갱신 표시. 실시간 자료가 없을 때(첫 스냅샷 전, 수집 한도, 조회 실패)
 * 지도에 차량이 0대라고 "0대 운행 중"이나 실시간 안내를 보이면 운행이 없는 것처럼 읽힌다.
 * 관측 요청 직후 1~2분은 도착이 실시간이어도 지도 차량이 아직 없다.
 * 그래서 대수는 지도에 차량이 있을 때만, 안내는 실시간일 때만 보인다.
 */
export function busFreshnessOf({
	etaState,
	running,
}: {
	etaState: "live" | "estimated" | null;
	running: number;
}): BusFreshness {
	const live = etaState === "live" || (etaState === null && running > 0);
	return { live, showNotice: live, showRunning: running > 0 };
}
