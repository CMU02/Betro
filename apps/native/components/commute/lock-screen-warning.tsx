import { useCallback } from "react";

import { AppButton } from "@/components/ui/app-button";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
	fixLabelKey,
	isLockScreenBlocked,
	type LockScreenReadiness,
	type LockScreenSystemState,
} from "@/lib/commute/lock-screen-readiness";
import { useLockScreenFix } from "@/lib/commute/use-lock-screen";
import { t } from "@/lib/i18n/t";

export interface LockScreenWarningProps {
	readiness: LockScreenReadiness | null;
	system: LockScreenSystemState | null;
}

/**
 * 잠금화면 안내가 이 기기에 뜨지 않을 때 "…부터 잠금화면에 떠요" 대신 보이는 안내와 고치는 버튼
 * (알림 켜기, 설정 열기, 안내 켜기). 뜰 수 있거나 아직 모르면 아무것도 그리지 않는다.
 */
export function LockScreenWarning({
	readiness,
	system,
}: LockScreenWarningProps) {
	const fix = useLockScreenFix(readiness, system);
	const { run } = fix;
	const handlePress = useCallback(() => {
		run().catch(() => undefined);
	}, [run]);
	if (!isLockScreenBlocked(readiness)) {
		return null;
	}
	const labelKey = fixLabelKey(fix.action);
	return (
		<InlineNotice
			action={
				labelKey === null ? undefined : (
					<AppButton
						accessibilityState={{ busy: fix.pending }}
						disabled={fix.pending}
						label={t(labelKey)}
						onPress={handlePress}
						size="medium"
						variant="secondary"
					/>
				)
			}
			body={t(`lockScreen.warning.${readiness}`)}
			tone="alert"
		/>
	);
}
