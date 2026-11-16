import type { LockScreenModel } from "./lock-screen-model";

/** Android 진행 중 알림에 그대로 넣는 글자들. 문구는 모두 `LockScreenModel`에서 온다. */
export interface NotificationContent {
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

export function notificationContent(
	model: LockScreenModel
): NotificationContent {
	const { countdownEpoch } = model;
	const counting = countdownEpoch !== null;
	return {
		body:
			model.minutes === null || counting
				? model.detail
				: `${model.detail}${SEPARATOR}${model.minutes}`,
		chipText: model.minutes ?? model.lineName,
		countdownAtMs: counting ? countdownEpoch * MS_PER_SECOND : null,
		header: model.header,
		lines: model.suggestion === null ? nextLegLines(model) : [model.suggestion],
		title: `${model.lineName}${SEPARATOR}${model.status}`,
	};
}
