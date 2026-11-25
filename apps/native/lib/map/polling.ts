/**
 * 보일 때만 도는 폴러(지도 설계 4.5). 보이게 바뀌는 순간 `run`을 바로 한 번 돌리고, 그 뒤로는 `intervalMs`마다 돈다.
 * 숨겨지면 예약을 취소해 백그라운드에서는 요청이 0건이다. 이전 `run`이 끝나지 않았으면 그 틱은 건너뛴다.
 */
export interface PollerOptions {
	intervalMs: number;
	now: () => number;
	run: () => Promise<void>;
	/** `ms` 뒤에 `fn`을 한 번 실행하도록 예약하고, 취소 함수를 돌려준다. */
	schedule: (fn: () => void, ms: number) => () => void;
}

export interface Poller {
	dispose: () => void;
	setVisible: (visible: boolean) => void;
}

export function createPoller(options: PollerOptions): Poller {
	const { intervalMs, run, schedule } = options;
	let cancel: (() => void) | null = null;
	let visible = false;
	let disposed = false;
	let running = false;

	const stop = (): void => {
		cancel?.();
		cancel = null;
	};

	const execute = (): void => {
		if (running) {
			return;
		}
		running = true;
		run()
			.catch(() => undefined)
			.finally(() => {
				running = false;
			});
	};

	const tick = (): void => {
		if (!visible || disposed) {
			return;
		}
		cancel = schedule(tick, intervalMs);
		execute();
	};

	return {
		dispose() {
			disposed = true;
			visible = false;
			stop();
		},
		setVisible(next) {
			if (disposed || next === visible) {
				return;
			}
			visible = next;
			stop();
			if (next) {
				tick();
			}
		},
	};
}
