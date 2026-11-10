import { requireOptionalNativeModule } from "expo";

import type { ContentState } from "@/lib/commute/content-state";

export interface CommuteActivityCredentials {
	installId: string;
	secret: string;
	serverUrl: string;
}

export interface CommuteActivityAttributes {
	planId: string;
	sessionId: string;
}

interface CommuteActivityNativeModule {
	areActivitiesEnabled: () => boolean;
	endAll: () => Promise<void>;
	setCredentials: (input: CommuteActivityCredentials) => Promise<void>;
	setPlanHeaders: (headers: Record<string, string>) => Promise<void>;
	startLocal: (
		attributes: CommuteActivityAttributes,
		state: Record<string, unknown>
	) => Promise<string>;
}

/** iOS 전용 모듈. Android에서는 없으므로 null이다. */
const NativeModule =
	requireOptionalNativeModule<CommuteActivityNativeModule>("CommuteActivity");

/** null인 필드는 빼서 넘긴다. Swift 쪽 옵셔널은 키가 없으면 nil로 디코딩된다. */
function withoutNulls(state: ContentState): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(state)) {
		if (value !== null) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * iOS Live Activity 제어. 토큰 보고는 네이티브(`CommuteTokenReporter`)가 JS 없이 한다.
 * Android에서는 `startLocal`만 거부하고 나머지는 아무것도 하지 않는다.
 */
export const CommuteActivity = {
	areActivitiesEnabled: (): boolean =>
		NativeModule?.areActivitiesEnabled() ?? false,
	endAll: async (): Promise<void> => {
		await NativeModule?.endAll();
	},
	/** 설치 ID, 비밀값, 서버 주소를 모듈 전용 키체인 항목에 둔다. */
	setCredentials: async (input: CommuteActivityCredentials): Promise<void> => {
		await NativeModule?.setCredentials(input);
	},
	/** `planId` → 머리줄. 앱 그룹 `UserDefaults`에 두고 위젯 확장이 읽는다. */
	setPlanHeaders: async (headers: Record<string, string>): Promise<void> => {
		await NativeModule?.setPlanHeaders(headers);
	},
	/** 표본 화면 확인용. `__DEV__`에서만 부른다. */
	startLocal: async (
		attributes: CommuteActivityAttributes,
		state: ContentState
	): Promise<string> => {
		if (!NativeModule) {
			throw new Error("CommuteActivity is only available on iOS");
		}
		return await NativeModule.startLocal(attributes, withoutNulls(state));
	},
};
