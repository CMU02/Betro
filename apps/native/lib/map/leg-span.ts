import type { Leg } from "@Betro/commute/plan";

import type { BusTrack, SubwayTrack } from "./motion";

export type SpanTrack =
	| { kind: "bus"; track: BusTrack }
	| { kind: "subway"; track: SubwayTrack };

/**
 * 구간의 승차·하차 위치(노선 선 시작에서 잰 미터). 선에서 진한 부분(승차~하차)을 가를 때 쓴다.
 * 노선 선에서 정류장을 못 찾으면 그 쪽은 null이다.
 */
export function legSpanM(
	leg: Leg,
	legTrack: SpanTrack | null
): { alightM: number | null; boardM: number | null } {
	if (legTrack === null) {
		return { alightM: null, boardM: null };
	}
	if (leg.mode === "bus" && legTrack.kind === "bus") {
		const { stopDistanceBySeq } = legTrack.track;
		return {
			alightM: stopDistanceBySeq.get(leg.alight.seq) ?? null,
			boardM: stopDistanceBySeq.get(leg.board.seq) ?? null,
		};
	}
	if (leg.mode === "subway" && legTrack.kind === "subway") {
		const distanceOf = (stop: string) =>
			legTrack.track.stations.find((station) => station.stop === stop)
				?.distanceM ?? null;
		return {
			alightM: distanceOf(leg.alight.stop),
			boardM: distanceOf(leg.board.stop),
		};
	}
	return { alightM: null, boardM: null };
}
