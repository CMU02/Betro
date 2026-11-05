import { cn } from "heroui-native";
import { useCallback } from "react";
import { Platform, Pressable, Switch } from "react-native";
import Animated, {
	useAnimatedStyle,
	withTiming,
} from "react-native-reanimated";

import { useAppTheme } from "@/contexts/app-theme-context";
import { colorToken, ELEVATION, TOGGLE_KNOB_COLOR } from "@/theme/tokens";

/** Figma `Toggle`(4:125): 51×31 트랙, 2pt 안쪽 여백, 27pt 손잡이. */
const TRACK_WIDTH = 51;
const KNOB_SIZE = 27;
const TRACK_PADDING = 2;
const KNOB_TRAVEL = TRACK_WIDTH - KNOB_SIZE - TRACK_PADDING * 2;
const KNOB_ANIMATION_MS = 150;
const KNOB_STYLE = {
	backgroundColor: TOGGLE_KNOB_COLOR,
	boxShadow: ELEVATION.toggleKnob,
} as const;

export interface ToggleProps {
	accessibilityLabel: string;
	onChange: (value: boolean) => void;
	value: boolean;
}

/**
 * Android의 기본 Switch는 Figma보다 작고 손잡이 모양이 달라 같은 크기로 직접 그린다.
 * iOS는 Figma 모양과 같은 시스템 Switch를 쓴다.
 */
function AndroidToggle({ accessibilityLabel, onChange, value }: ToggleProps) {
	const handlePress = useCallback(() => onChange(!value), [onChange, value]);
	const knobStyle = useAnimatedStyle(() => ({
		transform: [
			{
				translateX: withTiming(value ? KNOB_TRAVEL : 0, {
					duration: KNOB_ANIMATION_MS,
				}),
			},
		],
	}));
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel}
			accessibilityRole="switch"
			accessibilityState={{ checked: value }}
			className={cn(
				"h-[31px] w-[51px] justify-center rounded-full p-0.5",
				value ? "bg-accent-primary" : "bg-bg-control"
			)}
			hitSlop={8}
			onPress={handlePress}
		>
			<Animated.View
				className="size-[27px] rounded-full"
				style={[KNOB_STYLE, knobStyle]}
			/>
		</Pressable>
	);
}

function IosToggle({ accessibilityLabel, onChange, value }: ToggleProps) {
	const { isDark } = useAppTheme();
	const mode = isDark ? "dark" : "light";
	return (
		<Switch
			accessibilityLabel={accessibilityLabel}
			ios_backgroundColor={colorToken("bg/control", mode)}
			onValueChange={onChange}
			thumbColor={TOGGLE_KNOB_COLOR}
			trackColor={{
				false: colorToken("bg/control", mode),
				true: colorToken("accent/primary", mode),
			}}
			value={value}
		/>
	);
}

/** Figma `Toggle`(4:125). */
export function Toggle(props: ToggleProps) {
	return Platform.OS === "android" ? (
		<AndroidToggle {...props} />
	) : (
		<IosToggle {...props} />
	);
}
