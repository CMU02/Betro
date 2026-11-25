import { BUS_SOURCE_IDS, SUBWAY_SOURCE_IDS } from "@Betro/commute/refs";
import { describe, expect, it } from "bun:test";
import { t } from "@/lib/i18n/t";
import {
	DATA_PROVIDERS,
	DATA_SOURCES_FOOTNOTE_KEY,
	STATUS_LEGEND,
	USED_SOURCES,
} from "./data-sources";

describe("data sources", () => {
	it("explains all four position states with the same copy as before", () => {
		expect(
			STATUS_LEGEND.map((s) => [s.kind, t(s.labelKey), t(s.descriptionKey)])
		).toEqual([
			["live", "실시간", "실시간 위치 API로 확인된 위치"],
			["estimated", "시간표 추정", "역 도착 신호와 시간표로 계산한 위치"],
			["delayed", "지연", "운영 기관 지연 정보 반영"],
			["ended", "운행 종료", "운행이 끝났거나 정보가 없어요"],
		]);
	});

	it("credits OpenStreetMap under ODbL and every public data provider", () => {
		expect(
			DATA_PROVIDERS.map((p) => [t(p.titleKey), t(p.subtitleKey), p.url])
		).toEqual([
			[
				"서울특별시",
				"서울 열린데이터광장 · 실시간 지하철 도착·역 정보",
				"https://data.seoul.go.kr",
			],
			[
				"공공데이터포털",
				"서울 버스 위치·노선·정류소, 서울교통공사 시간표",
				"https://www.data.go.kr",
			],
			[
				"경기도",
				"경기도 버스정보 · 경기 버스 노선·정류소·도착·위치",
				"https://www.data.go.kr",
			],
			[
				"국토교통부",
				"TAGO · 인천 버스 노선·정류소·도착·위치",
				"https://www.data.go.kr",
			],
			[
				"국가철도공단",
				"철도산업정보센터 · 광역철도 시간표",
				"https://data.kric.go.kr",
			],
			[
				"© OpenStreetMap contributors",
				"선로·지도 형상 (ODbL)",
				"https://www.openstreetmap.org/copyright",
			],
			[
				"NAVER 지도",
				"배경 지도",
				"https://www.ncloud.com/product/applicationService/maps",
			],
		]);
	});

	it("앱이 쓰는 모든 출처가 제공 기관 하나 이상에 있다", () => {
		const covered = new Set(DATA_PROVIDERS.flatMap((p) => p.sources));
		expect(USED_SOURCES.filter((s) => !covered.has(s))).toEqual([]);
	});

	it("버스·지하철 출처 ID마다 USED_SOURCES에 대응이 있다", () => {
		const ids: readonly string[] = [...BUS_SOURCE_IDS, ...SUBWAY_SOURCE_IDS];
		expect(
			ids.filter((id) => !(USED_SOURCES as readonly string[]).includes(id))
		).toEqual([]);
	});

	it("keeps the KOGL footnote unchanged", () => {
		expect(t(DATA_SOURCES_FOOTNOTE_KEY)).toBe(
			"공공누리 제1유형 · 갱신 주기는 노선과 시간대에 따라 달라요"
		);
	});
});
