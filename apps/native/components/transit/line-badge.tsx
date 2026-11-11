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

function textClassOf(colorToken: TransitTokenName | null): string {
	if (colorToken === null) {
		return "text-text-primary";
	}
	return DARK_TEXT_TOKENS.has(colorToken)
		? "text-text-on-accent"
		: "text-white";
}

/** Figma `BusBadge`(4:47). 배지 안은 항상 글자이고, 경기·인천은 옆에 지역 글자가 붙는다. */
export function LineBadge(props: LineBadgeInput) {
	const { colorToken, label, regionKey } = lineBadgeModel(props);
	const isNeutral = colorToken === null;
	return (
		<View className="flex-row items-center gap-1">
			<View
				className={cn(
					"h-[22px] min-w-10 items-center justify-center rounded-xs px-[7px]",
					isNeutral ? NEUTRAL_BG_CLASS : BG_CLASS[colorToken]
				)}
			>
				<AppText className={textClassOf(colorToken)} variant="caption">
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
