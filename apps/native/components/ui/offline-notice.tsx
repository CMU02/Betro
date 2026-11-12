import { View } from "react-native";

import { InlineNotice } from "@/components/ui/inline-notice";
import { t } from "@/lib/i18n/t";
import { useOffline } from "@/lib/network/app-reachability";

export interface OfflineNoticeProps {
	/** 안내를 감싸는 여백. 안내가 없을 때는 여백도 그리지 않는다. */
	className?: string;
}

/** 서버에 닿지 않을 때만 보이는 안내. 연결이 돌아오면 저절로 사라진다. */
export function OfflineNotice({ className }: OfflineNoticeProps) {
	const offline = useOffline();
	if (!offline) {
		return null;
	}
	return (
		<View className={className}>
			<InlineNotice
				body={t("network.offline.body")}
				title={t("network.offline.title")}
				tone="alert"
			/>
		</View>
	);
}
