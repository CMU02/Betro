import DateTimePicker, {
	DateTimePickerAndroid,
	type DateTimePickerChangeEvent,
} from "@react-native-community/datetimepicker";
import { ClockIcon } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { useAppTheme } from "@/contexts/app-theme-context";
import { timeLabel } from "@/lib/places/place-card-model";
import { dateFromMinute, minuteFromDate } from "@/lib/places/setup-form-model";

const Clock = withUniwind(ClockIcon);

const ICON_SIZE = 20;
const IS_ANDROID = Platform.OS === "android";
/** iOS 시각 고르기를 24시간으로 보이게 하는 지역 설정. 화면 글자가 아니다. */
const IOS_24_HOUR_LOCALE = "en_GB";

export interface TimeRowProps {
	label: string;
	/** 하루 안의 분(0~1439) */
	minute: number;
	onChange: (minute: number) => void;
}

/**
 * Figma `TimeRow`(89:2324). 누르면 플랫폼 시각 고르기를 띄운다. Android는 시스템 대화상자,
 * iOS는 줄 아래에 펼쳐지는 휠이다. 값은 24시간 `HH:MM`이다.
 */
export function TimeRow({ label, minute, onChange }: TimeRowProps) {
	const { isDark } = useAppTheme();
	const [iosOpen, setIosOpen] = useState(false);
	const value = timeLabel(minute);

	const handleValue = useCallback(
		(_event: DateTimePickerChangeEvent, date: Date) => {
			onChange(minuteFromDate(date));
		},
		[onChange]
	);

	const handlePress = useCallback(() => {
		if (IS_ANDROID) {
			DateTimePickerAndroid.open({
				is24Hour: true,
				mode: "time",
				onValueChange: handleValue,
				value: dateFromMinute(minute, new Date()),
			});
			return;
		}
		setIosOpen((open) => !open);
	}, [handleValue, minute]);

	return (
		<View>
			<Pressable
				accessibilityLabel={label}
				accessibilityRole="button"
				accessibilityState={{ expanded: IS_ANDROID ? undefined : iosOpen }}
				accessibilityValue={{ text: value }}
				className="flex-row items-center gap-3 px-4 py-3 active:bg-bg-hover"
				onPress={handlePress}
			>
				<Clock colorClassName="accent-icon-primary" size={ICON_SIZE} />
				<AppText className="flex-1" variant="bodyMStrong">
					{label}
				</AppText>
				<View className="rounded-sm bg-bg-control px-3 py-1">
					<AppText variant="dataL">{value}</AppText>
				</View>
			</Pressable>
			{!IS_ANDROID && iosOpen ? (
				<DateTimePicker
					display="spinner"
					locale={IOS_24_HOUR_LOCALE}
					mode="time"
					onValueChange={handleValue}
					themeVariant={isDark ? "dark" : "light"}
					value={dateFromMinute(minute, new Date())}
				/>
			) : null}
		</View>
	);
}
