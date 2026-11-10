import { cn } from "heroui-native";
import {
	BellIcon,
	LocateFixedIcon,
	MapPinIcon,
	ShieldCheckIcon,
} from "lucide-react-native";
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
import { withAlpha } from "@/theme/tokens";

const StyledBellIcon = withUniwind(BellIcon);
const StyledLocateFixedIcon = withUniwind(LocateFixedIcon);
const StyledMapPinIcon = withUniwind(MapPinIcon);
const StyledShieldCheckIcon = withUniwind(ShieldCheckIcon);

/**
 * iOS(12:3140)는 원 세 겹 그림과 두 줄 설명, Android(12:4888)는 방패 아이콘 타일과 한 줄 설명을 쓰고
 * "설정에서 언제든…" 안내를 버튼 위로 내린다.
 */
const IS_ANDROID_LAYOUT = Platform.OS === "android";
/** 본문 시작: iOS는 상태 표시줄(54pt) 아래 32pt, Android는 상태 표시줄(40dp) 아래 128dp(화면 위 168). */
const CONTENT_GAP_BELOW_STATUS_BAR = IS_ANDROID_LAYOUT ? 128 : 32;
const SHIELD_ICON_SIZE = 32;
/** 마지막 버튼과 홈 인디케이터 사이 간격. */
const FOOTER_GAP_ABOVE_HOME_INDICATOR = 8;
const BADGE_ICON_SIZE = 20;
const CORE_ICON_SIZE = 26;
/** Figma 효과 `Glow/Accent`: accent/primary 55% 불투명, 반경 18. */
const ACCENT_GLOW_OPACITY = 0.55;
const CORE_GLOW_STYLE = {
	boxShadow: `0 0 18px 0 ${withAlpha("accent/primary", "dark", ACCENT_GLOW_OPACITY)}`,
} as const;

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

/** Figma `Illustration`(12:3153): 168pt 원 세 겹, 가운데 라임 원, 위치·알림 배지. */
function Illustration() {
	return (
		<View
			className="h-[168px] items-center"
			importantForAccessibility="no-hide-descendants"
		>
			<View className="size-[168px]">
				<View className="absolute inset-0 rounded-full bg-accent-soft opacity-35" />
				<View className="absolute top-[22px] left-[22px] size-[124px] rounded-full bg-accent-soft opacity-60" />
				<View className="absolute top-[42px] left-[42px] size-[84px] rounded-full bg-accent-soft" />
				<View
					className="absolute top-14 left-14 size-14 items-center justify-center rounded-full bg-accent-primary"
					style={CORE_GLOW_STYLE}
				>
					<StyledLocateFixedIcon
						colorClassName="accent-text-on-accent"
						size={CORE_ICON_SIZE}
					/>
				</View>
				<View className="absolute top-[18px] left-[136px] size-10 items-center justify-center rounded-full border border-border-subtle bg-bg-surface-raised">
					<StyledMapPinIcon
						colorClassName="accent-text-accent"
						size={BADGE_ICON_SIZE}
					/>
				</View>
				<View className="absolute top-[110px] -left-2 size-10 items-center justify-center rounded-full border border-border-subtle bg-bg-surface-raised">
					<StyledBellIcon
						colorClassName="accent-text-accent"
						size={BADGE_ICON_SIZE}
					/>
				</View>
			</View>
		</View>
	);
}

/** Figma Android 02 권한의 머리(12:4897~12:4905): 64dp 방패 타일, 제목, 한 줄 설명. */
function AndroidIntro() {
	return (
		<View className="gap-6">
			<View className="size-16 items-center justify-center rounded-xl bg-accent-soft">
				<StyledShieldCheckIcon
					colorClassName="accent-text-accent"
					size={SHIELD_ICON_SIZE}
				/>
			</View>
			<View className="gap-2">
				<AppText accessibilityRole="header" variant="title1">
					{t("permissions.intro.title")}
				</AppText>
				<AppText className="text-text-secondary" variant="bodyM">
					{t("permissions.intro.android.body")}
				</AppText>
			</View>
		</View>
	);
}

function IosIntro() {
	return (
		<>
			<Illustration />
			<View className="gap-2">
				<AppText accessibilityRole="header" variant="title1">
					{t("permissions.intro.title")}
				</AppText>
				<AppText className="text-text-secondary" variant="bodyM">
					{t("permissions.intro.ios.body")}
				</AppText>
			</View>
		</>
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
	emphasized: boolean;
	icon: "location" | "notifications";
	onPress: () => void;
	pending: boolean;
	title: string;
}

/**
 * Figma `PermissionCard`(12:3180, 12:3200). 허용되면 버튼이 "허용됨"으로 바뀌고 비활성이 된다.
 * 거부된 뒤에는 같은 "허용" 버튼이 설정 앱을 연다(시스템 창이 다시 뜨지 않으므로).
 */
function PermissionCard({
	action,
	description,
	emphasized,
	icon,
	onPress,
	pending,
	title,
}: PermissionCardProps) {
	const granted = action === "none";
	const Icon = icon === "location" ? StyledMapPinIcon : StyledBellIcon;
	return (
		<View className="flex-row items-center gap-3 rounded-lg bg-bg-surface-raised p-4">
			<View
				className={cn(
					"items-center justify-center rounded-md bg-accent-soft",
					IS_ANDROID_LAYOUT ? "size-10" : "size-11"
				)}
			>
				<Icon colorClassName="accent-text-accent" size={BADGE_ICON_SIZE} />
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
				variant={emphasized && !granted ? "primary" : "secondary"}
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

	/** Figma처럼 아직 허용하지 않은 첫 카드의 버튼만 강조한다. */
	const emphasizeLocation = permissions.location !== "granted";

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
				{IS_ANDROID_LAYOUT ? <AndroidIntro /> : <IosIntro />}
				<View className="gap-3">
					<PermissionCard
						action={locationAction}
						description={t(CARD_DESCRIPTION_KEYS.location)}
						emphasized={emphasizeLocation}
						icon="location"
						onPress={pressLocation}
						pending={pending === "location"}
						title={t("permissions.location.title")}
					/>
					<PermissionCard
						action={notificationsAction}
						description={t(CARD_DESCRIPTION_KEYS.notifications)}
						emphasized={!emphasizeLocation}
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
