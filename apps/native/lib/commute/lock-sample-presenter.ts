import { Platform } from "react-native";

import { t } from "@/lib/i18n/t";
import { CommuteActivity } from "@/modules/commute-activity";
import { CommuteNotification } from "@/modules/commute-notification";
import { ENV } from "@/src/env";
import { type LockSample, lockSampleState } from "./lock-samples";
import { lockScreenModel } from "./lock-screen-model";
import { notificationContent } from "./notification-content";

/** 표본을 띄우고 지우는 플랫폼 구현. */
export interface LockSamplePresenter {
	endAll: () => Promise<void>;
	show: (sample: LockSample, index: number) => Promise<void>;
}

/** 표본 Activity의 `planId`. 머리줄이 없어 "출퇴근"으로 보인다(`setPlanHeaders`는 부르지 않는다). */
const SAMPLE_PLAN_ID = "sample";

const iosPresenter: LockSamplePresenter = {
	endAll: () => CommuteActivity.endAll(),
	show: async (sample, index) => {
		await CommuteActivity.startLocal(
			{ planId: SAMPLE_PLAN_ID, sessionId: `sample-${index}` },
			lockSampleState(sample, Date.now() / 1000)
		);
	},
};

/**
 * Android는 표본마다 새 세션 ID로 알림 하나(ID 4101)를 덮어쓴다. 모듈은 끝난 세션을 다시 그리지 않으므로
 * 같은 ID를 다시 쓰지 않는다. 지우기는 마지막으로 띄운 세션을 끝낸다.
 */
function androidPresenter(): LockSamplePresenter | null {
	const notifier = CommuteNotification;
	if (notifier === null) {
		return null;
	}
	let lastSessionId: string | null = null;
	/** 같은 초에 두 번 눌러도 세션 ID가 겹치지 않게 붙인다(겹치면 모듈이 seq 1을 버린다). */
	let shown = 0;
	return {
		endAll: () => {
			if (lastSessionId !== null) {
				notifier.end(lastSessionId);
				lastSessionId = null;
			}
			return Promise.resolve();
		},
		show: (sample, index) => {
			const now = Date.now() / 1000;
			shown += 1;
			const sessionId = `sample-${index}-${Math.round(now)}-${shown}`;
			const model = lockScreenModel(lockSampleState(sample, now), {
				header: null,
				now,
				platform: "android",
				t,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			});
			notifier.show({
				channelName: t("commute.notification.channel"),
				content: notificationContent(model),
				endLabel: t("commute.lock.action.end"),
				seq: 1,
				sessionId,
			});
			lastSessionId = sessionId;
			return Promise.resolve();
		},
	};
}

function presenterFor(os: typeof Platform.OS): LockSamplePresenter | null {
	switch (os) {
		case "ios":
			return iosPresenter;
		case "android":
			return androidPresenter();
		default:
			return null;
	}
}

/** 이 플랫폼에서 표본을 띄우는 구현. 없으면 null이고 설정에 행이 보이지 않는다. */
export const lockSamplePresenter = presenterFor(Platform.OS);

/** `EXPO_PUBLIC_LOCK_SAMPLES`가 "1"이고 이 플랫폼에 구현이 있을 때만 설정에 행을 보인다. */
export const showLockSamples =
	ENV.EXPO_PUBLIC_LOCK_SAMPLES === "1" && lockSamplePresenter !== null;
