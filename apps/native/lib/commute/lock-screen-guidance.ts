export interface LockScreenGuidanceDeps {
	/** 이 기기에 떠 있는 안내(iOS Live Activity)를 바로 끝낸다. */
	endLocal: () => Promise<void>;
	/** 예약을 서버와 맞춘다. 올리는 예약의 `enabled`가 바뀐 설정을 따른다. 던지지 않는다. */
	sync: () => Promise<void>;
	/** 설정 값을 저장한다. */
	update: (enabled: boolean) => void;
}

/**
 * 설정의 "출퇴근 잠금화면 안내"를 바꾼다. 서버는 꺼진 예약의 세션을 열지 않고 돌던 세션은 다음 tick에
 * 닫는다(iOS 시작 푸시와 Android 알림 모두). 끌 때는 서버를 기다리지 않고 이 기기에 떠 있는 것도 끝낸다.
 * 서버에 닿지 못하면 앱이 앞으로 올 때의 맞추기가 다시 올린다.
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
