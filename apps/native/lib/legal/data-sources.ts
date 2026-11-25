import type { MessageKey } from "@/lib/i18n/translate";

export type StatusKind = "live" | "estimated" | "delayed" | "ended";

/** 문구는 키로 들고, 화면이 그릴 때 `t`로 바꾼다. `labelKey`는 출퇴근 잠금화면 태그(2-F)도 쓴다. */
export interface StatusLegendItem {
	descriptionKey: MessageKey;
	kind: StatusKind;
	labelKey: MessageKey;
}

/** 앱이 데이터를 받아 쓰는 모든 출처. 버스·지하철 출처 ID는 `@Betro/commute/refs`와 같다. */
export const USED_SOURCES = [
	"seoul-subway",
	"seoul-bus",
	"gbis",
	"tago",
	"kric",
	"osm",
	"naver-map",
] as const;

export type UsedSource = (typeof USED_SOURCES)[number];

export interface DataProvider {
	/** 이 제공 기관이 맡는 출처. 모든 `USED_SOURCES`가 한 곳 이상에 들어 있어야 한다. */
	sources: readonly UsedSource[];
	subtitleKey: MessageKey;
	titleKey: MessageKey;
	url: string;
}

export const STATUS_LEGEND: StatusLegendItem[] = [
	{
		descriptionKey: "dataSources.status.live.description",
		kind: "live",
		labelKey: "dataSources.status.live.label",
	},
	{
		descriptionKey: "dataSources.status.estimated.description",
		kind: "estimated",
		labelKey: "dataSources.status.estimated.label",
	},
	{
		descriptionKey: "dataSources.status.delayed.description",
		kind: "delayed",
		labelKey: "dataSources.status.delayed.label",
	},
	{
		descriptionKey: "dataSources.status.ended.description",
		kind: "ended",
		labelKey: "dataSources.status.ended.label",
	},
];

export const DATA_PROVIDERS: DataProvider[] = [
	{
		sources: ["seoul-subway"],
		subtitleKey: "dataSources.providers.seoul.subtitle",
		titleKey: "dataSources.providers.seoul.title",
		url: "https://data.seoul.go.kr",
	},
	{
		sources: ["seoul-bus"],
		subtitleKey: "dataSources.providers.dataGoKr.subtitle",
		titleKey: "dataSources.providers.dataGoKr.title",
		url: "https://www.data.go.kr",
	},
	{
		sources: ["gbis"],
		subtitleKey: "dataSources.providers.gyeonggi.subtitle",
		titleKey: "dataSources.providers.gyeonggi.title",
		url: "https://www.data.go.kr",
	},
	{
		sources: ["tago"],
		subtitleKey: "dataSources.providers.molit.subtitle",
		titleKey: "dataSources.providers.molit.title",
		url: "https://www.data.go.kr",
	},
	{
		sources: ["kric"],
		subtitleKey: "dataSources.providers.kric.subtitle",
		titleKey: "dataSources.providers.kric.title",
		url: "https://data.kric.go.kr",
	},
	{
		sources: ["osm"],
		subtitleKey: "dataSources.providers.openStreetMap.subtitle",
		titleKey: "dataSources.providers.openStreetMap.title",
		url: "https://www.openstreetmap.org/copyright",
	},
	{
		sources: ["naver-map"],
		subtitleKey: "dataSources.providers.naverMap.subtitle",
		titleKey: "dataSources.providers.naverMap.title",
		url: "https://www.ncloud.com/product/applicationService/maps",
	},
];

export const DATA_SOURCES_FOOTNOTE_KEY: MessageKey = "dataSources.footnote";
