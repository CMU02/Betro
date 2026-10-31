import { describe, expect, it } from "bun:test";
import { isPushAuthorized, toPushMessage } from "./push-message";

describe("isPushAuthorized", () => {
	it("treats AUTHORIZED, PROVISIONAL and EPHEMERAL as granted", () => {
		expect(isPushAuthorized(1)).toBe(true);
		expect(isPushAuthorized(2)).toBe(true);
		expect(isPushAuthorized(3)).toBe(true);
	});

	it("treats DENIED and NOT_DETERMINED as not granted", () => {
		expect(isPushAuthorized(0)).toBe(false);
		expect(isPushAuthorized(-1)).toBe(false);
	});
});

describe("toPushMessage", () => {
	it("copies id, title, body, sentAt and string data", () => {
		const message = toPushMessage({
			data: { lineKey: "line2", stationCd: "0222" },
			messageId: "m-1",
			notification: { body: "강남역 방면 5분 지연", title: "2호선 지연" },
			sentTime: 1_700_000_000_000,
		});
		expect(message).toEqual({
			body: "강남역 방면 5분 지연",
			data: { lineKey: "line2", stationCd: "0222" },
			id: "m-1",
			sentAt: 1_700_000_000_000,
			title: "2호선 지연",
		});
	});

	it("serialises object data values and defaults missing fields to null", () => {
		const message = toPushMessage({
			data: { count: "3", payload: { trainNo: "2345" } },
		});
		expect(message.id).toBeNull();
		expect(message.title).toBeNull();
		expect(message.body).toBeNull();
		expect(message.sentAt).toBeNull();
		expect(message.data).toEqual({
			count: "3",
			payload: '{"trainNo":"2345"}',
		});
	});

	it("returns an empty data object when the message has no data", () => {
		expect(toPushMessage({}).data).toEqual({});
	});
});
