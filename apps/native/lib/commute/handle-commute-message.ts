import type { MessageKey, MessageParams } from "../i18n/translate";
import type { ServerClient } from "../server/api-client";
import { parseContentState } from "./content-state";
import { lockScreenModel } from "./lock-screen-model";
import {
	type NotificationContent,
	notificationContent,
} from "./notification-content";

/** `CommuteNotification.show`에 넘기는 값(모듈의 `ShowInput`과 같은 모양). */
export interface ShowRequest {
	channelName: string;
	content: NotificationContent;
	endLabel: string;
	/** 알림을 누르면 이 예약의 17을 연다(`Betro://commute?plan=`). */
	planId: string;
	seq: number;
	sessionId: string;
}

export interface CommuteNotifierPort {
	end: (sessionId: string) => void;
	show: (input: ShowRequest) => boolean;
}

export interface CommuteMessageDeps {
	client: ServerClient;
	/**
	 * 설정의 "출퇴근 잠금화면 안내"가 켜져 있는지. false면 그리지 않고 떠 있는 알림을 지운다.
	 * 없으면 켜진 것으로 본다.
	 */
	enabled?: () => boolean;
	/** 기기가 저장한 planId별 머리줄. 모르면 null. */
	header: (planId: string) => Promise<string | null>;
	notifier: CommuteNotifierPort;
	/** epoch ms */
	now: () => number;
	t: (key: MessageKey, params?: MessageParams) => string;
	timezone: string;
}

export type CommuteMessageResult = "shown" | "ended" | "stale" | "ignored";

/** 강제 종료 동안 쌓였다가 늦게 온 메시지는 그리지 않는다. */
const MAX_AGE_SECONDS = 10 * 60;
const MS_PER_SECOND = 1000;

function parseJson(text: string | undefined): unknown {
	if (text === undefined) {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function acknowledge(
	client: ServerClient,
	sessionId: string,
	shownAt: number
): Promise<void> {
	try {
		await client.request(
			"POST",
			`/v1/commute/sessions/${encodeURIComponent(sessionId)}/ack`,
			{ shownAt }
		);
	} catch {
		// 알림은 이미 그렸다. 서버 기록이 빠질 뿐이다.
	}
}

/**
 * Android에서 출퇴근 FCM 데이터 메시지(`type: "commute"`)를 받아 진행 중 알림을 그리거나 지운다.
 * 헤드리스(앱 꺼짐)와 포그라운드 수신이 같은 처리기를 쓴다.
 */
export async function handleCommuteMessage(
	data: Record<string, string>,
	deps: CommuteMessageDeps
): Promise<CommuteMessageResult> {
	const { sessionId, planId, event } = data;
	if (data.type !== "commute" || !sessionId || !planId) {
		return "ignored";
	}
	// 끝내는 데는 sessionId만 있으면 된다. 값을 읽지 못해도 알림이 남지 않게 먼저 본다.
	if (event === "end") {
		deps.notifier.end(sessionId);
		return "ended";
	}
	// 꺼 둔 뒤 서버가 아직 모르고 보낸 값이면(꺼짐이 서버에 닿기 전) 그리지 않고 남은 알림도 치운다.
	if (deps.enabled?.() === false) {
		deps.notifier.end(sessionId);
		return "ignored";
	}
	const state = parseContentState(parseJson(data.state));
	if (state === null) {
		return "ignored";
	}
	if (state.stage === "ended") {
		deps.notifier.end(sessionId);
		return "ended";
	}
	const nowMs = deps.now();
	const now = nowMs / MS_PER_SECOND;
	if (now - state.sentAt > MAX_AGE_SECONDS) {
		return "stale";
	}
	const model = lockScreenModel(state, {
		header: await deps.header(planId),
		now,
		platform: "android",
		t: deps.t,
		timezone: deps.timezone,
	});
	const shown = deps.notifier.show({
		channelName: deps.t("commute.notification.channel"),
		content: notificationContent(
			model,
			nowMs,
			deps.t("commute.lock.minutes.soon")
		),
		endLabel: deps.t("commute.lock.action.end"),
		planId,
		seq: state.seq,
		sessionId,
	});
	if (!shown) {
		return "stale";
	}
	if (event === "start") {
		await acknowledge(deps.client, sessionId, nowMs);
	}
	return "shown";
}
