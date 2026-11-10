import { cn } from "heroui-native";
import { BellIcon, MapPinIcon } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";
import {
	completeOnboarding,
	type PermissionButtonAction,
	type PermissionStatus,
	type PermissionsState,
	permissionButtonAction,
} from "@/lib/onboarding/onboarding";
import {
	getPermissionsState,
	requestLocationPermission,
	requestNotificationPermission,
} from "@/lib/permissions/permissions";
import { appPreferences } from "@/lib/preferences/app-preferences";

const StyledBellIcon = withUniwind(BellIcon);
const StyledMapPinIcon = withUniwind(MapPinIcon);

/**
 * iOS(12:3140)는 두 줄 설명, Android(12:4888)는 한 줄 설명을 쓰고
 * "설정에서 언제든…" 안내를 버튼 위로 내린다. 두 플랫폼 모두 그림 없이 제목부터 시작한다.
 */
const IS_ANDROID_LAYOUT = Platform.OS === "android";
/** 제목 시작: iOS는 상태 표시줄(54pt) 아래 32pt, Android는 상태 표시줄(40dp) 아래 128dp(화면 위 168). */
const CONTENT_GAP_BELOW_STATUS_BAR = IS_ANDROID_LAYOUT ? 128 : 32;
/** 마지막 버튼과 홈 인디케이터 사이 간격. */
const FOOTER_GAP_ABOVE_HOME_INDICATOR = 8;
/** 카드 아이콘: 배경 없는 24 상자 가운데의 20 아이콘. */
const CARD_ICON_SIZE = 20;

const INITIAL_STATE: PermissionsState = {
	location: "undetermined",
	notifications: "undetermined",
};

type PermissionKind = keyof PermissionsState;

const NOT_REQUESTED: Record<PermissionKind, boolean> = {
	location: false,
	notifications: false,
};

const REQUESTS: Record<PermissionKind, () => Promise<PermissionStatus>> = {
	location: requestLocationPermission,
	notifications: requestNotificationPermission,
};

/** 머리 설명. iOS는 Figma처럼 두 줄로 끊고, Android는 한 줄로 둔다. */
const INTRO_BODY_KEY = IS_ANDROID_LAYOUT
	? "permissions.intro.android.body"
	: "permissions.intro.ios.body";

/** Figma 02 권한의 머리(iOS 12:3176, Android 12:4903~12:4905): 제목과 설명, 사이 8. */
function Intro() {
	return (
		<View className="gap-2">
			<AppText accessibilityRole="header" variant="title1">
				{t("permissions.intro.title")}
			</AppText>
			<AppText className="text-text-secondary" variant="bodyM">
				{t(INTRO_BODY_KEY)}
			</AppText>
		</View>
	);
}

/** 카드 설명. iOS는 Figma처럼 두 줄로 끊고, Android는 한 줄로 둔다. */
const CARD_DESCRIPTION_KEYS = IS_ANDROID_LAYOUT
	? ({
			location: "permissions.purpose.android.location",
			notifications: "permissions.purpose.android.notifications",
		} as const)
	: ({
			location: "permissions.purpose.ios.location",
			notifications: "permissions.purpose.ios.notifications",
		} as const);

interface PermissionCardProps {
	action: PermissionButtonAction;
	description: string;
	icon: "location" | "notifications";
	onPress: () => void;
	pending: boolean;
	title: string;
}

/**
 * Figma `PermissionCard`(iOS 12:3180·12:3200, Android 12:4908·12:4923). 버튼은 두 카드 모두 Secondary라
 * 화면의 라임 채움은 하단 "계속"만 남는다. 허용되면 버튼이 "허용됨"으로 바뀌고 비활성이 된다.
 * 거부된 뒤에는 같은 "허용" 버튼이 설정 앱을 연다(시스템 창이 다시 뜨지 않으므로).
 */
function PermissionCard({
	action,
	description,
	icon,
	onPress,
	pending,
	title,
}: PermissionCardProps) {
	const granted = action === "none";
	const Icon = icon === "location" ? StyledMapPinIcon : StyledBellIcon;
	return (
		<View className="flex-row items-center gap-3 rounded-lg bg-bg-surface-raised p-4">
			<View className="size-6 items-center justify-center">
				<Icon colorClassName="accent-text-accent" size={CARD_ICON_SIZE} />
			</View>
			<View className="flex-1 gap-0.5">
				<AppText variant={IS_ANDROID_LAYOUT ? "bodyMStrong" : "title3"}>
					{title}
				</AppText>
				<AppText className="text-text-secondary" variant="bodyS">
					{description}
				</AppText>
			</View>
			<AppButton
				accessibilityHint={
					action === "openSettings"
						? t("permissions.row.openSettings", { title })
						: t("permissions.row.request", { title })
				}
				disabled={granted || pending}
				label={
					granted ? t("permissions.row.allowed") : t("permissions.row.allow")
				}
				onPress={onPress}
				size="medium"
				variant="secondary"
			/>
		</View>
	);
}

/** Figma 02 권한(12:3140). "계속"과 "나중에" 모두 온보딩을 끝내고 지도로 간다. */
export default function PermissionsScreen() {
	const insets = useSafeAreaInsets();
	const [permissions, setPermissions] =
		useState<PermissionsState>(INITIAL_STATE);
	const [pending, setPending] = useState<PermissionKind | null>(null);
	/** 이번 화면에서 시스템 창으로 요청했는지. 요청 뒤 거부면 다음 누름은 설정 앱으로 보낸다. */
	const [requested, setRequested] =
		useState<Record<PermissionKind, boolean>>(NOT_REQUESTED);

	/** 처음 열 때와 설정 앱에서 돌아올 때 현재 권한을 다시 읽는다. 창은 띄우지 않는다. */
	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			getPermissionsState()
				.then((state) => {
					if (!cancelled) {
						setPermissions(state);
					}
				})
				.catch(() => {
					// 상태를 못 읽으면 지금 표시를 그대로 둔다. 눌러서 다시 요청할 수 있다.
				});
		};
		refresh();
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				refresh();
			}
		});
		return () => {
			cancelled = true;
			subscription.remove();
		};
	}, []);

	const request = useCallback(async (kind: PermissionKind) => {
		setPending(kind);
		try {
			const status = await REQUESTS[kind]();
			setPermissions((previous) => ({ ...previous, [kind]: status }));
			setRequested((previous) => ({ ...previous, [kind]: true }));
		} catch {
			// 시스템 창을 띄우지 못해도 온보딩은 계속할 수 있다.
		} finally {
			setPending(null);
		}
	}, []);

	const locationAction = permissionButtonAction(
		permissions.location,
		requested.location
	);
	const notificationsAction = permissionButtonAction(
		permissions.notifications,
		requested.notifications
	);

	const press = useCallback(
		(kind: PermissionKind, action: PermissionButtonAction) => {
			if (action === "openSettings") {
				Linking.openSettings().catch(() => undefined);
				return;
			}
			if (action === "request") {
				request(kind).catch(() => undefined);
			}
		},
		[request]
	);
	const pressLocation = useCallback(() => {
		press("location", locationAction);
	}, [press, locationAction]);
	const pressNotifications = useCallback(() => {
		press("notifications", notificationsAction);
	}, [press, notificationsAction]);

	/**
	 * 권한 결과와 상관없이 온보딩을 끝낸다. 다시 켜도 권한 창은 뜨지 않는다.
	 * 화면 이동은 하지 않는다: 저장하면 루트의 `Stack.Protected` guard가 바뀌고 expo-router가 탭으로
	 * 보낸다. 같은 틱에 `router.replace`를 부르면 guard가 아직 닫혀 있어 처리되지 않는다.
	 */
	const finish = useCallback(() => {
		completeOnboarding(appPreferences);
	}, []);

	return (
		<View className="flex-1 bg-bg-canvas">
			<ScrollView
				contentContainerClassName={cn(
					"px-4",
					IS_ANDROID_LAYOUT ? "gap-8" : "gap-7"
				)}
				contentContainerStyle={{
					paddingTop: insets.top + CONTENT_GAP_BELOW_STATUS_BAR,
				}}
			>
				<Intro />
				<View className="gap-3">
					<PermissionCard
						action={locationAction}
						description={t(CARD_DESCRIPTION_KEYS.location)}
						icon="location"
						onPress={pressLocation}
						pending={pending === "location"}
						title={t("permissions.location.title")}
					/>
					<PermissionCard
						action={notificationsAction}
						description={t(CARD_DESCRIPTION_KEYS.notifications)}
						icon="notifications"
						onPress={pressNotifications}
						pending={pending === "notifications"}
						title={t("permissions.notifications.title")}
					/>
				</View>
				{IS_ANDROID_LAYOUT ? null : (
					<AppText className="text-center text-text-tertiary" variant="caption">
						{t("permissions.settingsHint")}
					</AppText>
				)}
			</ScrollView>
			<View
				className="gap-2 px-4 pt-4"
				style={{
					paddingBottom: insets.bottom + FOOTER_GAP_ABOVE_HOME_INDICATOR,
				}}
			>
				{IS_ANDROID_LAYOUT ? (
					<AppText
						className="mb-2 text-center text-text-tertiary"
						variant="caption"
					>
						{t("permissions.settingsHint")}
					</AppText>
				) : null}
				<AppButton label={t("permissions.continue")} onPress={finish} />
				<AppButton
					label={t("permissions.later")}
					onPress={finish}
					variant="ghost"
				/>
			</View>
		</View>
	);
}
