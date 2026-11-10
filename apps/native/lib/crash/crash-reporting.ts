export type CrashEnvironment = "development" | "production";

export interface CrashReportingConfig {
	dsn: string;
	environment: CrashEnvironment;
}

/** 크래시 수집 도구(Sentry 등)를 감싼 최소 인터페이스. 테스트에서는 가짜로 바꾼다. */
export interface CrashSink {
	recordError: (error: Error, context?: string) => void;
	/** 설치 ID만 사용자 식별자로 남긴다(개인정보 없음). */
	setInstallId: (installId: string) => void;
	start: (config: CrashReportingConfig) => void;
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

/**
 * DSN이 있으면 개발·release 빌드 모두 수집하고, 환경 이름으로 둘을 나눈다. DSN이 없으면 `null`.
 */
export function resolveCrashReportingConfig(opts: {
	dsn: string | undefined;
	isDev: boolean;
}): CrashReportingConfig | null {
	const dsn = opts.dsn?.trim();
	if (!dsn) {
		return null;
	}
	return { dsn, environment: opts.isDev ? "development" : "production" };
}

/**
 * 수집 도구를 시작한다. 시작했으면 `true`. DSN이 없거나 시작에 실패해도 앱은 그대로 동작한다.
 */
export function configureCrashReporting(
	sink: CrashSink,
	opts: { dsn: string | undefined; isDev: boolean }
): boolean {
	const config = resolveCrashReportingConfig(opts);
	if (!config) {
		return false;
	}
	try {
		sink.start(config);
		return true;
	} catch {
		// 수집 도구가 시작하지 못해도 앱을 멈추게 해서는 안 된다.
		return false;
	}
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
