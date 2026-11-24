/**
 * 마지막으로 받은 도착이 이보다 오래되면 실시간으로 그리지 않는다. 서버 `COMMUTE_STALE_AFTER_MS`
 * 기본값(`packages/commute/src/config.ts`의 `staleAfterMs`)과 같다. 앱은 서버 설정을 받지 않는다.
 */
export const LIVE_STALE_AFTER_MS = 150_000;

/** 폴링이 실패해 `receivedAt`(기기 시각) 뒤로 새 응답이 없은 지 묵음 기준을 넘었는가. */
export function isLiveStale(receivedAt: number, now: number): boolean {
	return now - receivedAt > LIVE_STALE_AFTER_MS;
}
