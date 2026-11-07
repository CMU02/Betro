import { type BottomTabBarProps, Tabs } from "expo-router/js-tabs";

import { TabBar } from "@/components/navigation/tab-bar";
import { TABS } from "@/components/navigation/tabs";
import { t } from "@/lib/i18n/t";

const SCREEN_OPTIONS = { headerShown: false } as const;

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

export default function TabsLayout() {
	return (
		<Tabs screenOptions={SCREEN_OPTIONS} tabBar={renderTabBar}>
			{TABS.map((tab) => (
				<Tabs.Screen
					key={tab.name}
					name={tab.name}
					options={{ title: t(tab.labelKey) }}
				/>
			))}
		</Tabs>
	);
}
