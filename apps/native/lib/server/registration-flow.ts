import type { RegisterResult } from "./register-install";

export interface RegistrationFlowDeps {
	/** 등록이 확인된 뒤 할 일(iOS 네이티브 모듈에 인증값 넘기기). 던지면 다음 실행에서 다시 한다. */
	onRegistered: () => Promise<void>;
	register: () => Promise<RegisterResult | "error">;
}

export interface RegistrationFlow {
	/** 등록과 그 뒤 할 일을 마쳤으면 true. 한 번 마치면 다시 부르지 않는다. */
	run: () => Promise<boolean>;
}

/**
 * 서버가 설치를 안 뒤에만 인증값을 넘긴다. 서버가 모르는 설치 ID로 토큰을 보내면 401만 받기 때문이다.
 * 실패하면 앱이 다시 앞으로 올 때 `run`을 불러 콜드 스타트 없이 다시 시도한다.
 */
export function createRegistrationFlow(
	deps: RegistrationFlowDeps
): RegistrationFlow {
	let done = false;
	let pending: Promise<boolean> | null = null;

	async function attempt(): Promise<boolean> {
		const result = await deps.register();
		if (result !== "registered" && result !== "already") {
			return false;
		}
		try {
			await deps.onRegistered();
		} catch {
			return false;
		}
		done = true;
		return true;
	}

	return {
		run() {
			if (done) {
				return Promise.resolve(true);
			}
			if (!pending) {
				pending = attempt().finally(() => {
					pending = null;
				});
			}
			return pending;
		},
	};
}
