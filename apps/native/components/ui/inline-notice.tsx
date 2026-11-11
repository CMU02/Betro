import { CircleAlertIcon, InfoIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";

const Info = withUniwind(InfoIcon);
const Alert = withUniwind(CircleAlertIcon);

const ICON_SIZE = 20;

export interface InlineNoticeProps {
	/** 안내 아래에 두는 버튼("다시 시도" 등). */
	action?: ReactNode;
	body: string;
	title?: string;
	/** "alert"는 고를 수 없거나 실패했을 때, "info"는 안내 문구. */
	tone?: "info" | "alert";
}

/** Figma `InlineNotice`(93:2397). 화면 안 안내 상자이고 팝업이 아니다. */
export function InlineNotice({
	action,
	body,
	title,
	tone = "info",
}: InlineNoticeProps) {
	const Icon = tone === "alert" ? Alert : Info;
	return (
		<View
			accessibilityLiveRegion={tone === "alert" ? "polite" : "none"}
			className="flex-row items-start gap-2 rounded-md bg-bg-control p-3"
		>
			<Icon colorClassName="accent-icon-primary" size={ICON_SIZE} />
			<View className="flex-1 gap-0.5">
				{title ? <AppText variant="bodyMStrong">{title}</AppText> : null}
				<AppText className="text-text-secondary" variant="bodyS">
					{body}
				</AppText>
				{action ? <View className="mt-2 items-start">{action}</View> : null}
			</View>
		</View>
	);
}
