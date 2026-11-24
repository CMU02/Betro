import { cn } from "heroui-native";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/app-text";

export interface SegmentedOption {
	key: string;
	label: string;
}

export interface SegmentedProps {
	onChange: (key: string) => void;
	options: readonly SegmentedOption[];
	value: string;
}

interface SegmentProps {
	onChange: (key: string) => void;
	option: SegmentedOption;
	selected: boolean;
}

function Segment({ onChange, option, selected }: SegmentProps) {
	const press = useCallback(() => onChange(option.key), [onChange, option.key]);
	return (
		<Pressable
			accessibilityRole="tab"
			accessibilityState={{ selected }}
			className={cn(
				"flex-1 items-center justify-center rounded-full",
				selected ? "bg-bg-inverse" : "active:bg-bg-hover"
			)}
			onPress={press}
		>
			<AppText
				className={selected ? "text-text-inverse" : "text-text-secondary"}
				numberOfLines={1}
				variant="labelM"
			>
				{option.label}
			</AppText>
		</Pressable>
	);
}

/** Figma `Segmented`. 같은 폭으로 나눈 알약 안에서 하나를 고른다. 고른 칸은 `bg/inverse`. */
export function Segmented({ onChange, options, value }: SegmentedProps) {
	return (
		<View
			accessibilityRole="tablist"
			className="h-10 flex-row rounded-full bg-bg-control p-1"
		>
			{options.map((option) => (
				<Segment
					key={option.key}
					onChange={onChange}
					option={option}
					selected={option.key === value}
				/>
			))}
		</View>
	);
}
