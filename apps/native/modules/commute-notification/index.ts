import { requireOptionalNativeModule } from "expo";

import type { NotificationContent } from "@/lib/commute/notification-content";

export interface ShowInput {
	channelName: string;
	content: NotificationContent;
	endLabel: string;
	seq: number;
	sessionId: string;
}

export interface CommuteNotifier {
	/** 알림을 지우고 그 세션을 끝난 것으로 적는다. 그 뒤 같은 세션의 `show`는 false다. */
	end: (sessionId: string) => void;
	/** 그 세션에서 이미 그린 `seq`보다 크면 그리고 true, 옛 값이나 끝난 세션이면 false. */
	show: (input: ShowInput) => boolean;
}

/** Android 전용 모듈. iOS에서는 없으므로 null이다. */
export const CommuteNotification = requireOptionalNativeModule<CommuteNotifier>(
	"CommuteNotification"
);
