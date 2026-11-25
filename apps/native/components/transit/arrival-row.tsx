import { ChevronRightIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { StatusTag } from "@/components/ui/status-tag";
import type { StatusKind } from "@/lib/legal/data-sources";

const Chevron = withUniwind(ChevronRightIcon);

const CHEVRON_SIZE = 20;

export interface ArrivalRowProps {
	/** 오른쪽 큰 글자("3분", "약 5분", "배차 약 8분"). */
	eta: string;
	/** 앞의 노선 배지. */
	leading?: ReactNode;
	/** 누르면 상세로 가는 행이면 넘긴다. 있으면 끝에 화살표가 붙는다. */
	onPress?: () => void;
	status: { kind: StatusKind; label: string };
	/** 둘째 줄(정거장 수·열차 번호 등). 없으면 그리지 않는다. */
	subtitle?: string;
	/** 방면 같은 첫 줄. */
	title: string;
}

/** Figma `ArrivalRow`. 높이 64, 왼쪽에 배지와 방면, 오른쪽에 도착 글자와 `StatusTag`. */
export function ArrivalRow({
	eta,
	leading,
	onPress,
	status,
	subtitle,
	title,
}: ArrivalRowProps) {
	const content = (
		<>
			{leading}
			<View className="flex-1 gap-0.5">
				<AppText numberOfLines={1} variant="bodyMStrong">
					{title}
				</AppText>
				{subtitle ? (
					<AppText
						className="text-text-secondary"
						numberOfLines={1}
						variant="caption"
					>
						{subtitle}
					</AppText>
				) : null}
			</View>
			<View className="items-end gap-0.5">
				{eta === "" ? null : <AppText variant="bodyMStrong">{eta}</AppText>}
				<StatusTag kind={status.kind} label={status.label} />
			</View>
			{onPress ? (
				<Chevron colorClassName="accent-icon-secondary" size={CHEVRON_SIZE} />
			) : null}
		</>
	);
	const rowClassName = "min-h-16 flex-row items-center gap-3 px-4 py-2";
	if (onPress === undefined) {
		return <View className={rowClassName}>{content}</View>;
	}
	return (
		<Pressable
			accessibilityRole="button"
			className={`${rowClassName} active:bg-bg-hover`}
			onPress={onPress}
		>
			{content}
		</Pressable>
	);
}
