import { type BottomTabBarProps, Tabs } from "expo-router/js-tabs";

import { TabBar } from "@/components/navigation/tab-bar";
import { TABS } from "@/components/navigation/tabs";

const SCREEN_OPTIONS = { headerShown: false } as const;

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

export default function TabsLayout() {
	return (
		<Tabs screenOptions={SCREEN_OPTIONS} tabBar={renderTabBar}>
			{TABS.map((tab) => (
				<Tabs.Screen
					key={tab.name}
					name={tab.name}
					options={{ title: tab.label }}
				/>
			))}
		</Tabs>
	);
}
