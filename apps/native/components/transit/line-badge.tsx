import { cn } from "heroui-native";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";
import {
	type LineBadgeInput,
	lineBadgeModel,
} from "@/lib/transit/line-badge-model";
import type { TransitTokenName } from "@/theme/tokens";

/** Tailwind가 클래스를 찾을 수 있게 토큰마다 전체 이름을 적는다. */
const BG_CLASS: Record<TransitTokenName, string> = {
	"bus/airport": "bg-transit-bus-airport",
	"bus/branch": "bg-transit-bus-branch",
	"bus/circular": "bg-transit-bus-circular",
	"bus/express": "bg-transit-bus-express",
	"bus/trunk": "bg-transit-bus-trunk",
	"bus/village": "bg-transit-bus-village",
	"line/1": "bg-transit-line-1",
	"line/2": "bg-transit-line-2",
	"line/3": "bg-transit-line-3",
	"line/4": "bg-transit-line-4",
	"line/5": "bg-transit-line-5",
	"line/6": "bg-transit-line-6",
	"line/7": "bg-transit-line-7",
	"line/8": "bg-transit-line-8",
	"line/9": "bg-transit-line-9",
	"line/airport": "bg-transit-line-airport",
	"line/gtx-a": "bg-transit-line-gtx-a",
	"line/gyeongchun": "bg-transit-line-gyeongchun",
	"line/gyeongui-jungang": "bg-transit-line-gyeongui-jungang",
	"line/sinbundang": "bg-transit-line-sinbundang",
	"line/suin-bundang": "bg-transit-line-suin-bundang",
	"line/ui-sinseol": "bg-transit-line-ui-sinseol",
};

/** 밝은 배경색이라 어두운 글자를 쓰는 토큰(Figma 순환 배지와 같은 규칙). */
const DARK_TEXT_TOKENS: ReadonlySet<TransitTokenName> = new Set([
	"bus/circular",
	"line/9",
	"line/gyeongui-jungang",
	"line/suin-bundang",
	"line/ui-sinseol",
]);

const NEUTRAL_BG_CLASS = "bg-bg-control";

/**
 * 노선색 배경의 흰 글자. Figma `BusBadge` 라벨(4:36)과 `LegBadge · S` 라벨(114:1591)은 의미 변수가 아닌
 * 원시 변수 `--primitive-neutral-0`(#ffffff, 두 테마 같음)에 묶여 있고, tokens.ts는 원시 변수를 두지 않는다.
 */
const ON_TRANSIT_TEXT_CLASS = "text-white";

function textClassOf(colorToken: TransitTokenName | null): string {
	if (colorToken === null) {
		return "text-text-primary";
	}
	return DARK_TEXT_TOKENS.has(colorToken)
		? "text-text-on-accent"
		: ON_TRANSIT_TEXT_CLASS;
}

/** "m"은 22pt 배지(Figma `BusBadge`), "s"는 한 줄 20pt 행에 들어가는 16pt 배지(Figma `LegBadge · S` 114:1598). */
export type LineBadgeSize = "m" | "s";

const CONTAINER_BY_SIZE: Record<LineBadgeSize, string> = {
	m: "h-[22px] min-w-10 px-[7px]",
	s: "h-4 px-1.5",
};

export type LineBadgeProps = LineBadgeInput & { size?: LineBadgeSize };

/** Figma `BusBadge`(4:47). 배지 안은 항상 글자이고, 경기·인천은 옆에 지역 글자가 붙는다. */
export function LineBadge({ size = "m", ...input }: LineBadgeProps) {
	const { colorToken, label, regionKey } = lineBadgeModel(input);
	const isNeutral = colorToken === null;
	return (
		<View className="flex-row items-center gap-1">
			<View
				className={cn(
					"items-center justify-center rounded-xs",
					CONTAINER_BY_SIZE[size],
					isNeutral ? NEUTRAL_BG_CLASS : BG_CLASS[colorToken]
				)}
			>
				<AppText
					className={textClassOf(colorToken)}
					variant={size === "s" ? "micro" : "caption"}
				>
					{label}
				</AppText>
			</View>
			{regionKey ? (
				<AppText className="text-text-secondary" variant="caption">
					{t(regionKey)}
				</AppText>
			) : null}
		</View>
	);
}
