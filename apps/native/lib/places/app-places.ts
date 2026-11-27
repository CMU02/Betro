import Storage from "expo-sqlite/kv-store";
import { Platform } from "react-native";
import { serverGuidanceEnabled } from "@/lib/commute/lock-screen-readiness";
import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import { t } from "@/lib/i18n/t";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { serverClient } from "@/lib/server/app-server";
import { CommuteActivity } from "@/modules/commute-activity";

import { createPlacesStore } from "./places-store";
import { reconcile, type SyncDeps } from "./plan-sync";
import { createSyncFlow } from "./sync-flow";

/** 앱 전체가 쓰는 장소 저장소 하나. */
export const appPlaces = createPlacesStore({
	getItem: (key) => Storage.getItemSync(key),
	setItem: (key, value) => {
		Storage.setItemSync(key, value);
	},
});

/** 화면이 `savePlace`, `deletePlace`에 넘기는 값. 머리줄을 넘기지 못해도 저장 결과는 그대로 돌려준다. */
export const appSyncDeps: SyncDeps = {
	client: serverClient,
	// `app-lock-screen`의 `lockScreenPlatform`은 이 파일을 가져와 순환하므로 Platform을 바로 본다.
	guidanceEnabled: () =>
		serverGuidanceEnabled(
			Platform.OS === "ios" ? "ios" : "android",
			appPreferences.get().commuteLiveActivityEnabled
		),
	now: Date.now,
	setHeaders: async (headers) => {
		try {
			await CommuteActivity.setPlanHeaders(headers);
		} catch (error) {
			reportError(appCrashSink, error, "plan-headers");
		}
	},
	store: appPlaces,
	t,
};

/** 등록 뒤와 앱이 앞으로 올 때 부른다. 겹쳐 돌지 않고, 실패는 `places-sync`로 기록한다. */
export const appPlacesSync = createSyncFlow({
	reconcile: () => reconcile(appSyncDeps),
	sink: appCrashSink,
});
