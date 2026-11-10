import type { MessageKey } from "@/lib/i18n/translate";

export type StatusKind = "live" | "estimated" | "delayed" | "ended";

/** 문구는 키로 들고, 화면이 그릴 때 `t`로 바꾼다. `labelKey`는 출퇴근 잠금화면 태그(2-F)도 쓴다. */
export interface StatusLegendItem {
	descriptionKey: MessageKey;
	kind: StatusKind;
	labelKey: MessageKey;
}

export interface DataProvider {
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
		subtitleKey: "dataSources.providers.seoul.subtitle",
		titleKey: "dataSources.providers.seoul.title",
		url: "https://data.seoul.go.kr",
	},
	{
		subtitleKey: "dataSources.providers.dataGoKr.subtitle",
		titleKey: "dataSources.providers.dataGoKr.title",
		url: "https://www.data.go.kr",
	},
	{
		subtitleKey: "dataSources.providers.kric.subtitle",
		titleKey: "dataSources.providers.kric.title",
		url: "https://data.kric.go.kr",
	},
	{
		subtitleKey: "dataSources.providers.openStreetMap.subtitle",
		titleKey: "dataSources.providers.openStreetMap.title",
		url: "https://www.openstreetmap.org/copyright",
	},
];

export const DATA_SOURCES_FOOTNOTE_KEY: MessageKey = "dataSources.footnote";
