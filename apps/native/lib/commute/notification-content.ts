import type { LockScreenModel } from "./lock-screen-model";

/**
 * 타이머를 걸 만큼 남은 최소 시간(밀리초). 이보다 짧으면 타이머 대신 "곧"을 둔다.
 * 모델을 만든 뒤 시간이 흘러 끝 시각이 코앞이거나 지났으면 타이머가 0 아래로 세기 때문이다.
 */
export const MIN_COUNTDOWN_MS = 60_000;

/** 타이머가 끝난 뒤 네이티브가 다시 그릴 글자. */
export interface AfterCountdownContent {
	body: string;
	chipText: string;
}

/** Android 진행 중 알림에 그대로 넣는 글자들. 문구는 모두 `LockScreenModel`에서 온다. */
export interface NotificationContent {
	/** 타이머가 끝난 뒤 네이티브가 다시 그릴 본문과 칩. 타이머가 없으면 null. */
	afterCountdown: AfterCountdownContent | null;
	/** 본문: 상세. 타이머가 없을 때만 남은 분("곧")을 그 뒤에 붙인다. */
	body: string;
	/**
	 * 상태바 칩. 7글자 미만이어야 다 보여서 남은 분만, 없으면 노선 이름.
	 * 타이머가 있으면 네이티브가 이 글자 대신 타이머를 칩에 둔다.
	 */
	chipText: string;
	/** 남은 시간을 시스템 타이머(`setWhen` + 거꾸로 세는 chronometer)로 셀 끝 시각(epoch 밀리초). 없으면 null. */
	countdownAtMs: number | null;
	/** 알림 위쪽의 작은 줄(`setSubText`). */
	header: string;
	/** 펼친 본문 아래 줄: 남은 구간 최대 2줄, 제안이 있으면 제안 한 줄. */
	lines: string[];
	/** 작은 아이콘(알림·상태바 칩): bus면 버스, subway면 열차. */
	mode: LockScreenModel["mode"];
	title: string;
}

const SEPARATOR = " · ";
const MS_PER_SECOND = 1000;

function nextLegLines(model: LockScreenModel): string[] {
	const lines = model.nextLegs.map((leg) => `${leg.lineName} ${leg.text}`);
	const last = lines.length - 1;
	if (model.moreLegs !== null && last >= 0) {
		lines[last] = `${lines[last]}${SEPARATOR}${model.moreLegs}`;
	}
	return lines;
}

function withMinutes(detail: string, minutes: string): string {
	return `${detail}${SEPARATOR}${minutes}`;
}

/**
 * `nowMs`는 이 내용을 그리는 시각(epoch 밀리초)이다.
 * `soonText`는 `commute.lock.minutes.soon`("곧")이다. 이 모듈은 `t`를 모르므로 부르는 쪽이 넘긴다.
 */
export function notificationContent(
	model: LockScreenModel,
	nowMs: number,
	soonText: string
): NotificationContent {
	const endAtMs =
		model.countdownEpoch === null ? null : model.countdownEpoch * MS_PER_SECOND;
	const counting = endAtMs !== null && endAtMs - nowMs >= MIN_COUNTDOWN_MS;
	// 끝 시각이 1분 안이면 모델의 "N분"이 이미 낡았다. 남은 분 자리에 "곧"을 둔다.
	const minutes = endAtMs !== null && !counting ? soonText : model.minutes;
	return {
		afterCountdown: counting
			? { body: withMinutes(model.detail, soonText), chipText: soonText }
			: null,
		body:
			minutes === null || counting
				? model.detail
				: withMinutes(model.detail, minutes),
		chipText: minutes ?? model.lineName,
		countdownAtMs: counting ? endAtMs : null,
		header: model.header,
		lines: model.suggestion === null ? nextLegLines(model) : [model.suggestion],
		mode: model.mode,
		title: `${model.lineName}${SEPARATOR}${model.status}`,
	};
}
