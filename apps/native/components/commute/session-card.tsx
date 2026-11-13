import { ArrowRightLeftIcon, RouteIcon } from "lucide-react-native";
import { View } from "react-native";
import { withUniwind } from "uniwind";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { StatusTag } from "@/components/ui/status-tag";
import type { ActiveGuide } from "@/lib/commute/guide-model";
import type { LockScreenNextLeg } from "@/lib/commute/lock-screen-model";
import type { LineBadgeInput } from "@/lib/transit/line-badge-model";

const HeaderRoute = withUniwind(RouteIcon);

const SuggestionIcon = withUniwind(ArrowRightLeftIcon);

const HEADER_ICON_SIZE = 14;
const SUGGESTION_ICON_SIZE = 24;

/** Figma `NextLegRow`(114:1599): 작은 배지 + 승차 정류장과 시각. 마지막 줄 끝에 "외 N구간". */
function NextLegRows({
	badges,
	legs,
	more,
}: {
	badges: LineBadgeInput[];
	legs: LockScreenNextLeg[];
	more: string | null;
}) {
	if (legs.length === 0) {
		return null;
	}
	const lastIndex = legs.length - 1;
	return (
		<View className="gap-1">
			{legs.map((leg, index) => {
				const badge = badges[index];
				return (
					<View
						className="h-5 flex-row items-center gap-1.5"
						key={`${leg.lineName}-${leg.text}`}
					>
						{badge ? <LineBadge {...badge} size="s" /> : null}
						<AppText
							className="flex-1 text-text-secondary"
							numberOfLines={1}
							variant="labelM"
						>
							{leg.text}
						</AppText>
						{index === lastIndex && more !== null ? (
							<AppText className="text-text-secondary" variant="labelM">
								{more}
							</AppText>
						) : null}
					</View>
				);
			})}
		</View>
	);
}

export type SessionCardProps = Pick<
	ActiveGuide,
	"card" | "cardBadge" | "nextLegBadges"
>;

/**
 * 17의 세션 카드. Figma `LiveActivity`(87:2420)와 같은 위계: 머리줄과 상태 태그 → 배지와 상태 문장 →
 * 남은 분과 상세 → 남은 구간 줄(`NextLegRow`, 최대 2줄과 "외 N구간"). 제안이 있으면 남은 구간 줄 대신
 * 제안 상자(Figma 18 대안 제안 49:18832의 `Suggestion`)가 보인다.
 * 버튼은 카드 밖에 둔다.
 */
export function SessionCard({
	card,
	cardBadge,
	nextLegBadges,
}: SessionCardProps) {
	return (
		<View className="gap-1 rounded-2xl bg-bg-surface-raised p-4">
			<View className="flex-row items-center gap-1.5">
				<HeaderRoute
					colorClassName="accent-icon-secondary"
					size={HEADER_ICON_SIZE}
				/>
				<AppText
					className="flex-1 text-text-secondary"
					numberOfLines={1}
					variant="caption"
				>
					{card.header}
				</AppText>
				<StatusTag kind={card.tag} label={card.tagLabel} />
			</View>
			<View className="gap-2">
				<View>
					<View className="flex-row items-center gap-1.5">
						<LineBadge {...cardBadge} />
						<AppText
							accessibilityLiveRegion="polite"
							className="flex-1"
							numberOfLines={1}
							variant="title1"
						>
							{card.status}
						</AppText>
					</View>
					<View className="flex-row items-center gap-2">
						{card.minutes === null ? null : (
							<AppText variant="title3">{card.minutes}</AppText>
						)}
						<AppText
							className="flex-1 text-text-secondary"
							numberOfLines={1}
							variant="bodyM"
						>
							{card.detail}
						</AppText>
					</View>
				</View>
				{card.suggestion === null ? (
					<NextLegRows
						badges={nextLegBadges}
						legs={card.nextLegs}
						more={card.moreLegs}
					/>
				) : (
					<View className="min-h-9 flex-row items-center gap-2 rounded-lg bg-bg-control px-3 py-2">
						<SuggestionIcon
							colorClassName="accent-icon-primary"
							size={SUGGESTION_ICON_SIZE}
						/>
						<AppText className="flex-1" numberOfLines={2} variant="labelS">
							{card.suggestion}
						</AppText>
					</View>
				)}
			</View>
		</View>
	);
}
