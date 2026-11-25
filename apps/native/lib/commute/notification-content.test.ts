import { expect, it } from "bun:test";

import type { LockScreenModel } from "./lock-screen-model";
import { notificationContent } from "./notification-content";

const COUNTDOWN_EPOCH = 1_794_265_380; // 2026-11-10 08:03 KST
/** 모델을 만든 시각. 타이머 끝까지 3분 남았다. */
const NOW_S = COUNTDOWN_EPOCH - 180;
const NOW_MS = NOW_S * 1000;
const SOON = "곧";

function model(overrides: Partial<LockScreenModel> = {}): LockScreenModel {
	return {
		actions: ["end"],
		countdownEpoch: COUNTDOWN_EPOCH,
		detail: "노량진역 · 08:12 도착",
		header: "출근 · 회사까지",
		lineName: "6411",
		minutes: "3분",
		mode: "bus",
		moreLegs: null,
		nextLegs: [],
		status: "2정거장 전",
		suggestion: null,
		tag: "live",
		tagLabel: "실시간",
		...overrides,
	};
}

it("puts the line and status in the title and hands the countdown to the system timer", () => {
	expect(notificationContent(model(), NOW_MS, SOON)).toEqual({
		afterCountdown: { body: "노량진역 · 08:12 도착 · 곧", chipText: "곧" },
		body: "노량진역 · 08:12 도착",
		chipText: "3분",
		countdownAtMs: COUNTDOWN_EPOCH * 1000,
		header: "출근 · 회사까지",
		lines: [],
		mode: "bus",
		title: "6411 · 2정거장 전",
	});
});

it("passes the mode so the small icon shows a train for the subway", () => {
	expect(
		notificationContent(model({ mode: "subway" }), NOW_MS, SOON).mode
	).toBe("subway");
});

it("keeps the soon label after the detail when there is no timer", () => {
	const content = notificationContent(
		model({ countdownEpoch: null, minutes: "곧" }),
		NOW_MS,
		SOON
	);

	expect(content.body).toBe("노량진역 · 08:12 도착 · 곧");
	expect(content.chipText).toBe("곧");
	expect(content.countdownAtMs).toBeNull();
});

it("leaves no dangling separator and shows the line in the chip without minutes", () => {
	const content = notificationContent(
		model({
			countdownEpoch: null,
			detail: "노량진역",
			minutes: null,
			status: "위치 확인 중",
		}),
		NOW_MS,
		SOON
	);

	expect(content.body).toBe("노량진역");
	expect(content.chipText).toBe("6411");
	expect(content.countdownAtMs).toBeNull();
});

it("lists up to two next legs and ends the second with the remaining count", () => {
	const content = notificationContent(
		model({
			moreLegs: "외 1구간",
			nextLegs: [
				{ lineName: "2호선", mode: "subway", text: "신도림역 · 08:31 승차" },
				{ lineName: "150", mode: "bus", text: "서울역 · 약 08:50 승차" },
			],
		}),
		NOW_MS,
		SOON
	);

	expect(content.lines).toEqual([
		"2호선 신도림역 · 08:31 승차",
		"150 서울역 · 약 08:50 승차 · 외 1구간",
	]);
});

it("shows the suggestion in place of the next legs", () => {
	const content = notificationContent(
		model({
			nextLegs: [
				{ lineName: "2호선", mode: "subway", text: "신도림역 · 08:31 승차" },
			],
			suggestion: "150번이 4분 뒤 와요 · 6분 빨리 도착",
		}),
		NOW_MS,
		SOON
	);

	expect(content.lines).toEqual(["150번이 4분 뒤 와요 · 6분 빨리 도착"]);
});

it("남은 시간이 1분보다 짧으면 타이머를 걸지 않는다", () => {
	const content = notificationContent(
		model({ countdownEpoch: NOW_S + 30, minutes: "1분" }),
		NOW_S * 1000,
		"곧"
	);
	expect(content.countdownAtMs).toBeNull();
	expect(content.afterCountdown).toBeNull();
	expect(content.chipText).toBe("곧");
	expect(content.body).toBe("노량진역 · 08:12 도착 · 곧");
});

it("타이머를 걸면 끝난 뒤의 칩은 '곧'이다", () => {
	const content = notificationContent(
		model({ countdownEpoch: NOW_S + 300 }),
		NOW_S * 1000,
		"곧"
	);
	expect(content.countdownAtMs).toBe((NOW_S + 300) * 1000);
	expect(content.afterCountdown?.chipText).toBe("곧");
	expect(content.afterCountdown?.body).toBe("노량진역 · 08:12 도착 · 곧");
});

it("타이머 끝이 이미 지났으면 타이머 없이 '곧'을 보인다", () => {
	const content = notificationContent(
		model({ countdownEpoch: NOW_S - 5, minutes: "1분" }),
		NOW_MS,
		SOON
	);
	expect(content.countdownAtMs).toBeNull();
	expect(content.afterCountdown).toBeNull();
	expect(content.chipText).toBe("곧");
});

it("타이머가 없으면 끝난 뒤의 내용도 없다", () => {
	expect(
		notificationContent(model({ countdownEpoch: null }), NOW_MS, SOON)
			.afterCountdown
	).toBeNull();
});
