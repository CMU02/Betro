import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ClockIcon } from "lucide-react-native";
import { Fragment, useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import {
	RouteCompareRow,
	RouteSummaryRow,
} from "@/components/commute/route-compare-row";
import { SessionCard } from "@/components/commute/session-card";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ListDivider } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section";
import { TopBar } from "@/components/ui/top-bar";
import {
	type ActiveGuide,
	guideModel,
	guideTitle,
	type IdleGuide,
} from "@/lib/commute/guide-model";
import {
	useActiveSession,
	useEndSession,
	useEpochSeconds,
} from "@/lib/commute/use-active-session";
import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import { appPlaces } from "@/lib/places/app-places";
import { usePlaces } from "@/lib/places/use-places";

const NextClock = withUniwind(ClockIcon);

const CLOCK_ICON_SIZE = 16;
/** 홈 인디케이터 위 여백(Figma Content pb 16) */
const BOTTOM_GAP = 16;

interface ActiveContentProps {
	ending: boolean;
	guide: ActiveGuide;
	notice: MessageKey | null;
	onEnd: () => void;
}

/** 진행 중: 세션 카드 → 등록한 대안 비교 → "안내 종료"(Figma 29:33232). */
function ActiveContent({ ending, guide, notice, onEnd }: ActiveContentProps) {
	return (
		<>
			<SessionCard
				card={guide.card}
				cardBadge={guide.cardBadge}
				nextLegBadges={guide.nextLegBadges}
			/>
			{guide.others.length > 0 ? (
				<View className="gap-2">
					<Section title={t("commuteGuide.others.title")}>
						{guide.others.map((row, index) => (
							<Fragment key={row.rank}>
								{index > 0 ? <ListDivider inset="edge" /> : null}
								<RouteCompareRow row={row} />
							</Fragment>
						))}
					</Section>
					<AppText className="text-text-tertiary" variant="caption">
						{t("commuteGuide.others.note")}
					</AppText>
				</View>
			) : null}
			<View className="gap-2">
				{notice === null ? null : (
					<InlineNotice body={t(notice)} tone="alert" />
				)}
				<AppButton
					accessibilityState={{ busy: ending }}
					disabled={ending}
					label={t("commuteGuide.end")}
					onPress={onEnd}
					variant="ghost"
				/>
			</View>
		</>
	);
}

/** 세션 없음: 다음 안내 시각 → 등록한 경로 목록(Figma 100:20395). */
function IdleContent({ guide }: { guide: IdleGuide }) {
	return (
		<>
			<View className="gap-1 rounded-lg bg-bg-surface-raised p-4">
				<View className="flex-row items-center gap-1.5">
					<NextClock
						colorClassName="accent-icon-secondary"
						size={CLOCK_ICON_SIZE}
					/>
					<AppText className="text-text-secondary" variant="caption">
						{t("commuteGuide.next.label")}
					</AppText>
				</View>
				<AppText variant="bodyMStrong">{guide.next}</AppText>
			</View>
			<View className="gap-2">
				<Section title={t("commuteGuide.routes.title")}>
					{guide.routes.map((row, index) => (
						<Fragment key={row.rank}>
							{index > 0 ? <ListDivider inset="edge" /> : null}
							<RouteSummaryRow row={row} />
						</Fragment>
					))}
				</Section>
				<AppText className="text-text-tertiary" variant="caption">
					{t("commuteGuide.routes.note")}
				</AppText>
			</View>
		</>
	);
}

/**
 * 17 출퇴근 안내. 지도 없이 세션 카드, 등록한 경로끼리의 비교, "안내 종료"만 둔다.
 * 서버 값만 그리고, 받지 못하면 마지막 값 위에 "연결을 확인하고 있어요"를 보인다.
 */
export default function CommuteGuideScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { placeId } = useLocalSearchParams<{ placeId: string }>();
	const { places } = usePlaces(appPlaces);
	const place = places.find((entry) => entry.id === placeId);
	const { state } = useActiveSession({ enabled: place !== undefined });
	const { end, ending, notice } = useEndSession();
	const now = useEpochSeconds();
	const goBack = useCallback(() => router.back(), [router]);

	if (place === undefined) {
		return (
			<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
				<TopBar onBack={goBack} title={t("tabs.commute")} />
				<EmptyState body={t("places.empty.body")} title={t("notFound.title")} />
			</View>
		);
	}

	const guide = guideModel({
		now,
		place,
		session: state?.session ?? null,
		t,
		timezone: DEFAULT_TIMEZONE,
	});
	const handleEnd = () => {
		if (guide.kind === "active") {
			end(guide.sessionId).catch((error: unknown) => {
				reportError(appCrashSink, error, "commute-end");
			});
		}
	};

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={guideTitle(place, t)} />
			<ScrollView
				contentContainerClassName="gap-5 px-4 pt-2"
				contentContainerStyle={{ paddingBottom: insets.bottom + BOTTOM_GAP }}
			>
				{state?.checking ? (
					<InlineNotice body={t("commuteGuide.checking")} />
				) : null}
				{guide.kind === "active" ? (
					<ActiveContent
						ending={ending}
						guide={guide}
						notice={notice}
						onEnd={handleEnd}
					/>
				) : (
					<IdleContent guide={guide} />
				)}
			</ScrollView>
		</View>
	);
}
