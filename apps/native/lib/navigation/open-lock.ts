/** 한 번 연 뒤 다시 열지 않는 시간. 빠르게 두 번 눌러 같은 화면이 둘 쌓이지 않게 한다. */
export const OPEN_LOCK_MS = 800;

/**
 * 지금 화면을 열어도 되는지. 연 적이 없거나(`lastOpenedAt` null) 마지막으로 연 뒤 `lockMs`가 지났으면 true다.
 * 기기 시계가 뒤로 가 `now`가 더 이르면 잠그지 않는다(시계를 되돌린 만큼 오래 잠기지 않게).
 */
export function canOpenNow(
	lastOpenedAt: number | null,
	now: number,
	lockMs: number = OPEN_LOCK_MS
): boolean {
	if (lastOpenedAt === null || now < lastOpenedAt) {
		return true;
	}
	return now - lastOpenedAt >= lockMs;
}
