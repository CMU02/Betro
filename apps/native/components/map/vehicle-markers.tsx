import { NaverMapMarkerOverlay } from "@mj-studio/react-native-naver-map";
import { cn } from "heroui-native";
import { BusFrontIcon, TrainFrontIcon } from "lucide-react-native";
import { memo, useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { withUniwind } from "uniwind";

import { type MotionState, pointAlong, positionAt } from "@/lib/map/motion";
import { useMapVisible } from "@/lib/map/use-map-visible";

const BusFront = withUniwind(BusFrontIcon);
const TrainFront = withUniwind(TrainFrontIcon);

/**
 * 마커 위치를 다시 계산하는 최소 간격. `requestAnimationFrame`으로 돌되, 마커마다 좌표를 네이티브로 넘기는 비용이 있어
 * 매 프레임이 아니라 이 간격마다 바꾼다. 보간은 시각으로 계산하므로 간격이 달라도 위치는 같다.
 */
const FRAME_INTERVAL_MS = 100;
const MARKER_SIZE = 28;
const SELECTED_MARKER_SIZE = 36;
const ICON_SIZE = 16;
const MARKER_ANCHOR = { x: 0.5, y: 0.5 } as const;
const SELECTED_Z_INDEX = 1;

type Shape = readonly [number, number][];

export interface MarkerVehicle {
	color: string;
	key: string;
	kind: "bus" | "subway";
	motion: MotionState;
	/** 마지막 관측 위치(움직임 보정 없이). 부드러운 움직임을 끄면 여기에 둔다. */
	observedPosition: { latitude: number; longitude: number };
	shape: Shape;
}

/** `requestAnimationFrame` 시계. 켜져 있을 때만 돌고, `FRAME_INTERVAL_MS`보다 자주 다시 그리지 않는다. */
function useFrameClock(enabled: boolean): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!enabled) {
			return;
		}
		let frame = 0;
		let last = 0;
		const tick = (time: number) => {
			if (time - last >= FRAME_INTERVAL_MS) {
				last = time;
				setNow(Date.now());
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [enabled]);
	return now;
}

const VehicleMarker = memo(function VehicleMarkerView({
	latitude,
	longitude,
	onPress,
	selected,
	vehicle,
}: {
	latitude: number;
	longitude: number;
	onPress?: (key: string) => void;
	selected: boolean;
	vehicle: MarkerVehicle;
}) {
	const { color, key, kind } = vehicle;
	const handleTap = useCallback(() => onPress?.(key), [onPress, key]);
	const size = selected ? SELECTED_MARKER_SIZE : MARKER_SIZE;
	const Icon = kind === "bus" ? BusFront : TrainFront;
	return (
		<NaverMapMarkerOverlay
			anchor={MARKER_ANCHOR}
			height={size}
			latitude={latitude}
			longitude={longitude}
			onTap={onPress ? handleTap : undefined}
			width={size}
			zIndex={selected ? SELECTED_Z_INDEX : 0}
		>
			{/* 생김새가 바뀌는 값을 key로 넘겨야 SDK가 마커 그림을 다시 만든다. */}
			<View
				className={cn(
					"items-center justify-center rounded-sm",
					selected ? "size-9 border-2 border-accent-primary" : "size-7"
				)}
				collapsable={false}
				key={`${kind}/${color}/${selected}`}
				style={{ backgroundColor: color }}
			>
				{/* 노선색 위 흰 아이콘. 노선 배지 글자와 같은 원시 흰색이다(line-badge.tsx). */}
				<Icon colorClassName="accent-white" size={ICON_SIZE} />
			</View>
		</NaverMapMarkerOverlay>
	);
});

/**
 * 차량 마커(지도 설계 2.4, 4.4). 부드러운 움직임이 켜져 있으면 `positionAt`으로 노선 선을 따라 앞으로만 움직이고,
 * 꺼져 있으면 관측 위치에 바로 둔다. 지도가 보이지 않으면 시계를 멈춘다.
 */
export function VehicleMarkers({
	onPress,
	selectedKey,
	smooth,
	vehicles,
}: {
	onPress?: (key: string) => void;
	selectedKey: string | null;
	smooth: boolean;
	vehicles: readonly MarkerVehicle[];
}) {
	const visible = useMapVisible();
	const now = useFrameClock(smooth && visible && vehicles.length > 0);
	return (
		<>
			{vehicles.map((vehicle) => {
				const at = smooth
					? pointAlong(vehicle.shape, positionAt(vehicle.motion, now))
					: vehicle.observedPosition;
				if (at === null) {
					return null;
				}
				return (
					<VehicleMarker
						key={vehicle.key}
						latitude={at.latitude}
						longitude={at.longitude}
						onPress={onPress}
						selected={vehicle.key === selectedKey}
						vehicle={vehicle}
					/>
				);
			})}
		</>
	);
}
