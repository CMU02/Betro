import { useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { usePreferences } from "@/lib/preferences/use-preferences";

import {
	appLockScreenStatus,
	lockScreenPlatform,
	openLockScreenSystemSettings,
	requestLockScreenNotifications,
} from "./app-lock-screen";
import {
	type LockScreenFix,
	type LockScreenReadiness,
	type LockScreenSystemState,
	lockScreenFixAction,
	lockScreenReadiness,
} from "./lock-screen-readiness";

/** 시스템 상태. 처음 쓰는 화면이 한 번 읽고, 앱이 앞으로 올 때마다 다시 읽는다. 읽기 전에는 null. */
export function useLockScreenSystem(): LockScreenSystemState | null {
	const system = useSyncExternalStore(
		appLockScreenStatus.subscribe,
		appLockScreenStatus.get
	);
	useEffect(() => {
		appLockScreenStatus.refresh().catch(() => undefined);
	}, []);
	return system;
}

export interface LockScreenState {
	readiness: LockScreenReadiness | null;
	system: LockScreenSystemState | null;
}

/** 잠금화면 안내가 이 기기에 뜰 수 있는지. 앱 설정, 알림 권한, 실시간 현황을 함께 본다. */
export function useLockScreenReadiness(): LockScreenState {
	const system = useLockScreenSystem();
	const [preferences] = usePreferences();
	return {
		readiness: lockScreenReadiness({
			inAppEnabled: preferences.commuteLiveActivityEnabled,
			platform: lockScreenPlatform,
			system,
		}),
		system,
	};
}

export interface LockScreenFixControl {
	action: LockScreenFix;
	pending: boolean;
	/** 고친다. 알림을 요청했으면 그 결과가 허용인지 돌려준다. */
	run: () => Promise<boolean>;
}

/**
 * 잠금화면 안내를 막는 것을 고치는 버튼. 알림은 묻고(이번에 거부되면 다음엔 설정 앱), 실시간 현황은
 * 설정 앱을, 앱에서 끈 경우는 설정 탭을 연다.
 */
export function useLockScreenFix(
	readiness: LockScreenReadiness | null,
	system: LockScreenSystemState | null
): LockScreenFixControl {
	const router = useRouter();
	const [requested, setRequested] = useState(false);
	const [pending, setPending] = useState(false);
	const action = lockScreenFixAction({
		platform: lockScreenPlatform,
		pushStatus: system?.pushStatus ?? "undetermined",
		readiness,
		requestedThisSession: requested,
	});
	const run = useCallback(async (): Promise<boolean> => {
		if (action === "openSettings") {
			openLockScreenSystemSettings();
			return false;
		}
		if (action === "openInAppSetting") {
			router.navigate("/settings");
			return false;
		}
		if (action !== "requestPermission") {
			return false;
		}
		setPending(true);
		try {
			const status = await requestLockScreenNotifications();
			setRequested(true);
			return status === "granted";
		} finally {
			setPending(false);
		}
	}, [action, router]);
	return { action, pending, run };
}
