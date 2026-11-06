export type StatusKind = "live" | "estimated" | "delayed" | "ended";

export interface StatusLegendItem {
	description: string;
	kind: StatusKind;
	label: string;
}

export interface DataProvider {
	subtitle: string;
	title: string;
	url: string;
}

export const STATUS_LEGEND: StatusLegendItem[] = [
	{
		description: "실시간 위치 API로 확인된 위치",
		kind: "live",
		label: "실시간",
	},
	{
		description: "역 도착 신호와 시간표로 계산한 위치",
		kind: "estimated",
		label: "시간표 추정",
	},
	{
		description: "운영 기관 지연 정보 반영",
		kind: "delayed",
		label: "지연",
	},
	{
		description: "운행이 끝났거나 정보가 없어요",
		kind: "ended",
		label: "운행 종료",
	},
];

export const DATA_PROVIDERS: DataProvider[] = [
	{
		subtitle: "서울 열린데이터광장 · 실시간 지하철 도착·역 정보",
		title: "서울특별시",
		url: "https://data.seoul.go.kr",
	},
	{
		subtitle: "버스 위치·노선·정류소, 서울교통공사 시간표",
		title: "공공데이터포털",
		url: "https://www.data.go.kr",
	},
	{
		subtitle: "철도산업정보센터 · 광역철도 시간표",
		title: "국가철도공단",
		url: "https://data.kric.go.kr",
	},
	{
		subtitle: "선로·지도 형상 (ODbL)",
		title: "© OpenStreetMap contributors",
		url: "https://www.openstreetmap.org/copyright",
	},
];

export const DATA_SOURCES_FOOTNOTE =
	"공공누리 제1유형 · 갱신 주기는 노선과 시간대에 따라 달라요";
