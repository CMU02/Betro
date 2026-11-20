import type { Leg } from "@Betro/commute/plan";

import { t } from "@/lib/i18n/t";
import type { StatusKind } from "@/lib/legal/data-sources";
import type { RouteView } from "./map-client";
import type { RouteOption } from "./selection";
import type { SheetModel } from "./sheet-model";

const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;

/** 칩 재탭 목록의 한 줄. 예: "기본 · 470 → 2호선", "대안 1 · 273 → 2호선" */
export function routeOptionLabel(option: RouteOption): string {
	const name =
		option.rank === 0
			? t("map.routeMenu.base")
			: t("map.routeMenu.alternative", { n: option.rank });
	return t("map.routeMenu.row", {
		lines: option.lineNames.join(t("map.routeMenu.separator")),
		name,
	});
}

export type ChipState = "idle" | "selected" | "open";

/** 고른 칩에만 ▾가 붙고, 경로 목록이 펼쳐져 있으면 ▴다(지도 설계 2.2). */
export function chipLabel(name: string, state: ChipState): string {
	if (state === "idle") {
		return name;
	}
	return t(state === "open" ? "map.chips.open" : "map.chips.selected", {
		name,
	});
}

/** 시트의 신선도 줄. 오래된 위치는 "실시간"이라고 쓰지 않고 몇 분 전 위치인지만 보여 준다(지도 설계 7장). */
export function freshnessLabel(freshness: SheetModel["freshness"]): {
	kind: StatusKind;
	label: string;
} {
	if (freshness.live) {
		return {
			kind: "live",
			label: t("map.sheet.live", { seconds: freshness.secondsAgo }),
		};
	}
	return {
		kind: "ended",
		label: t("map.sheet.stale", {
			minutes: Math.floor(freshness.secondsAgo / SECONDS_PER_MINUTE),
		}),
	};
}

/** 정류장 줄의 끝(내 정류장·내가 탈 역)에 붙는 글. 남은 분을 알 때만 붙이고, 추정이면 그렇다고 쓴다. */
export function mineLabel(
	mode: Leg["mode"],
	model: Pick<SheetModel, "estimated" | "minutesToMine">
): string {
	const label = t(mode === "bus" ? "map.sheet.mine" : "map.sheet.mineStation");
	if (model.minutesToMine === null) {
		return label;
	}
	const eta = model.estimated
		? t("map.sheet.minutesEstimated", { minutes: model.minutesToMine })
		: t("map.sheet.minutes", { minutes: model.minutesToMine });
	return t("map.sheet.mineEta", { eta, label });
}

/**
 * 실시간 버스가 아직 없을 때의 승차 정류장 도착 예상(지도 설계 2.6). 시간표 추정 상태의 버스는 그리지 않으므로
 * 차량을 보일 버스 구간인데 그린 차량이 없고, 그 구간 예상이 추정일 때 첫 구간 하나만 글로 보여 준다.
 */
export function estimatedBoardNotice(
	legs: readonly { leg: Leg; showVehicles: boolean; vehicleCount: number }[],
	view: RouteView | null,
	nowMs: number
): string | null {
	if (view === null) {
		return null;
	}
	for (const [index, { leg, showVehicles, vehicleCount }] of legs.entries()) {
		const viewLeg = view.legs[index];
		const waiting =
			leg.mode === "bus" &&
			showVehicles &&
			vehicleCount === 0 &&
			viewLeg?.etaState === "estimated" &&
			viewLeg.boardEtaAt !== null;
		if (waiting && viewLeg.boardEtaAt !== null) {
			return t("map.estimatedBoard", {
				line: leg.lineName,
				minutes: Math.max(
					0,
					Math.floor((viewLeg.boardEtaAt - nowMs) / MS_PER_MINUTE)
				),
			});
		}
	}
	return null;
}
