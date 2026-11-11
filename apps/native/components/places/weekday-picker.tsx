import { cn } from "heroui-native";
import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";

/** 월요일부터 일요일까지. `day`는 0 일요일 ~ 6 토요일이다. */
const WEEKDAYS: readonly { day: number; key: MessageKey }[] = [
	{ day: 1, key: "places.day.mon" },
	{ day: 2, key: "places.day.tue" },
	{ day: 3, key: "places.day.wed" },
	{ day: 4, key: "places.day.thu" },
	{ day: 5, key: "places.day.fri" },
	{ day: 6, key: "places.day.sat" },
	{ day: 0, key: "places.day.sun" },
];

interface WeekdayProps {
	day: number;
	label: string;
	onToggle: (day: number) => void;
	selected: boolean;
}

/** Figma `Weekday`(89:2308). 선택된 요일은 `bg/inverse` + `text/inverse`다. */
const Weekday = memo(function WeekdayButton({
	day,
	label,
	onToggle,
	selected,
}: WeekdayProps) {
	const handlePress = useCallback(() => onToggle(day), [day, onToggle]);
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="checkbox"
			accessibilityState={{ checked: selected }}
			className={cn(
				"size-10 items-center justify-center rounded-full",
				selected ? "bg-bg-inverse" : "bg-bg-control active:bg-bg-hover"
			)}
			hitSlop={4}
			onPress={handlePress}
		>
			<AppText
				className={selected ? "text-text-inverse" : "text-text-secondary"}
				variant="labelM"
			>
				{label}
			</AppText>
		</Pressable>
	);
});

export interface WeekdayPickerProps {
	days: number[];
	onToggle: (day: number) => void;
}

/** Figma `WeekdayPicker`(89:2309). 월~일 요일을 켜고 끈다. */
export function WeekdayPicker({ days, onToggle }: WeekdayPickerProps) {
	return (
		<View
			accessibilityLabel={t("placeSetup.weekdays")}
			className="flex-row items-center justify-between"
		>
			{WEEKDAYS.map(({ day, key }) => (
				<Weekday
					day={day}
					key={day}
					label={t(key)}
					onToggle={onToggle}
					selected={days.includes(day)}
				/>
			))}
		</View>
	);
}
