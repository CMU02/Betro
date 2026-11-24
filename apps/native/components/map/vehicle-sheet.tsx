import type { Leg } from "@Betro/commute/plan";
import { cn } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	type LayoutChangeEvent,
	PanResponder,
	Pressable,
	ScrollView,
	View,
} from "react-native";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { StatusTag } from "@/components/ui/status-tag";
import { t } from "@/lib/i18n/t";
import type { BusMap, RouteViewLeg, SubwayMap } from "@/lib/map/map-client";
import { freshnessLabel, mineLabel } from "@/lib/map/map-labels";
import { type SheetStopState, sheetModel } from "@/lib/map/sheet-model";
import type { LineBadgeInput } from "@/lib/transit/line-badge-model";

/** "N초 전 위치"가 새 관측을 기다리지 않고 늘도록 다시 그리는 간격. */
const CLOCK_TICK_MS = 1000;
/** 이만큼 끌어내리면 닫는다. */
const CLOSE_DRAG_PX = 80;
/** 세로로 이만큼 움직여야 끌기로 본다. 그보다 작으면 시트 안 누르기로 남긴다. */
const DRAG_START_PX = 6;
/** 정류장 줄 한 칸 높이(h-11)와 한 번에 보이는 칸 수. 더 길면 스크롤한다. */
const STOP_ROW_HEIGHT = 44;
const MAX_VISIBLE_STOPS = 5;
const STOPS_STYLE = { maxHeight: STOP_ROW_HEIGHT * MAX_VISIBLE_STOPS } as const;

export interface SheetVehicle {
	id: string;
	observedAt: number;
	positionSeq: number;
}

function useNowMs(): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
}

/** 끌어내리면 닫히는 시트의 위치. 덜 내리면 제자리로 돌아간다. */
function useDragToClose(onClose: () => void) {
	const translateY = useRef(new Animated.Value(0)).current;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const responder = useMemo(
		() =>
			PanResponder.create({
				onMoveShouldSetPanResponder: (_, gesture) =>
					gesture.dy > DRAG_START_PX &&
					Math.abs(gesture.dy) > Math.abs(gesture.dx),
				onPanResponderMove: (_, gesture) => {
					translateY.setValue(Math.max(0, gesture.dy));
				},
				onPanResponderRelease: (_, gesture) => {
					if (gesture.dy > CLOSE_DRAG_PX) {
						closeRef.current();
						return;
					}
					Animated.spring(translateY, {
						toValue: 0,
						useNativeDriver: true,
					}).start();
				},
				onPanResponderTerminate: () => {
					Animated.spring(translateY, {
						toValue: 0,
						useNativeDriver: true,
					}).start();
				},
			}),
		[translateY]
	);
	return { handlers: responder.panHandlers, translateY };
}

const DOT_CLASS: Record<SheetStopState, string> = {
	mine: "size-3 border-2 bg-bg-surface",
	next: "size-3 border-2 bg-bg-surface",
	now: "size-4 border-4 bg-text-primary",
	past: "size-2.5 opacity-50",
};

const TEXT_CLASS: Record<SheetStopState, string> = {
	mine: "text-text-primary",
	next: "text-text-secondary",
	now: "text-text-primary",
	past: "text-text-tertiary",
};

function StopRow({
	color,
	label,
	name,
	state,
}: {
	color: string;
	label: string | null;
	name: string;
	state: SheetStopState;
}) {
	const filled = state === "past";
	return (
		<View className="h-11 flex-row items-center gap-3">
			<View className="w-6 items-center">
				<View
					className={cn("rounded-full", DOT_CLASS[state])}
					style={filled ? { backgroundColor: color } : { borderColor: color }}
				/>
			</View>
			<AppText
				className={cn("flex-1", TEXT_CLASS[state])}
				numberOfLines={1}
				variant={state === "now" ? "bodyMStrong" : "bodyM"}
			>
				{name}
			</AppText>
			{label === null ? null : (
				<AppText className="text-text-secondary" variant="caption">
					{label}
				</AppText>
			)}
		</View>
	);
}

/**
 * 차량을 눌렀을 때 아래에서 올라오는 카드(지도 설계 2.4). 노선과 방면, 위치의 신선도, 정류장 줄을 보여 주고
 * 줄은 내 정류장(내가 탈 역)에서 끝난다. 끌어내리거나 빈 지도를 누르면 닫힌다. 남은 분은 승차 도착판에
 * 이 차량이 있을 때만 붙는다(2.8).
 */
export function VehicleSheet({
	badge,
	bottomOffset,
	color,
	leg,
	map,
	onClose,
	onHeight,
	onOpenDetail,
	toAlight,
	vehicle,
	view,
}: {
	badge: LineBadgeInput;
	bottomOffset: number;
	color: string;
	leg: Leg;
	map: BusMap | SubwayMap;
	onClose: () => void;
	/** 시트 높이. 화면이 지도 여백에 더해 확대한 차량이 시트에 가리지 않게 한다. */
	onHeight: (height: number) => void;
	/** 07 버스 노선 상세를 여는 동작. 없으면 "자세히" 행을 그리지 않는다(경기·인천 노선, 지하철). */
	onOpenDetail?: () => void;
	/** 이미 탄 차량이면 줄이 하차 정류장에서 끝나므로 "내 정류장" 글을 붙이지 않는다. */
	toAlight: boolean;
	vehicle: SheetVehicle;
	view: RouteViewLeg | null;
}) {
	const nowMs = useNowMs();
	const { handlers, translateY } = useDragToClose(onClose);
	const model = sheetModel({
		boarded: toAlight,
		leg,
		map,
		nowMs,
		observedAt: vehicle.observedAt,
		positionSeq: vehicle.positionSeq,
		vehicleId: vehicle.id,
		view,
	});
	const freshness = freshnessLabel(model.freshness);
	const handleLayout = useCallback(
		(event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height),
		[onHeight]
	);
	return (
		<View
			className="absolute inset-x-4"
			onLayout={handleLayout}
			style={{ bottom: bottomOffset }}
		>
			<Animated.View style={{ transform: [{ translateY }] }}>
				<View className="rounded-xl bg-bg-surface px-4 pb-3">
					{/* 끌어내리기는 손잡이와 머리에서만 받는다. 정류장 줄은 스크롤한다. */}
					<View {...handlers}>
						<Pressable
							accessibilityLabel={t("map.sheet.close")}
							accessibilityRole="button"
							className="h-5 items-center justify-center"
							onPress={onClose}
						>
							<View className="h-1 w-9 rounded-full bg-border-strong" />
						</Pressable>
						<View className="flex-row items-start gap-3 pt-1">
							<LineBadge {...badge} />
							<View className="flex-1 gap-0.5">
								<AppText numberOfLines={1} variant="title3">
									{model.lineLabel}
								</AppText>
								<AppText
									className="text-text-secondary"
									numberOfLines={1}
									variant="bodyS"
								>
									{t(model.directionKey, model.directionParams)}
								</AppText>
							</View>
						</View>
						<View className="flex-row items-center gap-2 pt-2 pb-1">
							<StatusTag kind={freshness.kind} label={freshness.label} />
							{model.trainNo === null ? null : (
								<AppText className="text-text-secondary" variant="caption">
									{t("map.sheet.trainNo", { no: model.trainNo })}
								</AppText>
							)}
						</View>
					</View>
					{onOpenDetail === undefined ? null : (
						<Pressable
							accessibilityRole="button"
							className="h-11 justify-center"
							onPress={onOpenDetail}
						>
							<AppText className="text-accent-primary" variant="bodyMStrong">
								{t("map.sheet.more")}
							</AppText>
						</Pressable>
					)}
					<ScrollView style={STOPS_STYLE}>
						{model.stops.map((stop, index) => (
							<StopRow
								color={color}
								// 정류장 줄은 순환 노선에서 같은 이름이 다시 나올 수 있어 자리로 구분한다.
								// biome-ignore lint/suspicious/noArrayIndexKey: 위와 같다.
								key={index}
								label={
									stop.state === "mine" && !toAlight
										? mineLabel(leg.mode, model)
										: null
								}
								name={stop.name}
								state={stop.state}
							/>
						))}
					</ScrollView>
				</View>
			</Animated.View>
		</View>
	);
}
