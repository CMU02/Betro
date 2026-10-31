import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { loadBuildTracksInput } from "../jobs/build-tracks";
import {
	databaseFilePath,
	rawPath,
	resolveDatabaseUrl,
	resolveDataDir,
} from "../paths";
import { assembleTracks } from "./assemble";

const dataDir = resolveDataDir(process.env);
// loadBuildTracksInput이 여는 DB와 같은 위치를 본다(cwd와 무관). 원격 DB URL이면 파일 검사 없이 실행한다.
const dbFile = databaseFilePath(resolveDatabaseUrl(process.env));
const dbReady = dbFile === undefined || existsSync(dbFile);
const ready = existsSync(rawPath(dataDir, "osm", "routes.json")) && dbReady;

const LINE2_INNER = 4_729_409;
const LINE2_OUTER = 2_404_374;
const LINE6_EUNGAM_LOOP = 12_080_315;
const LINE8_MORAN_BYEOLLAE = 7_919_018;
const CITY_HALL_MAX_DISTANCE_M = 50;
const SUJIN_MAX_OFFSET_M = 50;

describe.skipIf(!ready)("tracks against real OSM and crosswalk", () => {
	it("covers every crosswalk station on all 19 lines without errors", async () => {
		const r = assembleTracks(await loadBuildTracksInput(dataDir));
		expect(r.stitchFailures).toEqual([]);
		expect(r.uncoveredStations).toEqual([]);
		expect(
			r.issues.flatMap((i) => i.issues).filter((i) => i.level === "error")
		).toEqual([]);
		expect(new Set(r.shapes.map((s) => s.lineKey)).size).toBe(19);
	});

	it("keeps the loop, re-entry, and shifted-ref regressions fixed", async () => {
		const input = await loadBuildTracksInput(dataDir);
		const r = assembleTracks(input);
		const statnIdOf = (lineKey: string, name: string): string | undefined =>
			input.crosswalk.find(
				(row) => row.lineKey === lineKey && row.nameCanonical === name
			)?.statnId;
		const shapeOf = (osmRelationId: number) =>
			r.shapes.find((s) => s.osmRelationId === osmRelationId);

		// 2호선 내선·외선: 닫힌 고리를 첫 정차 노드(시청)에서 시작한다.
		const cityHall = statnIdOf("line2", "시청");
		for (const relationId of [LINE2_INNER, LINE2_OUTER]) {
			const station = shapeOf(relationId)?.stations.find(
				(s) => s.statnId === cityHall
			);
			expect(station?.distanceM).toBeLessThan(CITY_HALL_MAX_DISTANCE_M);
		}

		// 6호선 응암순환 → 신내: 응암이 처음이고 거리가 계속 늘어난다.
		const line6 = shapeOf(LINE6_EUNGAM_LOOP)?.stations ?? [];
		const names = new Map(input.crosswalk.map((row) => [row.statnId, row]));
		expect(names.get(line6[0]?.statnId ?? "")?.nameCanonical).toStartWith(
			"응암"
		);
		for (let i = 1; i < line6.length; i += 1) {
			expect(line6[i]?.distanceM ?? 0).toBeGreaterThan(
				line6[i - 1]?.distanceM ?? 0
			);
		}

		// 8호선 모란 → 별내: 모란 노드의 ref가 수진 frCode여도 수진은 자기 노드에 놓인다.
		const sujin = shapeOf(LINE8_MORAN_BYEOLLAE)?.stations.find(
			(s) => s.statnId === statnIdOf("line8", "수진")
		);
		expect(sujin?.anchor).toBe("osm-stop");
		expect(sujin?.offsetM).toBeLessThan(SUJIN_MAX_OFFSET_M);
		expect(input.osm.nodes.get(sujin?.osmStopNodeId ?? 0)?.tags?.name).toBe(
			"수진"
		);
	});
});
