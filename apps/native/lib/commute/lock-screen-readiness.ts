import type { MessageKey, MessageParams } from "../i18n/translate";
import {
	type PermissionStatus,
	permissionButtonAction,
} from "../onboarding/onboarding";
import { daysLabel, timeLabel } from "../places/place-card-model";
import type { Place } from "../places/places";
import { placeNameOf } from "../places/plan-headers";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export type LockScreenPlatform = "ios" | "android";

/**
 * 잠금화면 출퇴근 안내가 이 기기에 뜰 수 있는지.
 * - `notificationsOff`: Android 알림 권한이 없다(FCM 데이터 메시지로 그리는 진행 중 알림이 안 보이고,
 *   권한이 없으면 FCM 토큰도 서버에 올리지 않는다).
 * - `activitiesOff`: iOS 설정에서 이 앱의 실시간 현황(Live Activities)이 꺼져 있다.
 * - `disabledInApp`: iOS에서 앱 설정의 "출퇴근 잠금화면 안내"를 껐다. 올리는 예약이 `enabled: false`라 서버가
 *   세션을 열지 않으므로 잠금화면뿐 아니라 앱 안 실시간 안내도 시작되지 않는다(시작 푸시는 기기에서 막을 수
 *   없어 서버 변경 없이 끄려고 고른 방식).
 * - `lockScreenOffInApp`: Android에서 같은 설정을 껐다. 서버 세션은 그대로 열려 앱 안 안내는 오고, 진행 중
 *   알림만 기기가 그리지 않는다(`handleCommuteMessage`).
 */
export type LockScreenReadiness =
	| "ready"
	| "notificationsOff"
	| "activitiesOff"
	| "disabledInApp"
	| "lockScreenOffInApp";

/** 시스템이 막는 경우만. */
export type LockScreenSystemBlock = "notificationsOff" | "activitiesOff";

/** 창 없이 읽은 시스템 상태. */
export interface LockScreenSystemState {
	/** iOS `ActivityAuthorizationInfo().areActivitiesEnabled`. Android에서는 쓰지 않는다. */
	activitiesEnabled: boolean;
	pushStatus: PermissionStatus;
}

export interface ReadinessInput {
	inAppEnabled: boolean;
	platform: LockScreenPlatform;
	/** 아직 읽지 못했으면 null. */
	system: LockScreenSystemState | null;
}

/**
 * 시스템이 잠금화면 안내를 막는지. 앱 설정은 보지 않는다(설정 행이 시스템 상태를 따로 보인다).
 * iOS는 실시간 현황만 본다. Apple 문서(Displaying live data with Live Activities)는 Live Activity를
 * 막는 것으로 설정의 실시간 현황(`areActivitiesEnabled`)만 들고 알림 권한은 말하지 않는다. 기기에서
 * 알림을 끈 채 시작 푸시가 뜨는지는 아직 확인하지 않았다.
 */
export function systemBlock(
	platform: LockScreenPlatform,
	system: LockScreenSystemState | null
): LockScreenSystemBlock | null {
	if (system === null) {
		return null;
	}
	if (platform === "ios") {
		return system.activitiesEnabled ? null : "activitiesOff";
	}
	return system.pushStatus === "granted" ? null : "notificationsOff";
}

/**
 * 서버에 올리는 예약의 `enabled`. iOS는 시작 푸시를 기기에서 막을 수 없어 설정을 그대로 따르고(끄면 세션이
 * 열리지 않아 앱 안 안내도 멈춘다), Android는 진행 중 알림을 기기가 거르므로 늘 켜 둬 앱 안 안내를 지킨다.
 */
export function serverGuidanceEnabled(
	platform: LockScreenPlatform,
	inAppEnabled: boolean
): boolean {
	return platform === "ios" ? inAppEnabled : true;
}

/** 앱 설정을 먼저 본다(끈 사람에게 시스템 권한을 켜라고 하지 않는다). 시스템 상태를 모르면 null. */
export function lockScreenReadiness(
	input: ReadinessInput
): LockScreenReadiness | null {
	if (!input.inAppEnabled) {
		return input.platform === "ios" ? "disabledInApp" : "lockScreenOffInApp";
	}
	if (input.system === null) {
		return null;
	}
	return systemBlock(input.platform, input.system) ?? "ready";
}

/** 고치는 버튼이 할 일. */
export type LockScreenFix =
	| "requestPermission"
	| "openSettings"
	| "enableInApp"
	| "none";

export interface FixInput {
	platform: LockScreenPlatform;
	pushStatus: PermissionStatus;
	readiness: LockScreenReadiness | null;
	/** 이번에 화면에서 시스템 창으로 요청했는지. */
	requestedThisSession: boolean;
}

/**
 * 실시간 현황은 앱이 요청할 수 없어 설정 앱을 연다. 알림은 iOS 거부가 늘 영구라 바로 설정 앱으로 보내고,
 * Android는 온보딩과 같이 먼저 요청하고 이번에 거부되면 설정 앱으로 보낸다(묻기 전에도 "denied"라서).
 */
export function lockScreenFixAction(input: FixInput): LockScreenFix {
	switch (input.readiness) {
		case "disabledInApp":
		case "lockScreenOffInApp":
			return "enableInApp";
		case "activitiesOff":
			return "openSettings";
		case "notificationsOff": {
			if (input.platform === "ios") {
				return input.pushStatus === "undetermined"
					? "requestPermission"
					: "openSettings";
			}
			const action = permissionButtonAction(
				input.pushStatus,
				input.requestedThisSession
			);
			if (action === "none") {
				return "none";
			}
			return action === "openSettings" ? "openSettings" : "requestPermission";
		}
		default:
			return "none";
	}
}

/** 장소를 저장한 뒤 시트를 띄울지. 사용자가 앱에서 끈 경우와 이미 되는 경우에는 띄우지 않는다. */
export function shouldOfferLockScreenPrompt(
	readiness: LockScreenReadiness | null
): readiness is LockScreenSystemBlock {
	return readiness === "notificationsOff" || readiness === "activitiesOff";
}

export interface LockScreenPromptModel {
	body: string;
	/** 주 버튼 글자. 알림은 "알림 받기", 실시간 현황은 "설정 열기". */
	primary: string;
	/** "평일 08:10 회사 가는 길, 잠금화면에 도착 정보를 띄워드릴게요" */
	title: string;
}

/** 저장한 장소 이름과 나가는 시각으로 잠금화면 안내의 쓸모를 말한다. */
export function lockScreenPromptModel(
	place: Place,
	block: LockScreenSystemBlock,
	t: Translate
): LockScreenPromptModel {
	const { days, leadMinutes, leaveMinute } = place.plan.schedule;
	return {
		body: t(`lockScreen.prompt.body.${block}`, { m: leadMinutes }),
		primary: t(
			block === "notificationsOff"
				? "lockScreen.prompt.allow"
				: "lockScreen.prompt.openSettings"
		),
		title: t("lockScreen.prompt.title", {
			days: daysLabel(days, t),
			leave: timeLabel(leaveMinute),
			name: placeNameOf(place, t),
		}),
	};
}

/** 잠금화면 안내가 뜨지 않는 경우. 아직 모르면 false(경고가 잠깐 깜빡이지 않게). */
export function isLockScreenBlocked(
	readiness: LockScreenReadiness | null
): readiness is Exclude<LockScreenReadiness, "ready"> {
	return readiness !== null && readiness !== "ready";
}

/** 고치는 버튼 글자. 할 일이 없으면 버튼이 없다. */
export function fixLabelKey(action: LockScreenFix): MessageKey | null {
	switch (action) {
		case "requestPermission":
			return "lockScreen.fix.requestPermission";
		case "openSettings":
			return "lockScreen.fix.openSettings";
		case "enableInApp":
			return "lockScreen.fix.enableInApp";
		default:
			return null;
	}
}

export interface LockScreenSettingsRow {
	/** 토글 아래 고치는 행 제목. 고칠 것이 없으면(토글을 꺼 둠) null */
	fixKey: MessageKey | null;
	/** 토글 행 부제 */
	subtitleKey: MessageKey;
}

/**
 * 설정의 "출퇴근 잠금화면 안내" 행. 토글은 켜져 있는데 시스템이 막으면 부제로 알리고, 누르면 고치는 행을
 * 하나 더 둔다(토글 행은 누르면 토글되므로). 꺼 두면 무엇이 멈췄는지 부제로만 알린다(iOS는 앱 안 안내까지,
 * Android는 잠금화면 알림만). iOS는 끄기 전에도 앱 안 안내까지 멈춘다고 부제로 알린다.
 * Android에서 켜져 있고 시스템이 허용하면 null.
 */
export function lockScreenSettingsRow(
	platform: LockScreenPlatform,
	inAppEnabled: boolean,
	block: LockScreenSystemBlock | null
): LockScreenSettingsRow | null {
	if (!inAppEnabled) {
		return {
			fixKey: null,
			subtitleKey:
				platform === "ios"
					? "lockScreen.settings.disabled"
					: "lockScreen.settings.disabledLockScreenOnly",
		};
	}
	if (block === null) {
		return platform === "ios"
			? { fixKey: null, subtitleKey: "lockScreen.settings.stopsInApp" }
			: null;
	}
	return block === "notificationsOff"
		? {
				fixKey: "lockScreen.settings.fixNotifications",
				subtitleKey: "lockScreen.settings.notificationsOff",
			}
		: {
				fixKey: "lockScreen.settings.fixActivities",
				subtitleKey: "lockScreen.settings.activitiesOff",
			};
}
