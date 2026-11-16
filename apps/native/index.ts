// Custom entry: the background FCM handler has to be registered before expo-router boots
// the React tree, otherwise headless (killed-app) data messages are dropped.
import "./lib/push/background";

import { AppRegistry } from "react-native";

import {
	COMMUTE_ACTION_TASK,
	runCommuteAction,
} from "./lib/commute/app-commute";

// Android 알림의 "종료"가 앱 화면 없이 돌리는 태스크(Kotlin `CommuteActionTaskService`).
AppRegistry.registerHeadlessTask(COMMUTE_ACTION_TASK, () => runCommuteAction);

import "expo-router/entry";
