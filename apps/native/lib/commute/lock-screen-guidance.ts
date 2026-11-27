import type { LockScreenPlatform } from "./lock-screen-readiness";

export interface LockScreenGuidanceDeps {
	/** 이 기기에 떠 있는 안내(iOS Live Activity, Android 진행 중 알림)를 바로 끝낸다. */
	endLocal: () => Promise<void>;
	/** 예약을 서버와 맞춘다. iOS는 올리는 예약의 `enabled`가 바뀐 설정을 따른다. 던지지 않는다. */
	sync: () => Promise<void>;
	/** 설정 값을 저장한다. */
	update: (enabled: boolean) => void;
}

/**
 * 설정의 "출퇴근 잠금화면 안내"를 바꾼다. iOS는 꺼진 예약을 올려 서버가 세션을 열지 않고 돌던 세션은 다음
 * tick에 닫는다. Android는 세션을 그대로 두고 기기가 알림을 그리지 않는다(`handleCommuteMessage`). 끌 때는
 * 서버를 기다리지 않고 이 기기에 떠 있는 것도 `endLocal`로 끝낸다(연결이 없어도 지워진다). 서버에 닿지
 * 못하면 앱이 앞으로 올 때의 맞추기가 다시 올린다.
 */
export async function setLockScreenGuidance(
	enabled: boolean,
	deps: LockScreenGuidanceDeps
): Promise<void> {
	deps.update(enabled);
	if (!enabled) {
		await deps.endLocal().catch(() => undefined);
	}
	await deps.sync();
}

export interface LocalGuidanceEnders {
	/** iOS: 이 앱의 Live Activity를 모두 끝낸다. */
	endActivities: () => Promise<void>;
	/** Android 진행 중 알림 모듈. 없으면(iOS, 모듈이 없는 빌드) null. */
	notifier: { hideAll: () => void } | null;
}

/**
 * 이 기기에 떠 있는 출퇴근 안내를 플랫폼에 맞게 끝낸다. Android 모듈은 동기로 던질 수 있어
 * async로 감싸 거부로 바꾼다(`setLockScreenGuidance`가 그 뒤 서버 맞추기를 건너뛰지 않게).
 */
export async function endLocalGuidance(
	platform: LockScreenPlatform,
	enders: LocalGuidanceEnders
): Promise<void> {
	if (platform === "ios") {
		await enders.endActivities();
		return;
	}
	enders.notifier?.hideAll();
}
