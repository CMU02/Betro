import { MinusIcon, PlusIcon } from "lucide-react-native";
import { useCallback } from "react";
import { type AccessibilityActionEvent, Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";

const Minus = withUniwind(MinusIcon);
const Plus = withUniwind(PlusIcon);

const ICON_SIZE = 16;
const ADJUST_ACTIONS = [{ name: "increment" }, { name: "decrement" }];

export interface StepperProps {
	/** 접근성 이름("첫 승차까지 도보" 등). 값 앞에 읽힌다. */
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	value: number;
}

/** Figma `Stepper`(89:2293). − 값 +, 1 단위로 min~max 안에서만 바뀐다. */
export function Stepper({ label, max, min, onChange, value }: StepperProps) {
	const canDecrease = value > min;
	const canIncrease = value < max;
	const decrease = useCallback(() => {
		if (canDecrease) {
			onChange(value - 1);
		}
	}, [canDecrease, onChange, value]);
	const increase = useCallback(() => {
		if (canIncrease) {
			onChange(value + 1);
		}
	}, [canIncrease, onChange, value]);
	const handleAction = useCallback(
		(event: AccessibilityActionEvent) => {
			if (event.nativeEvent.actionName === "increment") {
				increase();
			} else if (event.nativeEvent.actionName === "decrement") {
				decrease();
			}
		},
		[decrease, increase]
	);
	const valueText = t("common.minutes", { m: value });
	return (
		<View
			accessibilityActions={ADJUST_ACTIONS}
			accessibilityLabel={label}
			accessibilityRole="adjustable"
			accessibilityValue={{ max, min, now: value, text: valueText }}
			accessible
			className="flex-row items-center gap-1"
			onAccessibilityAction={handleAction}
		>
			<Pressable
				accessibilityElementsHidden
				className={
					canDecrease
						? "size-8 items-center justify-center rounded-full bg-bg-control active:bg-bg-hover"
						: "size-8 items-center justify-center rounded-full bg-bg-control opacity-40"
				}
				disabled={!canDecrease}
				importantForAccessibility="no"
				onPress={decrease}
			>
				<Minus colorClassName="accent-icon-primary" size={ICON_SIZE} />
			</Pressable>
			<AppText className="w-11 text-center" variant="dataM">
				{valueText}
			</AppText>
			<Pressable
				accessibilityElementsHidden
				className={
					canIncrease
						? "size-8 items-center justify-center rounded-full bg-bg-control active:bg-bg-hover"
						: "size-8 items-center justify-center rounded-full bg-bg-control opacity-40"
				}
				disabled={!canIncrease}
				importantForAccessibility="no"
				onPress={increase}
			>
				<Plus colorClassName="accent-icon-primary" size={ICON_SIZE} />
			</Pressable>
		</View>
	);
}
