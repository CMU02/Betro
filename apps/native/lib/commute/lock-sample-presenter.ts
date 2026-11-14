import { Platform } from "react-native";

import { CommuteActivity } from "@/modules/commute-activity";
import { ENV } from "@/src/env";

import { type LockSample, lockSampleState } from "./lock-samples";

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

function presenterFor(os: typeof Platform.OS): LockSamplePresenter | null {
	switch (os) {
		case "ios":
			return iosPresenter;
		// Android 진행 중 알림 모듈이 생기면 여기에 같은 모양의 구현을 더한다.
		default:
			return null;
	}
}

/** 이 플랫폼에서 표본을 띄우는 구현. 없으면 null이고 설정에 행이 보이지 않는다. */
export const lockSamplePresenter = presenterFor(Platform.OS);

/** `EXPO_PUBLIC_LOCK_SAMPLES`가 "1"이고 이 플랫폼에 구현이 있을 때만 설정에 행을 보인다. */
export const showLockSamples =
	ENV.EXPO_PUBLIC_LOCK_SAMPLES === "1" && lockSamplePresenter !== null;
