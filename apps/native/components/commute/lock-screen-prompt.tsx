import { useCallback } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import type { LockScreenPromptModel } from "@/lib/commute/lock-screen-readiness";
import {
	useLockScreenFix,
	useLockScreenReadiness,
} from "@/lib/commute/use-lock-screen";
import { t } from "@/lib/i18n/t";

/** 홈 인디케이터 위 여백 */
const BOTTOM_GAP = 8;

export interface LockScreenPromptProps {
	model: LockScreenPromptModel;
	/** 고쳤거나(허용·설정 앱으로 감) "나중에"를 골랐다. 장소 설정 화면이 이어서 닫힌다. */
	onDone: () => void;
}

/**
 * 장소를 저장했는데 잠금화면 안내가 뜨지 않을 때 한 번 묻는 아래 시트. [알림 받기]는 알림을 묻고
 * (이번에 거부되면 다음 누름은 설정 앱), 실시간 현황이 꺼졌으면 설정 앱을 연다. [나중에]·바깥 누름·뒤로 가기는 닫는다.
 */
export function LockScreenPrompt({ model, onDone }: LockScreenPromptProps) {
	const insets = useSafeAreaInsets();
	const { readiness, system } = useLockScreenReadiness();
	const fix = useLockScreenFix(readiness, system);
	const { action, run } = fix;
	const handlePrimary = useCallback(() => {
		const opensSettings = action === "openSettings";
		run()
			.then((granted) => {
				// 거부되면 시트를 둔다. 다음 누름은 설정 앱을 연다.
				if (granted || opensSettings || action === "none") {
					onDone();
				}
			})
			.catch(() => onDone());
	}, [action, onDone, run]);
	return (
		<Modal
			animationType="slide"
			navigationBarTranslucent
			onRequestClose={onDone}
			statusBarTranslucent
			transparent
			visible
		>
			<View className="flex-1 justify-end">
				<Pressable
					accessibilityElementsHidden
					className="absolute inset-0 bg-bg-scrim"
					importantForAccessibility="no-hide-descendants"
					onPress={onDone}
				/>
				<View
					accessibilityViewIsModal
					className="gap-5 rounded-t-xl bg-bg-surface px-4 pt-3"
					style={{ paddingBottom: insets.bottom + BOTTOM_GAP }}
				>
					<View className="h-1 w-9 self-center rounded-full bg-border-strong" />
					<View className="gap-2">
						<AppText accessibilityRole="header" variant="title3">
							{model.title}
						</AppText>
						<AppText className="text-text-secondary" variant="bodyM">
							{model.body}
						</AppText>
					</View>
					<View className="gap-2">
						<AppButton
							accessibilityState={{ busy: fix.pending }}
							disabled={fix.pending}
							label={
								action === "openSettings"
									? t("lockScreen.prompt.openSettings")
									: model.primary
							}
							onPress={handlePrimary}
						/>
						<AppButton
							label={t("lockScreen.prompt.later")}
							onPress={onDone}
							variant="ghost"
						/>
					</View>
				</View>
			</View>
		</Modal>
	);
}
