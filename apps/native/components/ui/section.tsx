import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";

export interface SectionProps {
	children: ReactNode;
	title: string;
}

/** 구역 머리와 둥근 카드. 설정 화면과 장소 화면이 함께 쓴다. */
export function Section({ children, title }: SectionProps) {
	return (
		<View className="gap-2">
			<AppText className="text-text-secondary" variant="labelS">
				{title}
			</AppText>
			<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
				{children}
			</View>
		</View>
	);
}
