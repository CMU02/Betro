import { ChevronRightIcon } from "lucide-react-native";
import type { ComponentType } from "react";
import { Pressable, Switch, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { useAppTheme } from "@/contexts/app-theme-context";
import { colorToken } from "@/theme/tokens";

const StyledChevron = withUniwind(ChevronRightIcon);

const TILE_ICON_SIZE = 20;

export type ListRowTrailing =
	| { type: "chevron" }
	| { type: "none" }
	| { type: "toggle"; value: boolean; onChange: (value: boolean) => void }
	| { type: "value"; text: string };

/** `withUniwind`로 감싼 Lucide 아이콘. */
export type ListRowIcon = ComponentType<{
	colorClassName?: string;
	size?: number;
}>;

export interface ListRowProps {
	icon?: ListRowIcon;
	onPress?: () => void;
	subtitle?: string;
	title: string;
	trailing: ListRowTrailing;
}

function Trailing({
	title,
	trailing,
}: {
	title: string;
	trailing: ListRowTrailing;
}) {
	const { isDark } = useAppTheme();
	const mode = isDark ? "dark" : "light";
	switch (trailing.type) {
		case "chevron":
			return <StyledChevron colorClassName="accent-icon-secondary" size={20} />;
		case "value":
			return (
				<AppText className="text-text-secondary" variant="labelM">
					{trailing.text}
				</AppText>
			);
		case "toggle":
			return (
				<Switch
					accessibilityLabel={title}
					onValueChange={trailing.onChange}
					trackColor={{
						false: colorToken("bg/control", mode),
						true: colorToken("accent/primary", mode),
					}}
					value={trailing.value}
				/>
			);
		default:
			return null;
	}
}

/** Figma `ListRow`(6:219). 아이콘 타일, 제목·부제, 오른쪽 chevron/토글/값. */
export function ListRow({
	icon: Icon,
	onPress,
	subtitle,
	title,
	trailing,
}: ListRowProps) {
	const content = (
		<>
			{Icon ? (
				<View className="size-10 items-center justify-center rounded-md bg-bg-control">
					<Icon colorClassName="accent-icon-primary" size={TILE_ICON_SIZE} />
				</View>
			) : null}
			<View className="flex-1 gap-0.5">
				<AppText variant="bodyMStrong">{title}</AppText>
				{subtitle ? (
					<AppText className="text-text-secondary" variant="caption">
						{subtitle}
					</AppText>
				) : null}
			</View>
			<Trailing title={title} trailing={trailing} />
		</>
	);
	const className = "min-h-[60px] flex-row items-center gap-3 px-4 py-3";

	if (onPress) {
		return (
			<Pressable
				accessibilityRole="button"
				className={`${className} active:bg-bg-hover`}
				onPress={onPress}
			>
				{content}
			</Pressable>
		);
	}
	return <View className={className}>{content}</View>;
}

/** 카드 안 행 사이 구분선(아이콘 타일 너비만큼 들여쓴다). */
export function ListDivider() {
	return (
		<View className="pl-[68px]">
			<View className="h-px bg-border-subtle" />
		</View>
	);
}
