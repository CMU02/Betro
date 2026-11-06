import type {
	AuthorizationStatus,
	RemoteMessage,
} from "@react-native-firebase/messaging";

import type { PermissionStatus } from "@/lib/onboarding/onboarding";

/** FCM payload normalised for app code: every field present, data values always strings. */
export interface PushMessage {
	body: string | null;
	data: Record<string, string>;
	id: string | null;
	sentAt: number | null;
	title: string | null;
}

/** Union of the numeric statuses Firebase exports as the `AuthorizationStatus` const. */
export type PushAuthorizationStatus =
	(typeof AuthorizationStatus)[keyof typeof AuthorizationStatus];

const AUTHORIZED_STATUSES: ReadonlySet<PushAuthorizationStatus> =
	new Set<PushAuthorizationStatus>([
		1, // AUTHORIZED
		2, // PROVISIONAL (iOS quiet delivery)
		3, // EPHEMERAL (App Clips)
	]);

export function isPushAuthorized(status: PushAuthorizationStatus): boolean {
	return AUTHORIZED_STATUSES.has(status);
}

/** NOT_DETERMINED(-1) */
const NOT_DETERMINED_STATUS: PushAuthorizationStatus = -1;

/** Firebase 권한 상태를 앱의 세 가지 권한 상태로 바꾼다. */
export function toPermissionStatus(
	status: PushAuthorizationStatus
): PermissionStatus {
	if (isPushAuthorized(status)) {
		return "granted";
	}
	return status === NOT_DETERMINED_STATUS ? "undetermined" : "denied";
}

export function toPushMessage(message: RemoteMessage): PushMessage {
	const data: Record<string, string> = {};
	for (const [key, value] of Object.entries(message.data ?? {})) {
		data[key] = typeof value === "string" ? value : JSON.stringify(value);
	}
	return {
		body: message.notification?.body ?? null,
		data,
		id: message.messageId ?? null,
		sentAt: message.sentTime ?? null,
		title: message.notification?.title ?? null,
	};
}
