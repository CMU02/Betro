import type { PermissionStatus } from "../onboarding/onboarding";
import type { LockScreenSystemState } from "./lock-screen-readiness";

export interface LockScreenStatusDeps {
	/** iOS 실시간 현황 허용. Android는 false여도 쓰지 않는다. */
	readActivitiesEnabled: () => boolean;
	/** 창 없이 알림 권한을 읽는다. */
	readPushStatus: () => Promise<PermissionStatus>;
}

export interface LockScreenStatusStore {
	/** 아직 읽지 못했으면 null. */
	get: () => LockScreenSystemState | null;
	/** 다시 읽는다. 읽지 못하면 마지막 값을 그대로 돌려준다. 던지지 않는다. */
	refresh: () => Promise<LockScreenSystemState | null>;
	subscribe: (listener: () => void) => () => void;
}

/**
 * 잠금화면 안내에 필요한 시스템 상태(알림 권한, 실시간 현황)를 한곳에 둔다. 설정 행, 장소 화면 안내,
 * 저장 뒤 시트, 푸시 구독이 같은 값을 쓰고, 앱이 앞으로 올 때와 권한을 요청한 뒤 다시 읽는다.
 */
export function createLockScreenStatusStore(
	deps: LockScreenStatusDeps
): LockScreenStatusStore {
	let state: LockScreenSystemState | null = null;
	const listeners = new Set<() => void>();

	function set(next: LockScreenSystemState): void {
		if (
			state !== null &&
			state.activitiesEnabled === next.activitiesEnabled &&
			state.pushStatus === next.pushStatus
		) {
			return;
		}
		state = next;
		for (const listener of listeners) {
			listener();
		}
	}

	return {
		get: () => state,
		refresh: async () => {
			try {
				const pushStatus = await deps.readPushStatus();
				set({ activitiesEnabled: deps.readActivitiesEnabled(), pushStatus });
			} catch {
				// 읽지 못하면 지금 값을 둔다. 다음에 앱이 앞으로 올 때 다시 읽는다.
			}
			return state;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
