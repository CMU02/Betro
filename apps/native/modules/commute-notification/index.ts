import { requireOptionalNativeModule } from "expo";

import type { NotificationContent } from "@/lib/commute/notification-content";

export interface ShowInput {
	channelName: string;
	content: NotificationContent;
	endLabel: string;
	/** 알림을 누르면 이 예약의 17을 연다(`Betro://commute?plan=`). */
	planId: string;
	seq: number;
	sessionId: string;
}

export interface CommuteNotifier {
	/** 알림을 지우고 그 세션을 끝난 것으로 적는다. 그 뒤 같은 세션의 `show`는 false다. */
	end: (sessionId: string) => void;
	/**
	 * 떠 있는 알림과 타이머 알람만 지운다(설정에서 잠금화면 안내를 끌 때). 세션을 끝난 것으로 적지 않아
	 * 다시 켜면 같은 세션의 다음 메시지를 그린다.
	 */
	hideAll: () => void;
	/** 그 세션에서 이미 그린 `seq`보다 크면 그리고 true, 옛 값이나 끝난 세션이면 false. */
	show: (input: ShowInput) => boolean;
}

/** Android 전용 모듈. iOS에서는 없으므로 null이다. */
export const CommuteNotification = requireOptionalNativeModule<CommuteNotifier>(
	"CommuteNotification"
);
