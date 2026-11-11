import { DEFAULT_LEAD_MINUTES } from "@Betro/commute/config";
import { randomUUID } from "expo-crypto";
import { Stack, useNavigation, useRouter } from "expo-router";
import { Trash2Icon } from "lucide-react-native";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { AddRowButton, RouteCard } from "@/components/places/route-card";
import { TimeRow } from "@/components/places/time-row";
import { WeekdayPicker } from "@/components/places/weekday-picker";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { Chip } from "@/components/ui/chip";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ListRow } from "@/components/ui/list-row";
import { TextField } from "@/components/ui/text-field";
import { TopBar } from "@/components/ui/top-bar";
import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import { appSyncDeps } from "@/lib/places/app-places";
import type { Place, PlaceKind } from "@/lib/places/places";
import { deletePlace, savePlace } from "@/lib/places/plan-sync";
import type { RouteDraft } from "@/lib/places/route-draft";
import { runSave } from "@/lib/places/save-flow";
import { appSetupDraft, type SetupDraft } from "@/lib/places/setup-draft";
import {
	canAddAlternative,
	canAddLeg,
	destinationName,
	issueNotices,
	placeFromDraft,
	removeLegAt,
	removeRoute,
	routeRows,
	setupTitle,
	setWalkAt,
	toggleDay,
} from "@/lib/places/setup-form-model";

const Trash = withUniwind(Trash2Icon);

const DELETE_ICON_SIZE = 20;
const FOOTER_BOTTOM_PADDING = 8;
const LEG_PICKER_PATH = "/places/leg";
/** 임시 값이 시작되기 전 한 번 그릴 때 새 장소 제목에 쓰는 값 */
const NEW_PLACE_TITLE_SOURCE = { kind: "work", name: "" } as const;
/** 저장하는 동안 입력란 묶음이 터치를 받지 않게 한다. */
const LOCKED_STYLE = { pointerEvents: "none" } as const;
const UNLOCKED_STYLE = { pointerEvents: "auto" } as const;

const KINDS: readonly { key: MessageKey; kind: PlaceKind }[] = [
	{ key: "places.kind.home", kind: "home" },
	{ key: "places.kind.work", kind: "work" },
	{ key: "places.kind.school", kind: "school" },
	{ key: "places.kind.other", kind: "other" },
];

function SectionTitle({ title }: { title: string }) {
	return (
		<AppText className="text-text-secondary" variant="labelS">
			{title}
		</AppText>
	);
}

function IssueText({ messageKey }: { messageKey: MessageKey | undefined }) {
	if (messageKey === undefined) {
		return null;
	}
	return (
		<AppText
			accessibilityLiveRegion="polite"
			className="text-status-delayed"
			variant="caption"
		>
			{t(messageKey)}
		</AppText>
	);
}

function KindChip({
	kind,
	label,
	onSelect,
	selected,
}: {
	kind: PlaceKind;
	label: string;
	onSelect: (kind: PlaceKind) => void;
	selected: boolean;
}) {
	const handlePress = useCallback(() => onSelect(kind), [kind, onSelect]);
	return <Chip label={label} onPress={handlePress} selected={selected} />;
}

/** 경로 하나의 카드. 기본 경로(0)와 대안(1~)이 같은 모양이다. */
function DraftRouteCard({
	destination,
	index,
	onAddLeg,
	route,
	routes,
}: {
	destination: string;
	index: number;
	onAddLeg: (routeIndex: number) => void;
	route: RouteDraft;
	routes: RouteDraft[];
}) {
	const handleAddLeg = useCallback(() => onAddLeg(index), [index, onAddLeg]);
	const handleRemoveLeg = useCallback(
		(legIndex: number) =>
			appSetupDraft.update({ routes: removeLegAt(routes, index, legIndex) }),
		[index, routes]
	);
	const handleWalk = useCallback(
		(walkIndex: number, minutes: number) =>
			appSetupDraft.update({
				routes: setWalkAt(routes, index, walkIndex, minutes),
			}),
		[index, routes]
	);
	const handleRemoveRoute = useCallback(
		() => appSetupDraft.update({ routes: removeRoute(routes, index) }),
		[index, routes]
	);
	return (
		<RouteCard
			canAddLeg={canAddLeg(route)}
			header={
				index === 0
					? undefined
					: {
							onRemove: handleRemoveRoute,
							title: t("placeSetup.alternativeTitle", { n: index }),
						}
			}
			onAddLeg={handleAddLeg}
			onRemoveLeg={handleRemoveLeg}
			onWalkChange={handleWalk}
			rows={routeRows(route, destination, t)}
		/>
	);
}

function DeletePlaceButton({ onDelete }: { onDelete: () => void }) {
	const [armed, setArmed] = useState(false);
	const handlePress = useCallback(() => {
		if (armed) {
			onDelete();
			return;
		}
		setArmed(true);
	}, [armed, onDelete]);
	const cancel = useCallback(() => setArmed(false), []);
	return (
		<View className="gap-2">
			<Pressable
				accessibilityLiveRegion="polite"
				accessibilityRole="button"
				className="h-[52px] flex-row items-center justify-center gap-2 rounded-lg bg-status-delayed-soft px-5"
				onPress={handlePress}
			>
				<Trash colorClassName="accent-status-delayed" size={DELETE_ICON_SIZE} />
				<AppText className="text-status-delayed" variant="bodyMStrong">
					{armed
						? t("placeSetup.delete.confirm")
						: t("placeSetup.delete.label")}
				</AppText>
			</Pressable>
			{armed ? (
				<AppButton
					label={t("placeSetup.delete.cancel")}
					onPress={cancel}
					variant="ghost"
				/>
			) : null}
		</View>
	);
}

function SetupBody({
	draft,
	locked,
	mode,
	notices,
	onAddLeg,
	onDelete,
}: {
	draft: SetupDraft;
	/** 저장 중이면 true. 이미 눌러 둔 이름 칸에도 더 쓰지 못하게 한다. */
	locked: boolean;
	mode: "new" | "edit";
	notices: ReturnType<typeof issueNotices>;
	onAddLeg: (routeIndex: number) => void;
	onDelete: () => void;
}) {
	const { routes } = draft;
	const destination = destinationName(draft, t);
	const [primary, ...alternatives] = routes;
	const selectKind = useCallback(
		(kind: PlaceKind) => appSetupDraft.update({ kind }),
		[]
	);
	const changeName = useCallback(
		(name: string) => appSetupDraft.update({ name }),
		[]
	);
	const changeLeave = useCallback(
		(leaveMinute: number) => appSetupDraft.update({ leaveMinute }),
		[]
	);
	const toggle = useCallback((day: number) => {
		const current = appSetupDraft.get();
		if (current !== null) {
			appSetupDraft.update({ days: toggleDay(current.days, day) });
		}
	}, []);
	const changeHolidays = useCallback(
		(includeHolidays: boolean) => appSetupDraft.update({ includeHolidays }),
		[]
	);
	const addAlternative = useCallback(
		() => onAddLeg(routes.length),
		[onAddLeg, routes.length]
	);
	return (
		<>
			<View className="gap-2">
				<SectionTitle title={t("placeSetup.sections.kind")} />
				<View className="flex-row flex-wrap gap-2">
					{KINDS.map(({ key, kind }) => (
						<KindChip
							key={kind}
							kind={kind}
							label={t(key)}
							onSelect={selectKind}
							selected={draft.kind === kind}
						/>
					))}
				</View>
			</View>
			{draft.kind === "other" ? (
				<View className="gap-2">
					<SectionTitle title={t("placeSetup.name.label")} />
					<TextField
						accessibilityLabel={t("placeSetup.name.label")}
						editable={!locked}
						onChangeText={changeName}
						placeholder={t("placeSetup.name.placeholder")}
						returnKeyType="done"
						value={draft.name}
					/>
					<IssueText messageKey={notices.name} />
				</View>
			) : null}
			<View className="gap-2">
				<SectionTitle title={t("placeSetup.sections.route")} />
				{primary ? (
					<DraftRouteCard
						destination={destination}
						index={0}
						onAddLeg={onAddLeg}
						route={primary}
						routes={routes}
					/>
				) : null}
				<IssueText messageKey={notices.routes} />
			</View>
			<View className="gap-2">
				<SectionTitle title={t("placeSetup.sections.alternatives")} />
				{alternatives.map((route, offset) => (
					<DraftRouteCard
						destination={destination}
						index={offset + 1}
						// biome-ignore lint/suspicious/noArrayIndexKey: alternatives have no id of their own; the rank is their position
						key={`alternative-${offset + 1}`}
						onAddLeg={onAddLeg}
						route={route}
						routes={routes}
					/>
				))}
				{canAddAlternative(routes) ? (
					<View className="rounded-lg bg-bg-surface-raised py-1">
						<AddRowButton
							label={t("placeSetup.addAlternative")}
							onPress={addAlternative}
						/>
					</View>
				) : null}
				<AppText className="text-text-tertiary" variant="caption">
					{t("placeSetup.alternativeLimit")}
				</AppText>
			</View>
			<View className="gap-2">
				<SectionTitle title={t("placeSetup.sections.leave")} />
				<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
					<TimeRow
						label={t("placeSetup.leaveTime")}
						minute={draft.leaveMinute}
						onChange={changeLeave}
					/>
					<View className="pl-4">
						<View className="h-px bg-border-subtle" />
					</View>
					<View className="px-4 pt-3 pb-4">
						<WeekdayPicker days={draft.days} onToggle={toggle} />
					</View>
				</View>
				<IssueText messageKey={notices.schedule} />
			</View>
			<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
				<ListRow
					subtitle={t("placeSetup.holidays.subtitle")}
					title={t("placeSetup.holidays.title")}
					trailing={{
						onChange: changeHolidays,
						type: "toggle",
						value: draft.includeHolidays,
					}}
				/>
			</View>
			<InlineNotice body={t("placeSetup.note", { m: DEFAULT_LEAD_MINUTES })} />
			{mode === "edit" ? <DeletePlaceButton onDelete={onDelete} /> : null}
		</>
	);
}

export interface SetupFormProps {
	mode: "new" | "edit";
	/** 고칠 장소. 새 장소면 null. */
	place: Place | null;
}

/**
 * 16 장소 설정. 장소 종류 → 이름(기타일 때) → 기본 경로 → 대안 경로 → 나가는 시각과 요일 →
 * 공휴일 → 안내 → 저장. 고르는 중인 값은 `appSetupDraft`에 두고 구간 고르기 화면과 주고받는다.
 */
export function SetupForm({ mode, place }: SetupFormProps) {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const [initialPlace] = useState(place);
	const [ids] = useState(() => ({
		placeId: randomUUID(),
		planId: randomUUID(),
	}));
	const draft = useSyncExternalStore(
		appSetupDraft.subscribe,
		appSetupDraft.get
	);
	const [attempted, setAttempted] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<MessageKey | null>(null);
	/**
	 * 저장·삭제가 도는 중이면 true. 두 번 눌러 PUT이 두 번 나가지 않게 하고, 저장 중에는 뒤로 가기와
	 * 구간 고르기도 막는다. 느린 저장이 끝나 `router.back()`이 다른 화면을 닫지 않게 하기 위해서다.
	 */
	const busy = useRef<boolean>(false);
	const navigation = useNavigation();
	/** 언마운트된 뒤 끝난 저장이 닫기나 문구를 부르지 않게 한다. */
	const mounted = useRef<boolean>(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		// 쉴 때는 false를 돌려준다. 위에 올라온 구간 고르기 화면의 뒤로 가기를 삼키지 않게 한다.
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			() => busy.current
		);
		return () => subscription.remove();
	}, []);

	useEffect(() => {
		appSetupDraft.start(initialPlace, ids);
		return () => appSetupDraft.clear();
	}, [initialPlace, ids]);

	const close = useCallback(() => {
		if (busy.current) {
			return;
		}
		router.back();
	}, [router]);

	const openLegPicker = useCallback(
		(routeIndex: number) => {
			if (busy.current) {
				return;
			}
			router.push({
				params: { route: String(routeIndex) },
				pathname: LEG_PICKER_PATH,
			});
		},
		[router]
	);

	const save = useCallback(async () => {
		const current = appSetupDraft.get();
		if (busy.current || current === null) {
			return;
		}
		const built = placeFromDraft(current, Date.now());
		if (!built.ok) {
			setAttempted(true);
			return;
		}
		await runSave({
			// 임시 값은 화면이 닫힐 때(언마운트) 지운다. 먼저 지우면 닫히는 동안 빈 화면이 보인다.
			close: () => router.back(),
			isOpen: () => mounted.current && navigation.isFocused(),
			lock: busy,
			save: () => savePlace(appSyncDeps, built.place),
			setSaving,
			showError: setSaveError,
			sink: appCrashSink,
		});
	}, [navigation, router]);

	/**
	 * 기기에서는 `deletePlace`를 부르는 순간 지워지므로 서버 응답(최대 10초)을 기다리지 않고 닫는다.
	 * 서버에서 못 지우면 지울 목록에 남아 다음 맞추기에서 다시 보낸다.
	 */
	const remove = useCallback(() => {
		if (busy.current || initialPlace === null) {
			return;
		}
		busy.current = true;
		deletePlace(appSyncDeps, initialPlace.id).catch((error: unknown) => {
			reportError(appCrashSink, error, "place-delete");
		});
		router.back();
	}, [initialPlace, router]);

	const handleSave = useCallback(() => {
		save().catch((error: unknown) => {
			reportError(appCrashSink, error, "place-save");
		});
	}, [save]);

	const notices =
		attempted && draft !== null ? issueNotices(placeIssues(draft)) : {};

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			{/* 저장하는 동안 iOS 밀어서 뒤로 가기를 막는다. */}
			<Stack.Screen options={{ gestureEnabled: !saving }} />
			<TopBar
				onBack={close}
				title={setupTitle(
					mode,
					draft ?? initialPlace ?? NEW_PLACE_TITLE_SOURCE,
					t
				)}
			/>
			<ScrollView
				contentContainerClassName="gap-6 px-4 pt-2 pb-6"
				keyboardShouldPersistTaps="handled"
			>
				{draft === null ? null : (
					<View
						accessibilityElementsHidden={saving}
						className="gap-6"
						importantForAccessibility={saving ? "no-hide-descendants" : "auto"}
						style={saving ? LOCKED_STYLE : UNLOCKED_STYLE}
					>
						<SetupBody
							draft={draft}
							locked={saving}
							mode={mode}
							notices={notices}
							onAddLeg={openLegPicker}
							onDelete={remove}
						/>
					</View>
				)}
			</ScrollView>
			<View
				className="gap-2 bg-bg-canvas px-4 pt-3"
				style={{ paddingBottom: insets.bottom + FOOTER_BOTTOM_PADDING }}
			>
				{notices.save ? (
					<InlineNotice body={t(notices.save)} tone="alert" />
				) : null}
				{saveError ? <InlineNotice body={t(saveError)} tone="alert" /> : null}
				<AppButton
					disabled={saving || draft === null}
					label={t("placeSetup.save.label")}
					onPress={handleSave}
				/>
			</View>
		</View>
	);
}

/** 저장하지 못하는 사유. 통과하면 빈 목록이다. */
function placeIssues(draft: SetupDraft) {
	const result = placeFromDraft(draft, 0);
	return result.ok ? [] : result.issues;
}
