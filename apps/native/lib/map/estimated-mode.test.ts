import { describe, expect, it } from "bun:test";
import type { ServerClient } from "@/lib/server/api-client";
import { ESTIMATED_MODE_AFTER_MS, estimatedModeOf } from "./estimated-mode";
import {
	type BusSnapshot,
	fetchSnapshot,
	type SubwaySnapshot,
} from "./map-client";

const NOW = 1_793_678_684_100;

function snap(overrides: Partial<SubwaySnapshot> = {}): SubwaySnapshot {
	return {
		generatedAt: NOW,
		staleSince: null,
		stoppedToday: false,
		vehicles: [],
		...overrides,
	};
}

function busSnap(overrides: Partial<BusSnapshot> = {}): BusSnapshot {
	return {
		generatedAt: NOW,
		staleRoutes: {},
		staleSince: null,
		stoppedSources: [],
		stoppedToday: false,
		vehicles: [],
		...overrides,
	};
}

describe("estimatedModeOf", () => {
	it("보지 않는 노선(운행 종료)이 오래 비어 있어도 버스 추정 모드가 아니다", () => {
		const bus = busSnap({
			staleRoutes: { "100100290": NOW - 600_000 },
			staleSince: NOW - 600_000,
		});
		expect(
			estimatedModeOf({
				bus,
				busRouteIds: ["100100118"],
				now: NOW,
				subway: null,
			}).bus
		).toBe(false);
		expect(
			estimatedModeOf({
				bus,
				busRouteIds: ["100100290"],
				now: NOW,
				subway: null,
			}).bus
		).toBe(true);
	});

	it("staleSince가 1분 전이면 추정 모드가 아니고 4분 전이면 추정 모드다", () => {
		expect(
			estimatedModeOf({
				bus: null,
				busRouteIds: [],
				now: NOW,
				subway: snap({ staleSince: NOW - 60_000 }),
			}).subway
		).toBe(false);
		expect(
			estimatedModeOf({
				bus: null,
				busRouteIds: [],
				now: NOW,
				subway: snap({ staleSince: NOW - 240_000 }),
			}).subway
		).toBe(true);
	});

	it("3분을 막 채운 때는 아직 추정 모드가 아니다", () => {
		expect(
			estimatedModeOf({
				bus: null,
				busRouteIds: [],
				now: NOW,
				subway: snap({ staleSince: NOW - ESTIMATED_MODE_AFTER_MS }),
			}).subway
		).toBe(false);
	});

	it("그날 멈춘 스냅샷은 비어 온 시각과 상관없이 추정 모드다", () => {
		const mode = estimatedModeOf({
			bus: busSnap({ stoppedToday: true }),
			busRouteIds: [],
			now: NOW,
			subway: snap({ stoppedToday: true }),
		});
		expect(mode).toEqual({ bus: true, subway: true });
	});

	it("실시간이 돌아온 스냅샷(staleSince null)이면 추정 모드가 풀린다", () => {
		expect(
			estimatedModeOf({
				bus: busSnap(),
				busRouteIds: ["100100290"],
				now: NOW,
				subway: snap(),
			})
		).toEqual({ bus: false, subway: false });
	});

	it("스냅샷이 없으면 추정 모드가 아니다", () => {
		expect(
			estimatedModeOf({ bus: null, busRouteIds: [], now: NOW, subway: null })
		).toEqual({ bus: false, subway: false });
	});

	it("stoppedToday가 없는 옛 스냅샷은 false로 읽는다", async () => {
		const client: ServerClient = {
			request: () =>
				Promise.resolve({
					etag: '"o"',
					json: { generatedAt: NOW, staleSince: null, vehicles: [] },
					status: 200,
				}),
		};
		const result = await fetchSnapshot(client, "subway", null);
		expect(result.ok).toBe(true);
		if (!result.ok || result.value === "not-modified") {
			throw new Error("snapshot expected");
		}
		const subway = result.value.snapshot as SubwaySnapshot;
		expect(subway.stoppedToday).toBe(false);
		expect(
			estimatedModeOf({ bus: null, busRouteIds: [], now: NOW, subway }).subway
		).toBe(false);
	});
});
