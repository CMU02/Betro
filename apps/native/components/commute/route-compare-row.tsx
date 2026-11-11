import { View } from "react-native";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { StatusTag } from "@/components/ui/status-tag";
import type { GuideCompareRow, GuideRouteRow } from "@/lib/commute/guide-model";

/**
 * Figma `RouteCompareRow`(93:2367). 등록한 대안 하나: 첫 구간 배지, 노선과 상태 태그, 정류장,
 * 도착 예상과 기본 경로와의 차이. 추천 표시는 없다.
 */
export function RouteCompareRow({ row }: { row: GuideCompareRow }) {
	const [badge] = row.badge;
	return (
		<View className="flex-row items-center gap-3 px-4 py-3">
			{badge ? <LineBadge {...badge} /> : null}
			<View className="flex-1 gap-0.5">
				<View className="flex-row items-center gap-2">
					<AppText className="shrink" numberOfLines={1} variant="bodyMStrong">
						{row.title}
					</AppText>
					<StatusTag kind={row.tag} label={row.tagLabel} />
				</View>
				<AppText
					className="text-text-secondary"
					numberOfLines={2}
					variant="caption"
				>
					{row.stops}
				</AppText>
			</View>
			{row.arrival === null ? null : (
				<View className="items-end gap-0.5">
					<AppText variant="bodyMStrong">{row.arrival}</AppText>
					{row.diff === null ? null : (
						<AppText className="text-text-secondary" variant="caption">
							{row.diff}
						</AppText>
					)}
				</View>
			)}
		</View>
	);
}

/** 세션이 없을 때 등록한 경로 한 줄(Figma 17 세션 없음 100:20395의 `Route` 줄). */
export function RouteSummaryRow({ row }: { row: GuideRouteRow }) {
	const [badge] = row.badge;
	return (
		<View className="flex-row items-center gap-3 px-4 py-3">
			{badge ? <LineBadge {...badge} /> : null}
			<View className="flex-1 gap-0.5">
				<AppText variant="bodyM">{row.summary}</AppText>
				<AppText className="text-text-secondary" variant="caption">
					{row.label}
				</AppText>
			</View>
		</View>
	);
}
