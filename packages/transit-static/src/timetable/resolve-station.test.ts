import { describe, expect, it } from "bun:test";
import type { CrosswalkRow } from "../crosswalk/match";
import { createStationResolver, type StationAlias } from "./resolve-station";

const row = (
	statnId: string,
	lineKey: CrosswalkRow["lineKey"],
	nameCanonical: string,
	stationCd?: string,
	nameAliases: string[] = []
): CrosswalkRow => ({
	bldnId: "B",
	coordSource: "station-master",
	lat: 37,
	lineKey,
	lng: 127,
	matchMethod: "auto-same-line",
	nameAliases,
	nameCanonical,
	qualityFlags: [],
	stationCd,
	statnId,
	subwayId: "1000",
});

const crosswalk: CrosswalkRow[] = [
	row("1004000001", "line4", "총신대입구", "0433"),
	row("1007000001", "line7", "총신대입구", "0734"),
	row("1002000001", "line2", "시청", "0201"),
	row("1002000002", "line2", "동명", undefined),
	row("1002000003", "line2", "동명(별칭)", undefined),
	row("1002000004", "line2", "특이역", undefined),
];

const aliases: StationAlias[] = [
	{
		lineKey: "line2",
		source: "seoul-metro-csv",
		sourceStation: "특이표기",
		statnId: "1002000004",
	},
];

describe("createStationResolver", () => {
	const resolver = createStationResolver(crosswalk, aliases);

	it("역사코드가 같은 노선 stationCd와 일치하면 code로 해석한다", () => {
		expect(
			resolver.resolve({
				code: "0433",
				lineKey: "line4",
				source: "seoul-metro-csv",
			})
		).toEqual({ method: "code", statnId: "1004000001" });
	});

	it("코드가 없으면 이름으로 해석하고 괄호 병기 이름도 정규화로 일치한다", () => {
		expect(
			resolver.resolve({
				lineKey: "line7",
				name: "총신대입구(이수)",
				source: "seoul-metro-csv",
			})
		).toEqual({ method: "name", statnId: "1007000001" });
	});

	it("같은 노선에 정규화 동명이 둘이면 ambiguous", () => {
		const result = resolver.resolve({
			lineKey: "line2",
			name: "동명",
			source: "seoul-metro-csv",
		});
		expect(result).toEqual({
			candidates: ["1002000002", "1002000003"],
			error: "ambiguous",
		});
	});

	it("별칭표로 해석한다", () => {
		expect(
			resolver.resolve({
				lineKey: "line2",
				name: "특이표기",
				source: "seoul-metro-csv",
			})
		).toEqual({ method: "alias", statnId: "1002000004" });
	});

	it("다른 노선의 같은 코드는 매칭하지 않는다", () => {
		const result = resolver.resolve({
			code: "0734",
			lineKey: "line4",
			source: "seoul-metro-csv",
		});
		expect(result).toEqual({ candidates: [], error: "unknown" });
	});

	it("실패한 입력을 unresolved로 집계한다", () => {
		const fresh = createStationResolver(crosswalk, []);
		const input = {
			lineKey: "line2" as const,
			name: "없는역",
			source: "seoul-metro-csv" as const,
		};
		fresh.resolve(input);
		fresh.resolve(input);
		fresh.resolve({ ...input, name: "시청" });
		expect(fresh.unresolved()).toEqual([{ ...input, count: 2 }]);
	});

	it("statnId가 null인 별칭은 대응표 범위 밖 역으로 빼고 unresolved가 아닌 excluded로 센다", () => {
		const scoped = createStationResolver(crosswalk, [
			{
				lineKey: "line4",
				source: "seoul-metro-csv",
				sourceStation: "0405",
				statnId: null,
			},
			{
				lineKey: "line4",
				source: "*",
				sourceStation: "0406",
				statnId: null,
			},
		]);
		expect(
			scoped.resolve({
				code: "0406",
				lineKey: "line4",
				source: "seoul-metro-csv",
			})
		).toEqual({ method: "excluded" });
		const input = {
			code: "0405",
			lineKey: "line4" as const,
			name: "진접",
			source: "seoul-metro-csv" as const,
		};
		expect(scoped.resolve(input)).toEqual({ method: "excluded" });
		scoped.resolve(input);
		expect(scoped.unresolved()).toEqual([]);
		expect(scoped.excluded()).toEqual([
			{
				code: "0406",
				count: 1,
				lineKey: "line4",
				name: undefined,
				source: "seoul-metro-csv",
			},
			{ ...input, count: 2 },
		]);
	});
});
