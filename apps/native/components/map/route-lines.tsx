import {
	NaverMapMarkerOverlay,
	NaverMapPathOverlay,
} from "@mj-studio/react-native-naver-map";
import { memo, useMemo } from "react";
import { View } from "react-native";

import { pointAlong } from "@/lib/map/motion";
import { spanSegments, toCoords } from "@/lib/map/route-shape";

type Shape = readonly [number, number][];

/** 노선 전체(옅게)와 승차~하차(진하게)의 두께. 진한 선이 옅은 선을 덮는다. */
const FAINT_WIDTH = 4;
const STRONG_WIDTH = 6;
const STRONG_Z_INDEX = 1;
/** 승차 정류장 점의 지름. */
const BOARD_DOT_SIZE = 14;
const BOARD_DOT_ANCHOR = { x: 0.5, y: 0.5 } as const;
const MIN_PATH_POINTS = 2;

/** 선 하나. 좌표는 선(`shape`)이 바뀔 때만 다시 만든다. 1초마다 새로 그리는 차량 위치와 따로 둔다. */
const LinePath = memo(function LinePathView({
	color,
	shape,
	width,
	zIndex = 0,
}: {
	color: string;
	shape: Shape;
	width: number;
	zIndex?: number;
}) {
	const coords = useMemo(() => toCoords(shape), [shape]);
	if (coords.length < MIN_PATH_POINTS) {
		return null;
	}
	return (
		<NaverMapPathOverlay
			color={color}
			coords={coords}
			outlineWidth={0}
			width={width}
			zIndex={zIndex}
		/>
	);
});

/** 승차 정류장(역) 점. 노선색 테두리의 흰 바탕 점이다. */
const BoardDot = memo(function BoardDotView({
	color,
	distanceM,
	shape,
}: {
	color: string;
	distanceM: number;
	shape: Shape;
}) {
	const at = useMemo(() => pointAlong(shape, distanceM), [shape, distanceM]);
	if (at === null) {
		return null;
	}
	return (
		<NaverMapMarkerOverlay
			anchor={BOARD_DOT_ANCHOR}
			height={BOARD_DOT_SIZE}
			latitude={at.latitude}
			longitude={at.longitude}
			width={BOARD_DOT_SIZE}
			zIndex={STRONG_Z_INDEX}
		>
			<View
				className="size-3.5 rounded-full border-[3px] bg-bg-surface"
				collapsable={false}
				key={color}
				style={{ borderColor: color }}
			/>
		</NaverMapMarkerOverlay>
	);
});

export interface RouteLineLeg {
	alightM: number | null;
	boardM: number | null;
	/** 진한 선 색. */
	color: string;
	/** 옅은 선 색(노선색에 알파). */
	faintColor: string;
	key: string;
	shape: Shape;
}

/** 구간 하나의 선. 승차~하차 조각은 선과 두 위치가 바뀔 때만 다시 자른다. */
const LegLine = memo(function LegLineView({ leg }: { leg: RouteLineLeg }) {
	const { alightM, boardM, color, faintColor, shape } = leg;
	const segments = useMemo(
		() => spanSegments(shape, boardM, alightM),
		[shape, boardM, alightM]
	);
	return (
		<>
			<LinePath color={faintColor} shape={shape} width={FAINT_WIDTH} />
			{segments.map((segment, index) => (
				<LinePath
					color={color}
					// 조각은 많아야 둘(순환 이음매)이고 순서가 바뀌지 않는다.
					// biome-ignore lint/suspicious/noArrayIndexKey: 위와 같다.
					key={index}
					shape={segment}
					width={STRONG_WIDTH}
					zIndex={STRONG_Z_INDEX}
				/>
			))}
			{boardM === null ? null : (
				<BoardDot color={color} distanceM={boardM} shape={shape} />
			)}
		</>
	);
});

/**
 * 고른 경로의 노선 선(지도 설계 2.8). 구간이 지나는 노선 전체는 옅게, 승차에서 하차까지는 진하게 그리고
 * 승차 정류장에 점을 찍는다. 숨긴 노선도 선은 그린다(2.3). 다른 노선의 선은 그리지 않는다(2.1).
 */
export function RouteLines({ legs }: { legs: readonly RouteLineLeg[] }) {
	return (
		<>
			{legs.map((leg) => (
				<LegLine key={leg.key} leg={leg} />
			))}
		</>
	);
}

/** 장소가 없을 때 근처 지하철 노선의 선(지도 설계 2.5). 승차 구간이 없어 노선색 그대로 그린다. */
export function NearbyLines({
	paths,
}: {
	paths: readonly { color: string; key: string; shape: Shape }[];
}) {
	return (
		<>
			{paths.map((path) => (
				<LinePath
					color={path.color}
					key={path.key}
					shape={path.shape}
					width={FAINT_WIDTH}
				/>
			))}
		</>
	);
}
