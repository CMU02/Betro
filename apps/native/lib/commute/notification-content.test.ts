import { expect, it } from "bun:test";

import type { LockScreenModel } from "./lock-screen-model";
import { notificationContent } from "./notification-content";

const COUNTDOWN_EPOCH = 1_794_265_380; // 2026-11-10 08:03 KST

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
	expect(notificationContent(model())).toEqual({
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
	expect(notificationContent(model({ mode: "subway" })).mode).toBe("subway");
});

it("keeps the soon label after the detail when there is no timer", () => {
	const content = notificationContent(
		model({ countdownEpoch: null, minutes: "곧" })
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
		})
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
		})
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
		})
	);

	expect(content.lines).toEqual(["150번이 4분 뒤 와요 · 6분 빨리 도착"]);
});
