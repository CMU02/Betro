import { type CrashSink, reportError } from "../crash/crash-reporting";

export interface SyncFlowDeps {
	reconcile: () => Promise<unknown>;
	sink: CrashSink;
}

export interface SyncFlow {
	/** 맞추기를 한다. 던지지 않고, 실패는 `places-sync`로 기록한다. */
	run: () => Promise<void>;
}

const SYNC_CONTEXT = "places-sync";

/**
 * 맞추기가 겹쳐 돌지 않게 한다. 도는 중에 다시 부르면 지금 것이 끝난 뒤 한 번만 더 돈다.
 * 앞의 것이 느린 네트워크에서 멈춰 있던 사이 네트워크가 돌아와 앱이 앞으로 왔다면, 그 뒤 한 번 더 올려야 하기 때문이다.
 */
export function createSyncFlow(deps: SyncFlowDeps): SyncFlow {
	let running: Promise<void> | null = null;
	let again = false;

	async function loop(): Promise<void> {
		do {
			again = false;
			try {
				// biome-ignore lint/performance/noAwaitInLoops: the next run must start only after this one ends
				await deps.reconcile();
			} catch (error) {
				reportError(deps.sink, error, SYNC_CONTEXT);
			}
		} while (again);
	}

	return {
		run: () => {
			if (running) {
				again = true;
				return running;
			}
			running = loop().finally(() => {
				running = null;
			});
			return running;
		},
	};
}
