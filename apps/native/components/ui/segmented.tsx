import { cn } from "heroui-native";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import {
	SEGMENT_BASE_CLASS,
	SEGMENT_IDLE_LABEL_CLASS,
	SEGMENT_LABEL_VARIANT,
	SEGMENT_SELECTED_CLASS,
	SEGMENT_SELECTED_LABEL_CLASS,
	SEGMENTED_CLASS,
} from "@/components/ui/segmented-style";
import { ELEVATION } from "@/theme/tokens";

export interface SegmentedOption {
	key: string;
	label: string;
}

export interface SegmentedProps {
	accessibilityLabel?: string;
	onChange: (key: string) => void;
	options: readonly SegmentedOption[];
	/** 탭이면 `tab`, 설정처럼 단일 선택 묶음이면 `radio`. */
	role?: "radio" | "tab";
	value: string;
}

interface SegmentProps {
	onChange: (key: string) => void;
	option: SegmentedOption;
	role: "radio" | "tab";
	selected: boolean;
}

/** 고른 칸은 `Elevation/1 Floating` 그림자로 떠 있다. */
const SELECTED_SEGMENT_STYLE = { boxShadow: ELEVATION.floating } as const;

function Segment({ onChange, option, role, selected }: SegmentProps) {
	const press = useCallback(() => onChange(option.key), [onChange, option.key]);
	return (
		<Pressable
			accessibilityRole={role}
			accessibilityState={
				role === "radio" ? { checked: selected } : { selected }
			}
			className={cn(SEGMENT_BASE_CLASS, selected && SEGMENT_SELECTED_CLASS)}
			onPress={press}
			style={selected ? SELECTED_SEGMENT_STYLE : undefined}
		>
			<AppText
				className={
					selected ? SEGMENT_SELECTED_LABEL_CLASS : SEGMENT_IDLE_LABEL_CLASS
				}
				numberOfLines={1}
				variant={SEGMENT_LABEL_VARIANT}
			>
				{option.label}
			</AppText>
		</Pressable>
	);
}

/** Figma `Segmented`. 같은 폭으로 나눈 칸 중 하나를 고른다. */
export function Segmented({
	accessibilityLabel,
	onChange,
	options,
	role = "tab",
	value,
}: SegmentedProps) {
	return (
		<View
			accessibilityLabel={accessibilityLabel}
			accessibilityRole={role === "radio" ? "radiogroup" : "tablist"}
			className={SEGMENTED_CLASS}
		>
			{options.map((option) => (
				<Segment
					key={option.key}
					onChange={onChange}
					option={option}
					role={role}
					selected={option.key === value}
				/>
			))}
		</View>
	);
}
