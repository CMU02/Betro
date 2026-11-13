import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";

export interface EmptyStateProps {
	/** 버튼 같은 행동. 없으면 안내만 보인다. */
	action?: ReactNode;
	body: string;
	/** 아이콘(타일 없이 40pt). */
	icon?: ReactNode;
	title: string;
}

/** Figma `EmptyState`(92:2349). 아이콘 + 제목 + 설명 + 선택 행동. */
export function EmptyState({ action, body, icon, title }: EmptyStateProps) {
	return (
		<View className="items-center gap-3 px-6 py-8">
			{icon}
			<AppText className="text-center" variant="title3">
				{title}
			</AppText>
			<AppText className="text-center text-text-secondary" variant="bodyS">
				{body}
			</AppText>
			{action ? (
				<View className="mt-2 items-center self-stretch">{action}</View>
			) : null}
		</View>
	);
}
