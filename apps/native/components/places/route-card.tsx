import { FootprintsIcon, PlusIcon, Trash2Icon } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { Stepper } from "@/components/ui/stepper";
import { t } from "@/lib/i18n/t";
import type { RouteRow } from "@/lib/places/setup-form-model";

const Footprints = withUniwind(FootprintsIcon);
const Trash = withUniwind(Trash2Icon);
const Plus = withUniwind(PlusIcon);

const ROW_ICON_SIZE = 20;
const ADD_ICON_SIZE = 18;
const MIN_WALK = 0;
const MAX_WALK = 60;

type WalkRow = Extract<RouteRow, { kind: "walk" }>;
type RideRow = Extract<RouteRow, { kind: "ride" }>;

/** Figma `RouteStepRow/Walk`. 도보 시간은 0~60분, 1분 단위. */
const WalkStep = memo(function WalkStepView({
	onChange,
	row,
}: {
	onChange: (walkIndex: number, minutes: number) => void;
	row: WalkRow;
}) {
	const handleChange = useCallback(
		(minutes: number) => onChange(row.walkIndex, minutes),
		[onChange, row.walkIndex]
	);
	return (
		<View className="flex-row items-center gap-3 py-2">
			<View className="h-6 w-10 items-center justify-center">
				<Footprints
					colorClassName="accent-icon-secondary"
					size={ROW_ICON_SIZE}
				/>
			</View>
			<AppText className="flex-1 text-text-secondary" variant="bodyS">
				{row.label}
			</AppText>
			<Stepper
				label={row.label}
				max={MAX_WALK}
				min={MIN_WALK}
				onChange={handleChange}
				value={row.minutes}
			/>
		</View>
	);
});

/** Figma `RouteStepRow/Ride`. 노선 배지 + 승차 → 하차 + 지우기. */
const RideStep = memo(function RideStepView({
	onRemove,
	row,
}: {
	onRemove: (legIndex: number) => void;
	row: RideRow;
}) {
	const handleRemove = useCallback(
		() => onRemove(row.legIndex),
		[onRemove, row.legIndex]
	);
	return (
		<View className="flex-row items-center gap-3 py-2">
			<View className="min-w-10 items-center justify-center">
				<LineBadge {...row.badge} />
			</View>
			<View className="flex-1 gap-0.5">
				<AppText variant="bodyMStrong">{row.title}</AppText>
				<AppText className="text-text-secondary" variant="caption">
					{row.detail}
				</AppText>
			</View>
			<Pressable
				accessibilityLabel={t("placeSetup.leg.remove", {
					line: row.badge.name,
				})}
				accessibilityRole="button"
				className="size-8 items-center justify-center rounded-full active:bg-bg-hover"
				hitSlop={8}
				onPress={handleRemove}
			>
				<Trash colorClassName="accent-icon-secondary" size={ROW_ICON_SIZE} />
			</Pressable>
		</View>
	);
});

/** 카드 안 "구간 추가", "대안 경로 추가" 버튼. 더하기 아이콘 + 글자. */
export function AddRowButton({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			className="h-10 flex-row items-center gap-1.5 self-start rounded-md px-4 active:bg-bg-hover"
			onPress={onPress}
		>
			<Plus colorClassName="accent-icon-primary" size={ADD_ICON_SIZE} />
			<AppText variant="labelM">{label}</AppText>
		</Pressable>
	);
}

export interface RouteCardProps {
	/** 구간을 4개보다 적게 넣었을 때만 "구간 추가"를 보인다. */
	canAddLeg: boolean;
	/** 대안 카드의 머리("대안 1"). 기본 경로에는 없다. */
	header?: { onRemove: () => void; title: string };
	onAddLeg: () => void;
	onRemoveLeg: (legIndex: number) => void;
	onWalkChange: (walkIndex: number, minutes: number) => void;
	rows: RouteRow[];
}

/** 16 경로 카드. 도보와 탑승 줄을 차례로 그리고, 아래에 "구간 추가"를 둔다. */
export function RouteCard({
	canAddLeg,
	header,
	onAddLeg,
	onRemoveLeg,
	onWalkChange,
	rows,
}: RouteCardProps) {
	return (
		<View className="overflow-hidden rounded-lg bg-bg-surface-raised px-4 py-2">
			{header ? (
				<View className="flex-row items-center justify-between py-1">
					<AppText className="text-text-secondary" variant="labelS">
						{header.title}
					</AppText>
					<Pressable
						accessibilityRole="button"
						className="h-8 justify-center rounded-md px-2 active:bg-bg-hover"
						onPress={header.onRemove}
					>
						<AppText className="text-status-delayed" variant="labelM">
							{t("placeSetup.removeAlternative")}
						</AppText>
					</Pressable>
				</View>
			) : null}
			{rows.length === 0 ? (
				<AppText className="py-2 text-text-secondary" variant="bodyS">
					{t("placeSetup.emptyRoute")}
				</AppText>
			) : null}
			{rows.map((row) =>
				row.kind === "walk" ? (
					<WalkStep
						key={`walk-${row.walkIndex}`}
						onChange={onWalkChange}
						row={row}
					/>
				) : (
					<RideStep
						key={`ride-${row.legIndex}`}
						onRemove={onRemoveLeg}
						row={row}
					/>
				)
			)}
			{canAddLeg ? (
				<>
					{rows.length > 0 ? <View className="h-px bg-border-subtle" /> : null}
					<View className="py-1">
						<AddRowButton label={t("placeSetup.addLeg")} onPress={onAddLeg} />
					</View>
				</>
			) : null}
		</View>
	);
}
