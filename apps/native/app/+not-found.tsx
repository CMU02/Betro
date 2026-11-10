import { Link, Stack } from "expo-router";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { t } from "@/lib/i18n/t";

export default function NotFoundScreen() {
	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<Screen>
				<View className="flex-1 items-center justify-center gap-4 px-6">
					<AppText variant="title2">{t("notFound.title")}</AppText>
					<Link href="/" replace>
						<AppText className="text-text-accent" variant="labelM">
							{t("notFound.backToMap")}
						</AppText>
					</Link>
				</View>
			</Screen>
		</>
	);
}
