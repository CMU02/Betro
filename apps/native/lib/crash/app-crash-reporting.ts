import {
	crash,
	getCrashlytics,
	log,
	recordError,
	setAttribute,
	setCrashlyticsCollectionEnabled,
} from "@react-native-firebase/crashlytics";

import type { CrashSink } from "./crash-reporting";

function ignoreRejection(promise: Promise<unknown>): void {
	promise.catch(() => {
		// 속성·수집 설정 실패는 다음 실행에 다시 시도하므로 무시한다.
	});
}

/** Crashlytics를 감싼 기록 도구. `context`는 로그 한 줄과 JS 오류 이름으로 남긴다. */
export const appCrashSink: CrashSink = {
	recordError: (error, context) => {
		const crashlytics = getCrashlytics();
		if (context) {
			log(crashlytics, `context: ${context}`);
		}
		recordError(crashlytics, error, context);
	},
	setAttribute: (key, value) => {
		ignoreRejection(setAttribute(getCrashlytics(), key, value));
	},
	setCollectionEnabled: (enabled) => {
		ignoreRejection(setCrashlyticsCollectionEnabled(getCrashlytics(), enabled));
	},
};

/** 개발 빌드에서 네이티브 크래시를 일부러 일으킨다(설정의 "크래시 시험" 행). */
export function triggerTestCrash(): void {
	crash(getCrashlytics());
}
