import { View } from "react-native";

import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";

/**
 * 장소가 하나도 없을 때 지도 위 카드(지도 설계 2.5). 화면을 막지 않고, 주 버튼은 15 내 장소로 간다.
 * "어디로 가세요?"(길찾기)는 길찾기가 붙기 전까지 그리지 않는다(지도 설계 6장).
 */
export function EmptyCard({
	bottomOffset,
	onRegister,
}: {
	bottomOffset: number;
	onRegister: () => void;
}) {
	return (
		<View
			className="absolute inset-x-4 gap-3 rounded-xl bg-bg-surface p-4"
			style={{ bottom: bottomOffset }}
		>
			<View className="gap-1">
				<AppText variant="title3">{t("map.empty.title")}</AppText>
				<AppText className="text-text-secondary" variant="bodyS">
					{t("map.empty.body")}
				</AppText>
			</View>
			<AppButton label={t("map.empty.register")} onPress={onRegister} />
		</View>
	);
}
