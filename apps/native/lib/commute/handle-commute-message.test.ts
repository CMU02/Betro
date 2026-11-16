import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import type { HttpMethod, ServerClient } from "../server/api-client";
import type { ContentState } from "./content-state";
import {
	type CommuteMessageDeps,
	handleCommuteMessage,
	type ShowRequest,
} from "./handle-commute-message";

const NOW_MS = 1_794_265_200_000;
const NOW = NOW_MS / 1000;

function state(overrides: Partial<ContentState> = {}): ContentState {
	return {
		delayMinutes: 0,
		destinationEtaEpoch: NOW + 1800,
		etaEpoch: NOW + 180,
		etaState: "live",
		leaveEpoch: null,
		legCount: 1,
		legIndex: 0,
		lineName: "6411",
		mode: "bus",
		nextLegs: [],
		passed: null,
		positionState: "live",
		sentAt: NOW,
		seq: 3,
		stage: "wait",
		stopName: "노량진역",
		stopsAway: 2,
		suggestion: null,
		v: 1,
		...overrides,
	};
}

function data(
	event: string,
	value: Partial<ContentState> = {},
	extra: Record<string, string> = {}
): Record<string, string> {
	return {
		event,
		planId: "plan-1",
		sessionId: "session-1",
		state: JSON.stringify(state(value)),
		type: "commute",
		...extra,
	};
}

interface Call {
	body: unknown;
	method: HttpMethod;
	path: string;
}

function setup(options: { ackStatus?: number; shows?: boolean } = {}) {
	const calls: Call[] = [];
	const shown: ShowRequest[] = [];
	const ended: string[] = [];
	const client: ServerClient = {
		request: (method, path, body) => {
			calls.push({ body, method, path });
			return Promise.resolve({ json: null, status: options.ackStatus ?? 204 });
		},
	};
	const deps: CommuteMessageDeps = {
		client,
		header: (planId) =>
			Promise.resolve(planId === "plan-1" ? "출근 · 회사까지" : null),
		notifier: {
			end: (sessionId) => {
				ended.push(sessionId);
			},
			show: (input) => {
				shown.push(input);
				return options.shows ?? true;
			},
		},
		now: () => NOW_MS,
		t,
		timezone: "Asia/Seoul",
	};
	return { calls, deps, ended, shown };
}

it("shows a start message and acknowledges it once with a ms timestamp", async () => {
	const { calls, deps, shown } = setup();

	expect(await handleCommuteMessage(data("start"), deps)).toBe("shown");
	expect(shown).toHaveLength(1);
	expect(shown[0]?.sessionId).toBe("session-1");
	expect(shown[0]?.seq).toBe(3);
	expect(shown[0]?.content.title).toBe("6411 · 2정거장 전");
	expect(shown[0]?.content.header).toBe("출근 · 회사까지");
	expect(shown[0]?.endLabel).toBe("종료");
	expect(shown[0]?.planId).toBe("plan-1");
	expect(calls).toEqual([
		{
			body: { shownAt: NOW_MS },
			method: "POST",
			path: "/v1/commute/sessions/session-1/ack",
		},
	]);
});

it("shows an update without acknowledging it", async () => {
	const { calls, deps } = setup();

	expect(await handleCommuteMessage(data("update"), deps)).toBe("shown");
	expect(calls).toEqual([]);
});

it("falls back to the default header for a plan the device does not know", async () => {
	const { deps, shown } = setup();

	await handleCommuteMessage(data("update", {}, { planId: "other" }), deps);

	expect(shown[0]?.content.header).toBe("출퇴근");
});

it("ends the notification on an end event or an ended stage", async () => {
	const first = setup();
	expect(await handleCommuteMessage(data("end"), first.deps)).toBe("ended");
	expect(first.ended).toEqual(["session-1"]);

	const second = setup();
	expect(
		await handleCommuteMessage(data("update", { stage: "ended" }), second.deps)
	).toBe("ended");
	expect(second.shown).toEqual([]);
});

it("ends the notification on an end event even when the state cannot be read", async () => {
	const { deps, ended, shown } = setup();

	const results = await Promise.all(
		["not json", JSON.stringify({ v: 2 }), ""].map((broken) =>
			handleCommuteMessage({ ...data("end"), state: broken }, deps)
		)
	);
	expect(results).toEqual(["ended", "ended", "ended"]);
	expect(ended).toEqual(["session-1", "session-1", "session-1"]);
	expect(shown).toEqual([]);
});

it("reports stale when the notifier refuses an older seq or an ended session", async () => {
	const { calls, deps } = setup({ shows: false });

	expect(await handleCommuteMessage(data("start"), deps)).toBe("stale");
	expect(calls).toEqual([]);
});

it("does not draw a message sent more than ten minutes ago", async () => {
	const { deps, shown } = setup();

	expect(
		await handleCommuteMessage(data("update", { sentAt: NOW - 11 * 60 }), deps)
	).toBe("stale");
	expect(shown).toEqual([]);
});

it("ignores other message types and broken state without touching the notifier", async () => {
	const { deps, ended, shown } = setup();

	expect(
		await handleCommuteMessage({ ...data("update"), type: "other" }, deps)
	).toBe("ignored");
	expect(
		await handleCommuteMessage({ ...data("update"), state: "{" }, deps)
	).toBe("ignored");
	expect(
		await handleCommuteMessage(
			{ ...data("update"), state: JSON.stringify({ v: 2 }) },
			deps
		)
	).toBe("ignored");
	expect(shown).toEqual([]);
	expect(ended).toEqual([]);
});

it("still reports shown when the acknowledgement fails", async () => {
	const { deps } = setup({ ackStatus: 0 });

	expect(await handleCommuteMessage(data("start"), deps)).toBe("shown");
});
