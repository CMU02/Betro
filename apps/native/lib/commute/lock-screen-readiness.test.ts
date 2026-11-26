import { describe, expect, it } from "bun:test";

import { t } from "../i18n/t";
import type { Place } from "../places/places";
import {
	type LockScreenSystemState,
	lockScreenFixAction,
	lockScreenPromptModel,
	lockScreenReadiness,
	shouldOfferLockScreenPrompt,
	systemBlock,
} from "./lock-screen-readiness";

const ALL_ON: LockScreenSystemState = {
	activitiesEnabled: true,
	pushStatus: "granted",
};

describe("lockScreenReadiness", () => {
	it("is ready when everything is on", () => {
		for (const platform of ["ios", "android"] as const) {
			expect(
				lockScreenReadiness({ inAppEnabled: true, platform, system: ALL_ON })
			).toBe("ready");
		}
	});

	it("is unknown until the system state has been read", () => {
		expect(
			lockScreenReadiness({ inAppEnabled: true, platform: "ios", system: null })
		).toBeNull();
	});

	it("puts the in-app setting before any system state", () => {
		expect(
			lockScreenReadiness({
				inAppEnabled: false,
				platform: "android",
				system: { activitiesEnabled: false, pushStatus: "denied" },
			})
		).toBe("disabledInApp");
		expect(
			lockScreenReadiness({
				inAppEnabled: false,
				platform: "ios",
				system: null,
			})
		).toBe("disabledInApp");
	});

	it("on Android needs notification permission (FCM drives the ongoing notification)", () => {
		for (const pushStatus of ["denied", "undetermined"] as const) {
			expect(
				lockScreenReadiness({
					inAppEnabled: true,
					platform: "android",
					system: { activitiesEnabled: false, pushStatus },
				})
			).toBe("notificationsOff");
		}
	});

	it("on iOS needs only Live Activities, not notification permission", () => {
		expect(
			lockScreenReadiness({
				inAppEnabled: true,
				platform: "ios",
				system: { activitiesEnabled: true, pushStatus: "denied" },
			})
		).toBe("ready");
		expect(
			lockScreenReadiness({
				inAppEnabled: true,
				platform: "ios",
				system: { activitiesEnabled: false, pushStatus: "granted" },
			})
		).toBe("activitiesOff");
	});
});

describe("systemBlock", () => {
	it("ignores the in-app setting so the settings row can show the system state", () => {
		expect(
			systemBlock("android", { activitiesEnabled: true, pushStatus: "denied" })
		).toBe("notificationsOff");
		expect(systemBlock("ios", ALL_ON)).toBeNull();
		expect(systemBlock("ios", null)).toBeNull();
	});
});

describe("lockScreenFixAction", () => {
	it("does nothing when ready or unknown", () => {
		expect(
			lockScreenFixAction({
				platform: "android",
				pushStatus: "granted",
				readiness: "ready",
				requestedThisSession: false,
			})
		).toBe("none");
		expect(
			lockScreenFixAction({
				platform: "android",
				pushStatus: "denied",
				readiness: null,
				requestedThisSession: false,
			})
		).toBe("none");
	});

	it("sends the in-app off state to the setting", () => {
		expect(
			lockScreenFixAction({
				platform: "ios",
				pushStatus: "granted",
				readiness: "disabledInApp",
				requestedThisSession: false,
			})
		).toBe("openInAppSetting");
	});

	it("opens the system settings for Live Activities (nothing to request)", () => {
		expect(
			lockScreenFixAction({
				platform: "ios",
				pushStatus: "granted",
				readiness: "activitiesOff",
				requestedThisSession: false,
			})
		).toBe("openSettings");
	});

	it("asks first on Android and opens settings after a refusal this session", () => {
		const base = {
			platform: "android",
			pushStatus: "denied",
			readiness: "notificationsOff",
		} as const;
		expect(lockScreenFixAction({ ...base, requestedThisSession: false })).toBe(
			"requestPermission"
		);
		expect(lockScreenFixAction({ ...base, requestedThisSession: true })).toBe(
			"openSettings"
		);
	});

	it("on iOS a denial is final, so it goes straight to settings", () => {
		const base = {
			platform: "ios",
			readiness: "notificationsOff",
			requestedThisSession: false,
		} as const;
		expect(lockScreenFixAction({ ...base, pushStatus: "denied" })).toBe(
			"openSettings"
		);
		expect(lockScreenFixAction({ ...base, pushStatus: "undetermined" })).toBe(
			"requestPermission"
		);
	});
});

describe("shouldOfferLockScreenPrompt", () => {
	it("offers only when the system blocks guidance the user wants", () => {
		expect(shouldOfferLockScreenPrompt("notificationsOff")).toBe(true);
		expect(shouldOfferLockScreenPrompt("activitiesOff")).toBe(true);
		expect(shouldOfferLockScreenPrompt("ready")).toBe(false);
		expect(shouldOfferLockScreenPrompt("disabledInApp")).toBe(false);
		expect(shouldOfferLockScreenPrompt(null)).toBe(false);
	});
});

function workPlace(overrides: Partial<Place> = {}): Place {
	return {
		busMeta: {},
		id: "work",
		kind: "work",
		name: "",
		plan: {
			enabled: true,
			planId: "plan-1",
			routes: [],
			schedule: {
				days: [1, 2, 3, 4, 5],
				includeHolidays: false,
				leadMinutes: 10,
				leaveMinute: 8 * 60 + 10,
				timezone: "Asia/Seoul",
			},
		},
		sync: "synced",
		updatedAt: 1,
		...overrides,
	};
}

describe("lockScreenPromptModel", () => {
	it("names the commute and the departure for the notification ask", () => {
		expect(lockScreenPromptModel(workPlace(), "notificationsOff", t)).toEqual({
			body: "알림을 켜면 나가는 시각 10분 전부터 잠금화면에 떠요",
			primary: "알림 받기",
			title: "평일 08:10 회사 가는 길, 잠금화면에 도착 정보를 띄워드릴게요",
		});
	});

	it("points to Live Activities in settings when those are off", () => {
		const model = lockScreenPromptModel(workPlace(), "activitiesOff", t);
		expect(model.primary).toBe("설정 열기");
		expect(model.body).toBe(
			"설정에서 실시간 현황을 켜면 나가는 시각 10분 전부터 잠금화면에 떠요"
		);
	});

	it("uses the name of an other place", () => {
		const model = lockScreenPromptModel(
			workPlace({ kind: "other", name: "헬스장" }),
			"notificationsOff",
			t
		);
		expect(model.title).toBe(
			"평일 08:10 헬스장 가는 길, 잠금화면에 도착 정보를 띄워드릴게요"
		);
	});
});
