import type { Leg } from "@Betro/commute/plan";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BackHandler, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	BusAlightStep,
	BusBoardStep,
	BusSearchStep,
	ModeStep,
	SubwayAlightStep,
	SubwayBoardStep,
	SubwayLineStep,
} from "@/components/places/leg-steps";
import { TopBar } from "@/components/ui/top-bar";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import {
	busMetaOf,
	type LegStep,
	previousStep,
} from "@/lib/places/leg-picker-model";
import type { BusMeta } from "@/lib/places/places";
import { appSetupDraft } from "@/lib/places/setup-draft";
import { parseRouteIndex, routeWithLeg } from "@/lib/places/setup-form-model";
import type { BusRouteMatch, BusStop, SubwayLine } from "@/lib/ref/ref-client";

const TITLE_KEYS: Record<LegStep["kind"], MessageKey> = {
	"bus-alight": "legPicker.alight.topBar",
	"bus-board": "legPicker.board.topBar",
	"bus-search": "legPicker.search.topBar",
	mode: "legPicker.mode.topBar",
	"subway-alight": "legPicker.alight.topBarSubway",
	"subway-board": "legPicker.board.topBarSubway",
	"subway-line": "legPicker.subwayLines.topBar",
};

const FIRST_STEP: LegStep = { kind: "mode" };

function StepBody({
	onDone,
	setStep,
	step,
}: {
	onDone: (leg: Leg, busMeta?: BusMeta) => void;
	setStep: (step: LegStep) => void;
	step: LegStep;
}) {
	// 버스 구간에는 노선 종류·지역이 없어서, 고른 노선에서 따로 넘겨 배지 색을 기기에 남긴다.
	const finishBus = useCallback(
		(leg: Leg) => {
			if (step.kind === "bus-alight") {
				onDone(leg, busMetaOf(step.route));
			}
		},
		[onDone, step]
	);
	const pickRoute = useCallback(
		(route: BusRouteMatch) => setStep({ kind: "bus-board", route }),
		[setStep]
	);
	const pickBoard = useCallback(
		(board: BusStop) => {
			if (step.kind === "bus-board") {
				setStep({ board, kind: "bus-alight", route: step.route });
			}
		},
		[setStep, step]
	);
	const pickLine = useCallback(
		(line: SubwayLine) => setStep({ kind: "subway-board", line }),
		[setStep]
	);
	const pickStation = useCallback(
		(board: { name: string; stop: string }) => {
			if (step.kind === "subway-board") {
				setStep({ board, kind: "subway-alight", line: step.line });
			}
		},
		[setStep, step]
	);
	const chooseBus = useCallback(
		() => setStep({ kind: "bus-search" }),
		[setStep]
	);
	const chooseSubway = useCallback(
		() => setStep({ kind: "subway-line" }),
		[setStep]
	);

	switch (step.kind) {
		case "mode":
			return <ModeStep onBus={chooseBus} onSubway={chooseSubway} />;
		case "bus-search":
			return <BusSearchStep onPick={pickRoute} />;
		case "bus-board":
			return <BusBoardStep onPick={pickBoard} route={step.route} />;
		case "bus-alight":
			return (
				<BusAlightStep
					board={step.board}
					onDone={finishBus}
					route={step.route}
				/>
			);
		case "subway-line":
			return <SubwayLineStep onPick={pickLine} />;
		case "subway-board":
			return <SubwayBoardStep line={step.line} onPick={pickStation} />;
		case "subway-alight":
			return (
				<SubwayAlightStep board={step.board} line={step.line} onDone={onDone} />
			);
		default:
			return null;
	}
}

/**
 * 16 구간 고르기. 한 화면 안에서 수단 → (버스) 검색 → 승차 → 하차 / (지하철) 노선 → 승차역 → 하차역으로
 * 단계가 바뀐다. 다 고르면 등록 화면의 임시 값에 쓰고 돌아간다. 뒤로 가기는 한 단계씩 돌아간다.
 */
export default function LegPickerScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const params = useLocalSearchParams<{ route: string }>();
	const draft = useSyncExternalStore(
		appSetupDraft.subscribe,
		appSetupDraft.get
	);
	const routeIndex =
		draft === null ? null : parseRouteIndex(params.route, draft.routes.length);
	const [step, setStep] = useState<LegStep>(FIRST_STEP);

	const goBack = useCallback(() => {
		const previous = previousStep(step);
		if (previous === null) {
			router.back();
			return;
		}
		setStep(previous);
	}, [router, step]);

	useEffect(() => {
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			() => {
				const previous = previousStep(step);
				if (previous === null) {
					return false;
				}
				setStep(previous);
				return true;
			}
		);
		return () => subscription.remove();
	}, [step]);

	const finish = useCallback(
		(leg: Leg, busMeta?: BusMeta) => {
			const current = appSetupDraft.get();
			if (current !== null && routeIndex !== null) {
				if (busMeta !== undefined) {
					appSetupDraft.update({
						busMeta: { ...current.busMeta, [leg.line]: busMeta },
					});
				}
				appSetupDraft.setRoute(
					routeIndex,
					routeWithLeg(current.routes, routeIndex, leg)
				);
			}
			router.back();
		},
		[routeIndex, router]
	);

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			{/* 첫 단계가 아니면 iOS 밀어서 뒤로 가기가 화면을 통째로 닫지 않게 막는다. */}
			<Stack.Screen options={{ gestureEnabled: step.kind === "mode" }} />
			<TopBar onBack={goBack} title={t(TITLE_KEYS[step.kind])} />
			{routeIndex === null ? null : (
				<StepBody onDone={finish} setStep={setStep} step={step} />
			)}
		</View>
	);
}
