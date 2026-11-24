import { expect, it } from "bun:test";
import { arrivalStatus, ESTIMATED_METHODS, headwayStatus } from "./eta-status";

const NOW = 1_000_000;

it("method가 headway면 live 상태여도 시간표 추정이다", () => {
	expect(
		arrivalStatus({
			etaAt: NOW + 300_000,
			etaState: "live",
			method: "headway",
			now: NOW,
		})
	).toEqual({ kind: "estimated", text: "약 5분" });
});

it("etaState가 estimated면 method와 상관없이 시간표 추정이다", () => {
	expect(
		arrivalStatus({
			etaAt: NOW + 120_000,
			etaState: "estimated",
			method: null,
			now: NOW,
		})
	).toEqual({ kind: "estimated", text: "약 2분" });
});

it("공식 예측이면 N분이고 1분 미만이면 곧 도착이다", () => {
	expect(
		arrivalStatus({
			etaAt: NOW + 180_000,
			etaState: "live",
			method: "official",
			now: NOW,
		})
	).toEqual({ kind: "live", text: "3분" });
	expect(
		arrivalStatus({
			etaAt: NOW + 30_000,
			etaState: "live",
			method: "official",
			now: NOW,
		})
	).toEqual({ kind: "live", text: "곧 도착" });
	expect(
		arrivalStatus({
			etaAt: NOW - 5000,
			etaState: "live",
			method: null,
			now: NOW,
		})
	).toEqual({ kind: "live", text: "곧 도착" });
});

it("도착 시각이 없으면 빈 글자의 추정이다", () => {
	expect(
		arrivalStatus({ etaAt: null, etaState: "live", method: null, now: NOW })
	).toEqual({ kind: "estimated", text: "" });
});

it("배차간격이 없으면 운행 종료다", () => {
	expect(headwayStatus(null)).toEqual({ kind: "ended", text: "운행 종료" });
	expect(headwayStatus(7.6 * 60_000)).toEqual({
		kind: "estimated",
		text: "배차 약 8분",
	});
	expect(headwayStatus(10_000)).toEqual({
		kind: "estimated",
		text: "배차 약 1분",
	});
});

it("추정 method 목록은 지도 시트와 같다", () => {
	expect(ESTIMATED_METHODS).toEqual(["timetable", "headway", "extrapolated"]);
});
