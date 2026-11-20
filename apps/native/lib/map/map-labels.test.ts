import type { Leg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";
import type { RouteViewLeg } from "./map-client";
import {
	chipLabel,
	estimatedBoardNotice,
	freshnessLabel,
	mineLabel,
	routeOptionLabel,
} from "./map-labels";

const NOW = 10_000_000;

it("route menu rows read base or alternative then the lines in order", () => {
	expect(
		routeOptionLabel({ lineNames: ["470", "2호선"], rank: 0, selected: true })
	).toBe("기본 · 470 → 2호선");
	expect(
		routeOptionLabel({ lineNames: ["273"], rank: 2, selected: false })
	).toBe("대안 2 · 273");
});

it("only the selected chip carries the caret, pointing up while its menu is open", () => {
	expect(chipLabel("집", "idle")).toBe("집");
	expect(chipLabel("집", "selected")).toBe("집 ▾");
	expect(chipLabel("집", "open")).toBe("집 ▴");
});

it("never calls an old position live", () => {
	expect(freshnessLabel({ live: true, secondsAgo: 10 })).toEqual({
		kind: "live",
		label: "실시간 · 10초 전 위치",
	});
	expect(freshnessLabel({ live: false, secondsAgo: 250 })).toEqual({
		kind: "ended",
		label: "4분 전 위치",
	});
});

it("my stop row shows minutes only when known and says when they are estimated", () => {
	expect(mineLabel("bus", { estimated: false, minutesToMine: 3 })).toBe(
		"내 정류장 · 3분"
	);
	expect(mineLabel("subway", { estimated: false, minutesToMine: null })).toBe(
		"내가 탈 역"
	);
	expect(mineLabel("bus", { estimated: true, minutesToMine: 7 })).toBe(
		"내 정류장 · 시간표 추정 · 약 7분"
	);
});

const bus = { lineName: "470", mode: "bus" } as Leg;
const subway = { lineName: "2호선", mode: "subway" } as Leg;

function viewLeg(overrides: Partial<RouteViewLeg> = {}): RouteViewLeg {
	return {
		approaching: [],
		boardEtaAt: NOW + 7 * 60_000 + 30_000,
		etaState: "estimated",
		method: "headway",
		positionState: "none",
		vehicleId: null,
		...overrides,
	};
}

it("shows the timetable estimate for a bus leg with no live bus drawn", () => {
	expect(
		estimatedBoardNotice(
			[{ leg: bus, showVehicles: true, vehicleCount: 0 }],
			{ destinationEtaAt: null, legs: [viewLeg()] },
			NOW
		)
	).toBe("470 · 시간표 추정 · 약 7분 뒤");
});

it("shows no estimate when a bus is drawn, the leg is live, hidden, or not a bus", () => {
	const view = { destinationEtaAt: null, legs: [viewLeg()] };
	expect(
		estimatedBoardNotice(
			[{ leg: bus, showVehicles: true, vehicleCount: 1 }],
			view,
			NOW
		)
	).toBeNull();
	expect(
		estimatedBoardNotice(
			[{ leg: bus, showVehicles: false, vehicleCount: 0 }],
			view,
			NOW
		)
	).toBeNull();
	expect(
		estimatedBoardNotice(
			[{ leg: subway, showVehicles: true, vehicleCount: 0 }],
			view,
			NOW
		)
	).toBeNull();
	expect(
		estimatedBoardNotice(
			[{ leg: bus, showVehicles: true, vehicleCount: 0 }],
			{ destinationEtaAt: null, legs: [viewLeg({ etaState: "live" })] },
			NOW
		)
	).toBeNull();
	expect(
		estimatedBoardNotice(
			[{ leg: bus, showVehicles: true, vehicleCount: 0 }],
			null,
			NOW
		)
	).toBeNull();
});
