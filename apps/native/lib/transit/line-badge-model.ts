import type { MessageKey } from "@/lib/i18n/translate";
import type { TransitTokenName } from "@/theme/tokens";

export type BusRegion = "seoul" | "gyeonggi" | "incheon";

export type LineBadgeInput =
	| { mode: "bus"; routeType: string; region: BusRegion; name: string }
	| { mode: "subway"; line: string; name: string };

export interface LineBadgeModel {
	colorToken: TransitTokenName;
	/** 배지 안의 글자. 색만으로 구분하지 않도록 항상 비어 있지 않다. */
	label: string;
	/** 경기·인천 노선 옆에 붙는 지역 글자. 서울은 null. */
	regionKey: MessageKey | null;
}

const EMPTY_LABEL = "-";
const DEFAULT_BUS_COLOR: TransitTokenName = "bus/trunk";
/** 모르는 지하철 노선은 중립에 가까운 아이콘색 대신 기존 토큰 하나로 둔다. */
const DEFAULT_SUBWAY_COLOR: TransitTokenName = "line/1";
const SUBWAY_KEY_PREFIX = "seoul-subway:";

/** 서울 버스 API의 routeType. 7 인천, 8 경기는 광역 색에 지역 글자를 붙인다. */
const BUS_COLOR_BY_ROUTE_TYPE: Record<string, TransitTokenName> = {
	"1": "bus/airport",
	"2": "bus/village",
	"3": "bus/trunk",
	"4": "bus/branch",
	"5": "bus/circular",
	"6": "bus/express",
	"7": "bus/express",
	"8": "bus/express",
};

const REGION_KEY_BY_ROUTE_TYPE: Record<string, MessageKey> = {
	"7": "transit.region.incheon",
	"8": "transit.region.gyeonggi",
};

const REGION_KEY_BY_REGION: Record<BusRegion, MessageKey | null> = {
	gyeonggi: "transit.region.gyeonggi",
	incheon: "transit.region.incheon",
	seoul: null,
};

/** `LineKey`(transit-static)와 subwayId 두 가지 모두 받는다. */
const SUBWAY_COLOR_BY_LINE: Record<string, TransitTokenName> = {
	"1001": "line/1",
	"1002": "line/2",
	"1003": "line/3",
	"1004": "line/4",
	"1005": "line/5",
	"1006": "line/6",
	"1007": "line/7",
	"1008": "line/8",
	"1009": "line/9",
	"1032": "line/gtx-a",
	"1063": "line/gyeongui-jungang",
	"1065": "line/airport",
	"1067": "line/gyeongchun",
	"1075": "line/suin-bundang",
	"1077": "line/sinbundang",
	"1092": "line/ui-sinseol",
	airport: "line/airport",
	"gtx-a": "line/gtx-a",
	gyeongchun: "line/gyeongchun",
	"gyeongui-jungang": "line/gyeongui-jungang",
	line1: "line/1",
	line2: "line/2",
	line3: "line/3",
	line4: "line/4",
	line5: "line/5",
	line6: "line/6",
	line7: "line/7",
	line8: "line/8",
	line9: "line/9",
	shinbundang: "line/sinbundang",
	"suin-bundang": "line/suin-bundang",
	"ui-sinseol": "line/ui-sinseol",
};

function labelOf(name: string): string {
	const trimmed = name.trim();
	return trimmed === "" ? EMPTY_LABEL : trimmed;
}

export function lineBadgeModel(input: LineBadgeInput): LineBadgeModel {
	if (input.mode === "bus") {
		return {
			colorToken: BUS_COLOR_BY_ROUTE_TYPE[input.routeType] ?? DEFAULT_BUS_COLOR,
			label: labelOf(input.name),
			regionKey:
				REGION_KEY_BY_ROUTE_TYPE[input.routeType] ??
				REGION_KEY_BY_REGION[input.region],
		};
	}
	const key = input.line.startsWith(SUBWAY_KEY_PREFIX)
		? input.line.slice(SUBWAY_KEY_PREFIX.length)
		: input.line;
	return {
		colorToken: SUBWAY_COLOR_BY_LINE[key] ?? DEFAULT_SUBWAY_COLOR,
		label: labelOf(input.name),
		regionKey: null,
	};
}
