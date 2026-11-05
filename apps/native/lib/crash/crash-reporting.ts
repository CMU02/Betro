/** 크래시 수집 도구(Crashlytics 등)를 감싼 최소 인터페이스. 테스트에서는 가짜로 바꾼다. */
export interface CrashSink {
	recordError: (error: Error, context?: string) => void;
	setAttribute: (key: string, value: string) => void;
	setCollectionEnabled: (enabled: boolean) => void;
}

function describeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		// undefined·함수는 JSON.stringify가 undefined를 돌려준다(타입은 string이라고 말하지만).
		const json: string | undefined = JSON.stringify(value);
		return json === undefined ? String(value) : json;
	} catch {
		// 순환 참조 등으로 직렬화할 수 없으면 문자열 변환으로 대신한다.
		return String(value);
	}
}

/** throw된 값이 무엇이든 `Error`로 바꾼다. 이미 `Error`면 그대로 돌려준다. */
export function toError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(describeValue(value));
}

/** 개발 빌드에서는 수집을 끄고, release 빌드에서만 켠다. */
export function configureCrashReporting(
	sink: CrashSink,
	opts: { isDev: boolean }
): void {
	sink.setCollectionEnabled(!opts.isDev);
}

/** 오류를 기록한다. 기록 도구가 실패해도 호출부로 예외를 올리지 않는다. */
export function reportError(
	sink: CrashSink,
	value: unknown,
	context: string
): void {
	try {
		sink.recordError(toError(value), context);
	} catch {
		// 오류 기록 실패가 앱을 멈추게 해서는 안 된다.
	}
}
