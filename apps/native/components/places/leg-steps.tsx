import type { Leg } from "@Betro/commute/plan";
import { useQuery } from "@tanstack/react-query";
import {
	BusFrontIcon,
	CheckIcon,
	ChevronRightIcon,
	SearchIcon,
	TrainFrontIcon,
	WifiOffIcon,
} from "lucide-react-native";
import { memo, type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { LineBadge } from "@/components/transit/line-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { TextField } from "@/components/ui/text-field";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import {
	alightChoices,
	type BranchChoices,
	boardChoices,
	branchLabel,
	busLeg,
	busRouteRow,
	type DirectionView,
	directionView,
	isBranchUnavailable,
	type LookupView,
	lookupView,
	type StationPick,
	type StopChoice,
	searchView,
	subwayAlightChoices,
	subwayBoardChoices,
	subwayLeg,
} from "@/lib/places/leg-picker-model";
import {
	type BusRouteMatch,
	type BusStop,
	busRouteStops,
	type SubwayLine,
	searchBusRoutes,
	subwayDirection,
	subwayLines,
	subwayStations,
} from "@/lib/ref/ref-client";
import { serverClient } from "@/lib/server/app-server";

const BusFront = withUniwind(BusFrontIcon);
const TrainFront = withUniwind(TrainFrontIcon);
const Chevron = withUniwind(ChevronRightIcon);
const Check = withUniwind(CheckIcon);
const Search = withUniwind(SearchIcon);
const WifiOff = withUniwind(WifiOffIcon);

const SEARCH_DEBOUNCE_MS = 300;
/** 조회 데이터는 하루에 한 번 바뀐다. 한 번 받은 것은 등록하는 동안 다시 받지 않는다. */
const REF_STALE_MS = 10 * 60 * 1000;
const ROW_ICON_SIZE = 20;
const STATE_ICON_SIZE = 32;
const BOTTOM_PADDING = 8;

const BusIcon = (props: { colorClassName?: string; size?: number }) => (
	<BusFront {...props} />
);
const TrainIcon = (props: { colorClassName?: string; size?: number }) => (
	<TrainFront {...props} />
);

function useDebouncedValue(value: string, delayMs: number): string {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [delayMs, value]);
	return debounced;
}

function StepHeader({
	body,
	lead,
	title,
}: {
	body?: string;
	/** 제목 위의 작은 글자(고르는 순서 안내) */
	lead?: string;
	title: string;
}) {
	return (
		<View className="gap-1">
			{lead ? (
				<AppText className="text-text-secondary" variant="caption">
					{lead}
				</AppText>
			) : null}
			<AppText accessibilityRole="header" variant="title2">
				{title}
			</AppText>
			{body ? (
				<AppText className="text-text-secondary" variant="caption">
					{body}
				</AppText>
			) : null}
		</View>
	);
}

function Card({ children }: { children: ReactNode }) {
	return (
		<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
			{children}
		</View>
	);
}

/** 한 단계의 화면. 내용은 스크롤되고, `footer`("이 구간 추가")는 아래에 고정된다. */
function StepLayout({
	children,
	footer,
}: {
	children: ReactNode;
	footer?: ReactNode;
}) {
	const insets = useSafeAreaInsets();
	const bottom = insets.bottom + BOTTOM_PADDING;
	return (
		<>
			<ScrollView
				contentContainerClassName="gap-3 px-4 pt-2 pb-6"
				contentContainerStyle={footer ? undefined : { paddingBottom: bottom }}
				keyboardShouldPersistTaps="handled"
			>
				{children}
			</ScrollView>
			{footer ? (
				<View
					className="bg-bg-canvas px-4 pt-3"
					style={{ paddingBottom: bottom }}
				>
					{footer}
				</View>
			) : null}
		</>
	);
}

function Loading() {
	return (
		<View className="items-center py-8">
			<ActivityIndicator colorClassName="accent-icon-secondary" />
		</View>
	);
}

/**
 * Figma 16b "불러오지 못함". 오프라인, 503, 모양이 다른 응답, 없는 노선(404)일 때.
 * "다시 시도"는 같은 조회를 다시 한다.
 */
function Failed({
	titleKey = "legPicker.failed.title",
	onRetry,
}: {
	onRetry: () => void;
	titleKey?: MessageKey;
}) {
	return (
		<EmptyState
			action={
				<AppButton
					label={t("legPicker.retry")}
					onPress={onRetry}
					size="medium"
					variant="secondary"
				/>
			}
			body={t("legPicker.failed.body")}
			icon={
				<WifiOff
					colorClassName="accent-icon-secondary"
					size={STATE_ICON_SIZE}
				/>
			}
			title={t(titleKey)}
		/>
	);
}

/** 조회 상태가 준비되지 않았으면 그 상태를, 준비됐으면 `children`을 그린다. */
function LookupGate({
	children,
	onRetry,
	view,
}: {
	children: ReactNode;
	onRetry: () => void;
	view: LookupView;
}) {
	if (view === "loading") {
		return <Loading />;
	}
	if (view === "not-found") {
		return <Failed onRetry={onRetry} titleKey="legPicker.notFound" />;
	}
	if (view === "failed") {
		return <Failed onRetry={onRetry} />;
	}
	return <>{children}</>;
}

/** Figma `StopRow`(92:2392). Default / Selected / Disabled. */
const StopRow = memo(function StopRowView({
	disabled,
	label,
	onPress,
	selected,
	sub,
}: {
	disabled: boolean;
	label: string;
	onPress: () => void;
	selected: boolean;
	sub: string | null;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled, selected }}
			className="flex-row items-center gap-3 px-4 py-3 active:bg-bg-hover"
			disabled={disabled}
			onPress={onPress}
		>
			<View className="flex-1 gap-0.5">
				<AppText
					className={disabled ? "text-text-tertiary" : "text-text-primary"}
					variant="bodyMStrong"
				>
					{label}
				</AppText>
				{sub ? (
					<AppText
						className={disabled ? "text-text-tertiary" : "text-text-secondary"}
						variant="caption"
					>
						{sub}
					</AppText>
				) : null}
			</View>
			{selected ? (
				<Check colorClassName="accent-icon-primary" size={ROW_ICON_SIZE} />
			) : null}
		</Pressable>
	);
});

function BusStopRow({
	choice,
	onPick,
	selected,
	sub,
}: {
	choice: StopChoice;
	onPick: (stop: BusStop) => void;
	selected: boolean;
	sub: string | null;
}) {
	const handlePress = useCallback(
		() => onPick(choice.stop),
		[choice.stop, onPick]
	);
	return (
		<StopRow
			disabled={choice.disabled}
			label={choice.label}
			onPress={handlePress}
			selected={selected}
			sub={sub}
		/>
	);
}

function StationRow({
	disabled,
	name,
	onPick,
	selected,
	stop,
	sub,
}: {
	disabled: boolean;
	name: string;
	onPick: (station: StationPick) => void;
	selected: boolean;
	stop: string;
	sub: string | null;
}) {
	const handlePress = useCallback(
		() => onPick({ name, stop }),
		[name, onPick, stop]
	);
	return (
		<StopRow
			disabled={disabled}
			label={name}
			onPress={handlePress}
			selected={selected}
			sub={sub}
		/>
	);
}

/** Figma `RouteResultRow`(92:2366). 배지(경기·인천은 지역 글자) + 노선 이름. */
function RouteResultRow({
	onPick,
	route,
}: {
	onPick: (route: BusRouteMatch) => void;
	route: BusRouteMatch;
}) {
	const row = busRouteRow(route, t);
	const handlePress = useCallback(() => onPick(route), [onPick, route]);
	return (
		<Pressable
			accessibilityRole="button"
			className="flex-row items-center gap-3 px-4 py-3 active:bg-bg-hover"
			onPress={handlePress}
		>
			<LineBadge {...row.badge} />
			<View className="flex-1 gap-0.5">
				<AppText variant="bodyM">{row.title}</AppText>
				<AppText className="text-text-secondary" variant="caption">
					{row.sub}
				</AppText>
			</View>
			<Chevron colorClassName="accent-icon-secondary" size={ROW_ICON_SIZE} />
		</Pressable>
	);
}

function SubwayLineRow({
	line,
	onPick,
}: {
	line: SubwayLine;
	onPick: (line: SubwayLine) => void;
}) {
	const handlePress = useCallback(() => onPick(line), [line, onPick]);
	return (
		<Pressable
			accessibilityRole="button"
			className="flex-row items-center gap-3 px-4 py-3 active:bg-bg-hover"
			onPress={handlePress}
		>
			<LineBadge line={line.line} mode="subway" name={line.name} />
			<AppText className="flex-1" variant="bodyM">
				{line.name}
			</AppText>
			<Chevron colorClassName="accent-icon-secondary" size={ROW_ICON_SIZE} />
		</Pressable>
	);
}

function RouteHeader({ route }: { route: BusRouteMatch }) {
	const row = busRouteRow(route, t);
	return (
		<View className="flex-row items-center gap-2">
			<LineBadge {...row.badge} />
			<AppText className="flex-1" numberOfLines={1} variant="bodyMStrong">
				{row.title}
			</AppText>
		</View>
	);
}

function LineHeader({ line }: { line: SubwayLine }) {
	return (
		<View className="flex-row items-center gap-2">
			<LineBadge line={line.line} mode="subway" name={line.name} />
			<AppText variant="bodyMStrong">{line.name}</AppText>
		</View>
	);
}

/** 아래에 고정되는 버튼. 버튼을 누를 수 없는 이유(`notice`)를 버튼 바로 위에 보인다. */
function Footer({
	disabled,
	labelKey,
	notice,
	onPress,
}: {
	disabled: boolean;
	labelKey: MessageKey;
	notice?: ReactNode;
	onPress: () => void;
}) {
	return (
		<View className="gap-2">
			{notice}
			<AppButton disabled={disabled} label={t(labelKey)} onPress={onPress} />
		</View>
	);
}

/** 16a 수단. 버스와 지하철. */
export function ModeStep({
	onBus,
	onSubway,
}: {
	onBus: () => void;
	onSubway: () => void;
}) {
	return (
		<StepLayout>
			<View className="gap-1">
				<AppText accessibilityRole="header" variant="title2">
					{t("legPicker.mode.title")}
				</AppText>
				<AppText className="text-text-secondary" variant="bodyS">
					{t("legPicker.mode.body")}
				</AppText>
			</View>
			<Card>
				<ListRow
					icon={BusIcon}
					onPress={onBus}
					subtitle={t("legPicker.mode.bus.subtitle")}
					title={t("legPicker.mode.bus.title")}
					trailing={{ type: "chevron" }}
				/>
				<ListDivider inset="edge" />
				<ListRow
					icon={TrainIcon}
					onPress={onSubway}
					subtitle={t("legPicker.mode.subway.subtitle")}
					title={t("legPicker.mode.subway.title")}
					trailing={{ type: "chevron" }}
				/>
			</Card>
			<AppText className="text-text-tertiary" variant="caption">
				{t("legPicker.mode.footnote")}
			</AppText>
		</StepLayout>
	);
}

/** 16b 버스 노선 검색. 입력이 300ms 멈춘 뒤 찾는다. */
export function BusSearchStep({
	onPick,
}: {
	onPick: (route: BusRouteMatch) => void;
}) {
	const [query, setQuery] = useState("");
	const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
	const trimmed = debounced.trim();
	const search = useQuery({
		enabled: trimmed !== "",
		queryFn: () => searchBusRoutes(serverClient, trimmed),
		queryKey: ["ref", "bus-routes", trimmed],
		staleTime: REF_STALE_MS,
	});
	const view = searchView(debounced, search.data, search.isFetching);
	const retry = useCallback(() => {
		search.refetch().catch(() => undefined);
	}, [search]);
	const routes = search.data?.ok ? search.data.value : [];
	return (
		<StepLayout>
			<TextField
				accessibilityLabel={t("legPicker.search.placeholder")}
				onChangeText={setQuery}
				placeholder={t("legPicker.search.placeholder")}
				returnKeyType="search"
				value={query}
			/>
			{view === "hint" ? (
				<AppText className="text-text-tertiary" variant="caption">
					{t("legPicker.search.hint")}
				</AppText>
			) : null}
			{view === "loading" ? <Loading /> : null}
			{view === "failed" ? <Failed onRetry={retry} /> : null}
			{view === "empty" ? (
				<EmptyState
					body={t("legPicker.empty.body")}
					icon={
						<Search
							colorClassName="accent-icon-secondary"
							size={STATE_ICON_SIZE}
						/>
					}
					title={t("legPicker.empty.title")}
				/>
			) : null}
			{view === "results" ? (
				<>
					<AppText
						accessibilityLiveRegion="polite"
						className="text-text-tertiary"
						variant="caption"
					>
						{t("legPicker.search.count", { n: routes.length })}
					</AppText>
					<Card>
						{routes.map((route, index) => (
							<View key={route.line}>
								{index > 0 ? <ListDivider inset="edge" /> : null}
								<RouteResultRow onPick={onPick} route={route} />
							</View>
						))}
					</Card>
				</>
			) : null}
		</StepLayout>
	);
}

function useBusStops(route: BusRouteMatch) {
	return useQuery({
		queryFn: () => busRouteStops(serverClient, route.line),
		queryKey: ["ref", "bus-stops", route.line],
		staleTime: REF_STALE_MS,
	});
}

/** 16c 승차 정류장. 마지막 정류장은 고를 수 없다. */
export function BusBoardStep({
	onPick,
	route,
}: {
	onPick: (stop: BusStop) => void;
	route: BusRouteMatch;
}) {
	const stops = useBusStops(route);
	const [board, setBoard] = useState<BusStop | null>(null);
	const retry = useCallback(() => {
		stops.refetch().catch(() => undefined);
	}, [stops]);
	const next = useCallback(() => {
		if (board !== null) {
			onPick(board);
		}
	}, [board, onPick]);
	const choices = stops.data?.ok ? boardChoices(stops.data.value.stops, t) : [];
	return (
		<StepLayout
			footer={
				<Footer
					disabled={board === null}
					labelKey="legPicker.next"
					onPress={next}
				/>
			}
		>
			<RouteHeader route={route} />
			<StepHeader title={t("legPicker.board.title")} />
			<LookupGate
				onRetry={retry}
				view={lookupView(stops.isFetching ? undefined : stops.data)}
			>
				<Card>
					{choices.map((choice, index) => (
						<View key={`${choice.stop.stop}-${choice.stop.seq}`}>
							{index > 0 ? <ListDivider inset="edge" /> : null}
							<BusStopRow
								choice={choice}
								onPick={setBoard}
								selected={board?.seq === choice.stop.seq}
								sub={choice.sub}
							/>
						</View>
					))}
				</Card>
			</LookupGate>
		</StepLayout>
	);
}

/** 16c 하차 정류장. 승차 정류장과 그 앞은 고를 수 없다. */
export function BusAlightStep({
	board,
	onDone,
	route,
}: {
	board: BusStop;
	onDone: (leg: Leg) => void;
	route: BusRouteMatch;
}) {
	const stops = useBusStops(route);
	const [alight, setAlight] = useState<BusStop | null>(null);
	const retry = useCallback(() => {
		stops.refetch().catch(() => undefined);
	}, [stops]);
	const choices = stops.data?.ok
		? alightChoices(stops.data.value.stops, board, t)
		: [];
	const done = useCallback(() => {
		if (alight !== null) {
			onDone(busLeg(route, board, alight));
		}
	}, [alight, board, onDone, route]);
	return (
		<StepLayout
			footer={
				<Footer
					disabled={alight === null}
					labelKey="legPicker.addLeg"
					onPress={done}
				/>
			}
		>
			<RouteHeader route={route} />
			<StepHeader
				body={t("legPicker.alight.body", { stop: board.name })}
				title={t("legPicker.alight.title")}
			/>
			<LookupGate
				onRetry={retry}
				view={lookupView(stops.isFetching ? undefined : stops.data)}
			>
				<Card>
					{choices.map((choice, index) => {
						const isBoard = choice.stop.seq === board.seq;
						return (
							<View key={`${choice.stop.stop}-${choice.stop.seq}`}>
								{index > 0 ? <ListDivider inset="edge" /> : null}
								<BusStopRow
									choice={choice}
									onPick={setAlight}
									selected={alight?.seq === choice.stop.seq}
									sub={isBoard ? t("legPicker.boardMark") : choice.sub}
								/>
							</View>
						);
					})}
				</Card>
			</LookupGate>
		</StepLayout>
	);
}

/** 16d 지하철 노선. */
export function SubwayLineStep({
	onPick,
}: {
	onPick: (line: SubwayLine) => void;
}) {
	const lines = useQuery({
		queryFn: () => subwayLines(serverClient),
		queryKey: ["ref", "subway-lines"],
		staleTime: REF_STALE_MS,
	});
	const retry = useCallback(() => {
		lines.refetch().catch(() => undefined);
	}, [lines]);
	const items = lines.data?.ok ? lines.data.value : [];
	return (
		<StepLayout>
			<StepHeader
				lead={t("legPicker.subwayLines.steps")}
				title={t("legPicker.subwayLines.title")}
			/>
			<LookupGate
				onRetry={retry}
				view={lookupView(lines.isFetching ? undefined : lines.data)}
			>
				<Card>
					{items.map((line, index) => (
						<View key={line.line}>
							{index > 0 ? <ListDivider inset="edge" /> : null}
							<SubwayLineRow line={line} onPick={onPick} />
						</View>
					))}
				</Card>
			</LookupGate>
		</StepLayout>
	);
}

function useSubwayStations(line: SubwayLine) {
	return useQuery({
		queryFn: () => subwayStations(serverClient, line.line),
		queryKey: ["ref", "subway-stations", line.line],
		staleTime: REF_STALE_MS,
	});
}

/** 지선마다 머리와 역 목록. 지선이 하나면 머리를 그리지 않는다. */
function BranchList({
	board,
	branches,
	onPick,
	selected,
}: {
	board: StationPick | null;
	branches: BranchChoices[];
	onPick: (station: StationPick) => void;
	selected: string | null;
}) {
	const showHeadings = branches.length > 1;
	return (
		<>
			{branches.map((branch, branchIndex) => {
				const unavailable =
					board !== null && isBranchUnavailable(branch, board.stop);
				return (
					<View className="gap-2" key={branch.branchKey}>
						{showHeadings ? (
							<AppText className="text-text-secondary" variant="labelS">
								{branchLabel(branch.branchKey, branchIndex, t)}
							</AppText>
						) : null}
						{unavailable && board !== null ? (
							<AppText className="text-text-tertiary" variant="caption">
								{t("legPicker.branchUnavailable", { stop: board.name })}
							</AppText>
						) : null}
						<Card>
							{branch.stations.map((station, index) => (
								<View
									// biome-ignore lint/suspicious/noArrayIndexKey: a loop branch lists the same station twice, so the position is part of its identity
									key={`${station.stop}-${index}`}
								>
									{index > 0 ? <ListDivider inset="edge" /> : null}
									<StationRow
										disabled={station.disabled}
										name={station.name}
										onPick={onPick}
										selected={selected === station.stop}
										stop={station.stop}
										sub={
											board?.stop === station.stop
												? t("legPicker.boardMark")
												: null
										}
									/>
								</View>
							))}
						</Card>
					</View>
				);
			})}
		</>
	);
}

/** 16d 승차역. */
export function SubwayBoardStep({
	line,
	onPick,
}: {
	line: SubwayLine;
	onPick: (station: StationPick) => void;
}) {
	const stations = useSubwayStations(line);
	const [board, setBoard] = useState<StationPick | null>(null);
	const retry = useCallback(() => {
		stations.refetch().catch(() => undefined);
	}, [stations]);
	const next = useCallback(() => {
		if (board !== null) {
			onPick(board);
		}
	}, [board, onPick]);
	const branches = stations.data?.ok
		? subwayBoardChoices(stations.data.value)
		: [];
	return (
		<StepLayout
			footer={
				<Footer
					disabled={board === null}
					labelKey="legPicker.next"
					onPress={next}
				/>
			}
		>
			<LineHeader line={line} />
			<StepHeader title={t("legPicker.board.title")} />
			<LookupGate
				onRetry={retry}
				view={lookupView(stations.isFetching ? undefined : stations.data)}
			>
				<BranchList
					board={null}
					branches={branches}
					onPick={setBoard}
					selected={board?.stop ?? null}
				/>
			</LookupGate>
		</StepLayout>
	);
}

/** 하차역을 고른 뒤 두 역 사이를 묻는 동안, 한 번에 못 갈 때, 묻지 못했을 때의 안내. 버튼 바로 위에 둔다. */
function DirectionNotice({
	onRetry,
	state,
}: {
	onRetry: () => void;
	state: DirectionView | null;
}) {
	if (state === "checking") {
		return (
			<AppText
				accessibilityLiveRegion="polite"
				className="text-center text-text-tertiary"
				variant="caption"
			>
				{t("legPicker.checking")}
			</AppText>
		);
	}
	if (state === "not-direct") {
		return (
			<InlineNotice
				body={t("legPicker.notDirect.body")}
				title={t("legPicker.notDirect.title")}
				tone="alert"
			/>
		);
	}
	if (state === "failed") {
		return (
			<InlineNotice
				action={
					<AppButton
						label={t("legPicker.retry")}
						onPress={onRetry}
						size="medium"
						variant="secondary"
					/>
				}
				body={t("legPicker.failed.body")}
				title={t("legPicker.failed.title")}
				tone="alert"
			/>
		);
	}
	return null;
}

/** 16d 하차역. 고르면 두 역 사이 방향을 묻고, 한 번에 못 가면(`not-direct`) 다시 고르게 한다. */
export function SubwayAlightStep({
	board,
	line,
	onDone,
}: {
	board: StationPick;
	line: SubwayLine;
	onDone: (leg: Leg) => void;
}) {
	const stations = useSubwayStations(line);
	const [alight, setAlight] = useState<StationPick | null>(null);
	const direction = useQuery({
		enabled: alight !== null,
		queryFn: () =>
			subwayDirection(serverClient, line.line, board.stop, alight?.stop ?? ""),
		queryKey: ["ref", "subway-direction", line.line, board.stop, alight?.stop],
		staleTime: REF_STALE_MS,
	});
	const retryStations = useCallback(() => {
		stations.refetch().catch(() => undefined);
	}, [stations]);
	const retryDirection = useCallback(() => {
		direction.refetch().catch(() => undefined);
	}, [direction]);
	const branches = stations.data?.ok
		? subwayAlightChoices(stations.data.value, board.stop)
		: [];
	const directionState =
		alight === null
			? null
			: directionView(direction.data, direction.isFetching);
	const done = useCallback(() => {
		if (alight !== null && direction.data?.ok) {
			onDone(subwayLeg(line, board, alight, direction.data.value.direction));
		}
	}, [alight, board, direction.data, line, onDone]);
	return (
		<StepLayout
			footer={
				<Footer
					disabled={directionState !== "ready"}
					labelKey="legPicker.addLeg"
					notice={
						<DirectionNotice onRetry={retryDirection} state={directionState} />
					}
					onPress={done}
				/>
			}
		>
			<LineHeader line={line} />
			<StepHeader
				body={t("legPicker.alight.subwayBody", { stop: board.name })}
				title={t("legPicker.alight.title")}
			/>
			<LookupGate
				onRetry={retryStations}
				view={lookupView(stations.isFetching ? undefined : stations.data)}
			>
				<BranchList
					board={board}
					branches={branches}
					onPick={setAlight}
					selected={alight?.stop ?? null}
				/>
			</LookupGate>
		</StepLayout>
	);
}
