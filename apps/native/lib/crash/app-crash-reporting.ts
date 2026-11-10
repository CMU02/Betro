import {
	captureException,
	getClient,
	init,
	nativeCrash,
	setUser,
} from "@sentry/react-native";

import type { CrashSink } from "./crash-reporting";

/**
 * Sentry를 감싼 기록 도구. `context`는 태그로 남겨 Sentry에서 걸러 볼 수 있게 한다.
 * `start`가 불리지 않았으면(DSN 없음) Sentry 호출은 아무것도 보내지 않는다.
 */
export const appCrashSink: CrashSink = {
	recordError: (error, context) => {
		captureException(error, context ? { tags: { context } } : undefined);
	},
	setInstallId: (installId) => {
		setUser({ id: installId });
	},
	start: ({ dsn, environment }) => {
		init({
			dsn,
			enableAutoSessionTracking: true,
			environment,
			replaysOnErrorSampleRate: 0,
			replaysSessionSampleRate: 0,
			sendDefaultPii: false,
			tracesSampleRate: 0,
		});
	},
};

/** Sentry가 시작됐는지(DSN이 있어 `init`이 끝났는지). 설정의 "크래시 시험" 안내에 쓴다. */
export function isCrashReportingActive(): boolean {
	return getClient() !== undefined;
}

/** 개발 빌드의 "크래시 시험": JS 예외 하나를 Sentry로 보낸다(앱은 계속 동작). */
export function sendTestException(): void {
	captureException(new Error("Betro crash test: test exception"), {
		tags: { context: "crash-test" },
	});
}

/** 개발 빌드의 "크래시 시험": 네이티브 크래시를 일부러 일으킨다. 앱이 바로 종료된다. */
export function triggerNativeCrash(): void {
	nativeCrash();
}
