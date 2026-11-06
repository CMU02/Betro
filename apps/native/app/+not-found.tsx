import { Link, Stack } from "expo-router";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";

export default function NotFoundScreen() {
	return (
		<>
			<Stack.Screen options={{ headerShown: false }} />
			<Screen>
				<View className="flex-1 items-center justify-center gap-4 px-6">
					<AppText variant="title2">페이지를 찾을 수 없어요</AppText>
					<Link href="/" replace>
						<AppText className="text-text-accent" variant="labelM">
							지도로 돌아가기
						</AppText>
					</Link>
				</View>
			</Screen>
		</>
	);
}
