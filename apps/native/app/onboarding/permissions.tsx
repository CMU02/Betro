import { useRouter } from "expo-router";
import { BellIcon, LocateFixedIcon, MapPinIcon } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import {
	completeOnboarding,
	type PermissionStatus,
	type PermissionsState,
} from "@/lib/onboarding/onboarding";
import {
	getPermissionsState,
	requestLocationPermission,
	requestNotificationPermission,
} from "@/lib/permissions/permissions";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { colorToken } from "@/theme/tokens";

const StyledBellIcon = withUniwind(BellIcon);
const StyledLocateFixedIcon = withUniwind(LocateFixedIcon);
const StyledMapPinIcon = withUniwind(MapPinIcon);

/** 상태 표시줄(54pt) 아래 32pt에서 본문이 시작한다. */
const CONTENT_GAP_BELOW_STATUS_BAR = 32;
/** 마지막 버튼과 홈 인디케이터 사이 간격. */
const FOOTER_GAP_ABOVE_HOME_INDICATOR = 8;
const BADGE_ICON_SIZE = 20;
const CORE_ICON_SIZE = 26;
/** Figma 효과 `Glow/Accent`: accent/primary 55% 불투명, 반경 18. */
const ACCENT_GLOW_ALPHA_HEX = "8c";
const CORE_GLOW_STYLE = {
	boxShadow: `0 0 18px 0 ${colorToken("accent/primary", "dark")}${ACCENT_GLOW_ALPHA_HEX}`,
} as const;

const INITIAL_STATE: PermissionsState = {
	location: "undetermined",
	notifications: "undetermined",
};

type PermissionKind = keyof PermissionsState;

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

interface PermissionCardProps {
	description: string;
	emphasized: boolean;
	icon: "location" | "notifications";
	onRequest: () => void;
	pending: boolean;
	status: PermissionStatus;
	title: string;
}

/** Figma `PermissionCard`(12:3180, 12:3200). 허용되면 버튼이 "허용됨"으로 바뀌고 비활성이 된다. */
function PermissionCard({
	description,
	emphasized,
	icon,
	onRequest,
	pending,
	status,
	title,
}: PermissionCardProps) {
	const granted = status === "granted";
	const Icon = icon === "location" ? StyledMapPinIcon : StyledBellIcon;
	return (
		<View className="flex-row items-center gap-3 rounded-lg bg-bg-surface-raised p-4">
			<View className="size-11 items-center justify-center rounded-md bg-accent-soft">
				<Icon colorClassName="accent-text-accent" size={BADGE_ICON_SIZE} />
			</View>
			<View className="flex-1 gap-0.5">
				<AppText variant="title3">{title}</AppText>
				<AppText className="text-text-secondary" variant="bodyS">
					{description}
				</AppText>
			</View>
			<AppButton
				accessibilityHint={`${title} 권한을 요청해요`}
				disabled={granted || pending}
				label={granted ? "허용됨" : "허용"}
				onPress={onRequest}
				size="medium"
				variant={emphasized && !granted ? "primary" : "secondary"}
			/>
		</View>
	);
}

/** Figma 02 권한(12:3140). "계속"과 "나중에" 모두 온보딩을 끝내고 지도로 간다. */
export default function PermissionsScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const [permissions, setPermissions] =
		useState<PermissionsState>(INITIAL_STATE);
	const [pending, setPending] = useState<PermissionKind | null>(null);

	useEffect(() => {
		let cancelled = false;
		getPermissionsState()
			.then((state) => {
				if (!cancelled) {
					setPermissions(state);
				}
			})
			.catch(() => {
				// 상태를 못 읽으면 두 카드 모두 "허용"으로 둔다. 눌러서 다시 요청할 수 있다.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const request = useCallback(async (kind: PermissionKind) => {
		setPending(kind);
		try {
			const status = await REQUESTS[kind]();
			setPermissions((previous) => ({ ...previous, [kind]: status }));
		} catch {
			// 시스템 창을 띄우지 못해도 온보딩은 계속할 수 있다.
		} finally {
			setPending(null);
		}
	}, []);

	const requestLocation = useCallback(() => {
		request("location").catch(() => undefined);
	}, [request]);
	const requestNotifications = useCallback(() => {
		request("notifications").catch(() => undefined);
	}, [request]);

	/** 권한 결과와 상관없이(`canSkipToApp`) 온보딩을 끝낸다. 다시 켜도 권한 창은 뜨지 않는다. */
	const finish = useCallback(() => {
		completeOnboarding(appPreferences);
		router.replace("/");
	}, [router]);

	/** Figma처럼 아직 허용하지 않은 첫 카드의 버튼만 강조한다. */
	const emphasizeLocation = permissions.location !== "granted";

	return (
		<View className="flex-1 bg-bg-canvas">
			<ScrollView
				contentContainerClassName="gap-7 px-4"
				contentContainerStyle={{
					paddingTop: insets.top + CONTENT_GAP_BELOW_STATUS_BAR,
				}}
			>
				<Illustration />
				<View className="gap-2">
					<AppText accessibilityRole="header" variant="title1">
						{"더 정확한 안내를 위해\n권한이 필요해요"}
					</AppText>
					<AppText className="text-text-secondary" variant="bodyM">
						{
							"꼭 필요한 두 가지만 요청해요.\n허용하지 않아도 지도는 그대로 볼 수 있어요."
						}
					</AppText>
				</View>
				<View className="gap-3">
					<PermissionCard
						description={"내 주변 역과 정류장을\n바로 보여줘요"}
						emphasized={emphasizeLocation}
						icon="location"
						onRequest={requestLocation}
						pending={pending === "location"}
						status={permissions.location}
						title="위치"
					/>
					<PermissionCard
						description={"출퇴근 시간에 잠금화면에\n도착 정보를 띄워요"}
						emphasized={!emphasizeLocation}
						icon="notifications"
						onRequest={requestNotifications}
						pending={pending === "notifications"}
						status={permissions.notifications}
						title="알림"
					/>
				</View>
				<AppText className="text-center text-text-tertiary" variant="caption">
					설정에서 언제든 바꿀 수 있어요
				</AppText>
			</ScrollView>
			<View
				className="gap-2 px-4 pt-4"
				style={{
					paddingBottom: insets.bottom + FOOTER_GAP_ABOVE_HOME_INDICATOR,
				}}
			>
				<AppButton label="계속" onPress={finish} />
				<AppButton label="나중에" onPress={finish} variant="ghost" />
			</View>
		</View>
	);
}
