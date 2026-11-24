import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import {
	commutePlan,
	commuteSession,
	install,
	pushToken,
} from "@Betro/db/schema/commute";
import { createTestDb } from "@Betro/db/test-db";
import { beforeEach, describe, expect, it } from "bun:test";
import {
	ACTIVITY_TOKEN_KEEP_MS,
	IDLE_TOKEN_KEEP_MS,
	prunePushTokens,
	shouldPrune,
} from "./push-token-prune";

const NOW = Date.UTC(2026, 10, 24, 19, 2, 0);
const DAY_MS = 86_400_000;

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeEach(async () => {
	db = await createTestDb();
});

async function addInstall(id: string, lastSeenAt: number): Promise<void> {
	await db.insert(install).values({
		createdAt: lastSeenAt,
		id,
		lastSeenAt,
		platform: "ios",
		secretHash: "hash",
	});
}

async function addToken(values: {
	activityId?: string;
	installId: string;
	kind: "apns-start" | "apns-activity" | "fcm";
	sessionId?: string;
	updatedAt: number;
}): Promise<void> {
	await db.insert(pushToken).values({
		activityId: values.activityId ?? "",
		env: "production",
		installId: values.installId,
		kind: values.kind,
		sessionId: values.sessionId ?? "",
		token: `token-${values.kind}-${values.sessionId ?? ""}`,
		updatedAt: values.updatedAt,
	});
}

async function addSession(
	id: string,
	installId: string,
	status: "active" | "ended",
	endedAt: number | null
): Promise<void> {
	await db.insert(commuteSession).values({
		endedAt,
		id,
		installId,
		planId: `plan-${id}`,
		serviceDate: "2026-11-24",
		startedAt: NOW - 2 * DAY_MS,
		status,
	});
}

async function addPlan(id: string, installId: string, enabled: number) {
	await db.insert(commutePlan).values({
		enabled,
		id,
		installId,
		planJson: {} as never,
		startMinute: 480,
		timezone: DEFAULT_TIMEZONE,
		updatedAt: NOW,
	});
}

const remainingSessions = async (): Promise<string[]> =>
	(await db.select().from(pushToken))
		.map((row) => row.sessionId || row.kind)
		.sort();

describe("prunePushTokens", () => {
	it("끝난 세션의 Live Activity 토큰은 하루 뒤 지우고 진행 중 세션 토큰은 남긴다", async () => {
		await addInstall("i1", NOW);
		await addSession("done", "i1", "ended", NOW - ACTIVITY_TOKEN_KEEP_MS - 1);
		await addSession("recent", "i1", "ended", NOW - ACTIVITY_TOKEN_KEEP_MS + 1);
		await addSession("live", "i1", "active", null);
		await Promise.all(
			["done", "recent", "live"].map((sessionId, i) =>
				addToken({
					activityId: `a${i}`,
					installId: "i1",
					kind: "apns-activity",
					sessionId,
					updatedAt: NOW - 30 * DAY_MS,
				})
			)
		);
		// 진행 중 세션은 updatedAt이 오래돼도 지우지 않는다
		expect(await prunePushTokens(db, NOW)).toBe(1);
		expect(await remainingSessions()).toEqual(["live", "recent"]);
	});

	it("세션 행이 없는 Live Activity 토큰(sample-1)은 하루 뒤 지운다", async () => {
		await addInstall("i1", NOW);
		await addToken({
			activityId: "a1",
			installId: "i1",
			kind: "apns-activity",
			sessionId: "sample-1",
			updatedAt: NOW - ACTIVITY_TOKEN_KEEP_MS - 1,
		});
		await addToken({
			activityId: "a2",
			installId: "i1",
			kind: "apns-activity",
			sessionId: "sample-2",
			updatedAt: NOW - 1000,
		});
		expect(await prunePushTokens(db, NOW)).toBe(1);
		expect(await remainingSessions()).toEqual(["sample-2"]);
	});

	it("켜진 계획이 없고 60일 넘게 접속하지 않은 설치의 토큰은 지운다", async () => {
		await addInstall("idle", NOW - IDLE_TOKEN_KEEP_MS - 1);
		await addInstall("active", NOW - 1000);
		await addToken({
			installId: "idle",
			kind: "apns-start",
			updatedAt: NOW,
		});
		await addToken({
			activityId: "x",
			installId: "idle",
			kind: "fcm",
			updatedAt: NOW,
		});
		await addToken({
			installId: "active",
			kind: "apns-start",
			updatedAt: NOW,
		});
		await addPlan("p-off", "idle", 0);
		expect(await prunePushTokens(db, NOW)).toBe(2);
		const rows = await db.select().from(pushToken);
		expect(rows.map((row) => row.installId)).toEqual(["active"]);
	});

	it("켜진 계획이 있으면 updatedAt이 오래돼도 시작 토큰을 남긴다", async () => {
		await addInstall("i1", NOW - IDLE_TOKEN_KEEP_MS - 1);
		await addPlan("p1", "i1", 1);
		await addToken({
			installId: "i1",
			kind: "apns-start",
			updatedAt: NOW - 200 * DAY_MS,
		});
		expect(await prunePushTokens(db, NOW)).toBe(0);
		expect(await remainingSessions()).toEqual(["apns-start"]);
	});
});

describe("shouldPrune", () => {
	it("하루에 한 cron 칸에서만 true다", () => {
		const day = Date.UTC(2026, 10, 23, 19, 0, 0); // 현지 11-24 04:00
		const ticks: number[] = [];
		for (let t = day - DAY_MS; t < day + DAY_MS; t += 5 * 60_000) {
			if (shouldPrune(t, DEFAULT_TIMEZONE)) {
				ticks.push(t);
			}
		}
		expect(ticks).toHaveLength(2);
		expect(shouldPrune(day, DEFAULT_TIMEZONE)).toBe(true);
		expect(shouldPrune(day + 4 * 60_000, DEFAULT_TIMEZONE)).toBe(true);
		expect(shouldPrune(day + 5 * 60_000, DEFAULT_TIMEZONE)).toBe(false);
		expect(shouldPrune(day - 60_000, DEFAULT_TIMEZONE)).toBe(false);
	});
});
