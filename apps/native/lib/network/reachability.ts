/**
 * 서버에 닿는지. 기기의 네트워크 상태를 읽는 모듈 없이, 앱이 보낸 요청의 결과로만 판단한다.
 * 응답이 하나라도 오면(상태 코드와 관계없이) 닿는 것이고, 네트워크 오류·타임아웃이면 닿지 않는 것이다.
 * 비행기 모드, Wi-Fi·데이터 꺼짐, 서버 장애가 모두 "닿지 않음"이다.
 */
export interface Reachability {
	isOffline: () => boolean;
	/** `reachable`이 지금 상태와 다를 때만 듣는 쪽에 알린다. */
	report: (reachable: boolean) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createReachability(): Reachability {
	let offline = false;
	const listeners = new Set<() => void>();
	return {
		isOffline: () => offline,
		report(reachable) {
			if (offline === !reachable) {
				return;
			}
			offline = !reachable;
			for (const listener of listeners) {
				listener();
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export interface ProbeTimers {
	clear: (id: number) => void;
	set: (run: () => void, ms: number) => number;
}

export interface OfflineProbeDeps {
	intervalMs: number;
	/** 서버에 가벼운 요청을 하나 보낸다. 결과는 요청 쪽이 `reachability.report`로 알린다. */
	probe: () => Promise<void>;
	reachability: Reachability;
	timers: ProbeTimers;
}

/**
 * 닿지 않는 동안 `intervalMs`마다 탐침을 보내, 화면이 아무 요청을 하지 않아도 연결이 돌아오면
 * 안내가 사라지게 한다. 닿는 동안에는 보내지 않는다. 돌려주는 함수로 멈춘다.
 */
export function startOfflineProbe(deps: OfflineProbeDeps): () => void {
	const { intervalMs, probe, reachability, timers } = deps;
	let waiting: number | null = null;

	const cancel = (): void => {
		if (waiting !== null) {
			timers.clear(waiting);
			waiting = null;
		}
	};

	const schedule = (): void => {
		if (waiting !== null || !reachability.isOffline()) {
			return;
		}
		waiting = timers.set(async () => {
			waiting = null;
			try {
				await probe();
			} finally {
				schedule();
			}
		}, intervalMs);
	};

	const unsubscribe = reachability.subscribe(() => {
		if (reachability.isOffline()) {
			schedule();
		} else {
			cancel();
		}
	});
	schedule();

	return () => {
		unsubscribe();
		cancel();
	};
}
