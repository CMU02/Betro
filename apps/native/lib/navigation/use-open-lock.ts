import { useCallback, useRef } from "react";

import { canOpenNow } from "./open-lock";

/**
 * 화면을 여는 함수를 잠금 시간 동안 한 번만 부르게 감싼다. 한 화면의 여는 버튼들이 같은 잠금을 나눠 써서,
 * 다른 버튼을 빠르게 이어 눌러도 화면이 둘 쌓이지 않는다.
 */
export function useOpenLock(): (open: () => void) => void {
	const lastOpenedAt = useRef<number | null>(null);
	return useCallback((open: () => void) => {
		const now = Date.now();
		if (!canOpenNow(lastOpenedAt.current, now)) {
			return;
		}
		lastOpenedAt.current = now;
		open();
	}, []);
}
