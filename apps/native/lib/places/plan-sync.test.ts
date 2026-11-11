import type { CommutePlan } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import type {
	HttpMethod,
	ServerClient,
	ServerResponse,
} from "../server/api-client";
import type { Place, PlacesState } from "./places";
import { createPlacesStore } from "./places-store";
import { deletePlace, reconcile, type SyncDeps, savePlace } from "./plan-sync";

const NOW = 5000;
const WORK_PLAN = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";
const HOME_PLAN = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const GYM_PLAN = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const SERVER_PLAN = "9e8d7c6b-5a49-4382-b716-05f4e3d2c1b0";
const PLAN_PATH = /^\/v1\/commute\/plans\/(.+)$/;

function planOf(planId: string): CommutePlan {
	return {
		enabled: true,
		planId,
		routes: [
			{
				legs: [
					{
						alight: { name: "강남", stop: "seoul-subway:0222" },
						board: { name: "잠실", stop: "seoul-subway:0216" },
						direction: "down",
						line: "seoul-subway:1002",
						lineName: "2호선",
						mode: "subway",
					},
				],
				rank: 0,
				walkMinutes: [5, 5],
			},
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 485,
			timezone: "Asia/Seoul",
		},
	};
}

function place(id: string, planId: string, overrides: Partial<Place> = {}) {
	const base: Place = {
		busMeta: {},
		id,
		kind: "work",
		name: "",
		plan: planOf(planId),
		sync: "synced",
		updatedAt: 1000,
	};
	return { ...base, ...overrides };
}

interface Call {
	body: unknown;
	method: HttpMethod;
	path: string;
}

/** 설치 하나의 예약을 메모리에 두는 가짜 서버. `override`가 응답을 주면 그 응답을 돌려준다. */
function fakeServer(initial: CommutePlan[] = []) {
	const plans = new Map(initial.map((plan) => [plan.planId, plan]));
	const calls: Call[] = [];
	let override: (call: Call) => ServerResponse | undefined = () => undefined;

	function handle(call: Call): ServerResponse {
		if (call.method === "GET" && call.path === "/v1/commute/plans") {
			return { json: { plans: [...plans.values()] }, status: 200 };
		}
		const planId = PLAN_PATH.exec(call.path)?.[1];
		if (planId !== undefined && call.method === "PUT") {
			plans.set(planId, call.body as CommutePlan);
			return { json: null, status: 204 };
		}
		if (planId !== undefined && call.method === "DELETE") {
			plans.delete(planId);
			return { json: null, status: 204 };
		}
		return { json: { error: "not found" }, status: 404 };
	}

	const client: ServerClient = {
		request: (method, path, body) => {
			const call = { body, method, path };
			calls.push(call);
			return Promise.resolve(override(call) ?? handle(call));
		},
	};

	return {
		calls,
		client,
		plans,
		requests: () => calls.map((call) => `${call.method} ${call.path}`),
		setOverride: (fn: (call: Call) => ServerResponse | undefined) => {
			override = fn;
		},
	};
}

function memoryKv() {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
	};
}

function setup(
	state: Partial<PlacesState> = {},
	server = fakeServer()
): {
	deps: SyncDeps;
	headers: Record<string, string>[];
	server: ReturnType<typeof fakeServer>;
	store: ReturnType<typeof createPlacesStore>;
} {
	const store = createPlacesStore(memoryKv());
	store.replace({
		pendingDeletes: state.pendingDeletes ?? [],
		places: state.places ?? [],
	});
	const headers: Record<string, string>[] = [];
	const deps: SyncDeps = {
		client: server.client,
		now: () => NOW,
		setHeaders: (next) => {
			headers.push(next);
			return Promise.resolve();
		},
		store,
		t,
	};
	return { deps, headers, server, store };
}

const offline: ServerResponse = { json: null, status: 0 };

// savePlace

it("saves a place on the device, uploads its plan and marks it synced", async () => {
	const { deps, headers, server, store } = setup();
	const work = place("work", WORK_PLAN, { sync: "pending" });

	expect(await savePlace(deps, work)).toBe("saved");
	expect(server.calls).toEqual([
		{ body: work.plan, method: "PUT", path: `/v1/commute/plans/${WORK_PLAN}` },
	]);
	expect(store.get().places).toEqual([
		{ ...work, sync: "synced", updatedAt: NOW },
	]);
	expect(headers).toEqual([{ [WORK_PLAN]: "출근 · 회사까지" }]);
});

it("returns the server's issues on 400 and keeps the place pending", async () => {
	const issues = ["routes.0.legs: too many legs", "schedule.days: empty"];
	const { deps, headers, server, store } = setup();
	server.setOverride(() => ({
		json: { error: "invalid", issues },
		status: 400,
	}));

	expect(await savePlace(deps, place("work", WORK_PLAN))).toEqual({
		rejected: issues,
	});
	expect(store.get().places.map((p) => p.sync)).toEqual(["pending"]);
	expect(headers).toHaveLength(1);
});

it("drops a new place from the device when the server is at its limit (409)", async () => {
	const { deps, headers, server, store } = setup({
		places: [place("home", HOME_PLAN, { kind: "home" })],
	});
	server.setOverride(() => ({
		json: { error: "too many plans" },
		status: 409,
	}));

	expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("limit");
	expect(store.get()).toEqual({
		pendingDeletes: [],
		places: [place("home", HOME_PLAN, { kind: "home" })],
	});
	expect(headers).toEqual([{ [HOME_PLAN]: "퇴근 · 집까지" }]);
});

const LIMIT: ServerResponse = {
	json: { error: "too many plans" },
	status: 409,
};

it("keeps an already stored pending place with its edit when the server is at its limit (409)", async () => {
	const { deps, server, store } = setup({
		places: [place("gym", GYM_PLAN, { kind: "other", sync: "pending" })],
	});
	server.setOverride(() => LIMIT);
	const edited = place("gym", GYM_PLAN, {
		kind: "other",
		name: "수영장",
		sync: "pending",
	});

	expect(await savePlace(deps, edited)).toBe("limit");
	expect(store.get()).toEqual({
		pendingDeletes: [],
		places: [{ ...edited, sync: "pending", updatedAt: NOW }],
	});
});

it("sends the waiting deletes and saves a new place again when they free the limit (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	server.setOverride((call) =>
		call.method === "PUT" && server.plans.has(GYM_PLAN) ? LIMIT : undefined
	);
	const work = place("work", WORK_PLAN);

	expect(await savePlace(deps, work)).toBe("saved");
	expect(server.requests()).toEqual([
		`PUT /v1/commute/plans/${WORK_PLAN}`,
		`DELETE /v1/commute/plans/${GYM_PLAN}`,
		`PUT /v1/commute/plans/${WORK_PLAN}`,
	]);
	expect(store.get()).toEqual({
		pendingDeletes: [],
		places: [{ ...work, sync: "synced", updatedAt: NOW }],
	});
});

it("drops a new place at the limit when the waiting delete keeps failing on the server (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	server.setOverride((call) =>
		call.method === "PUT" ? LIMIT : { json: null, status: 500 }
	);

	expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("limit");
	expect(server.requests()).toEqual([
		`PUT /v1/commute/plans/${WORK_PLAN}`,
		`DELETE /v1/commute/plans/${GYM_PLAN}`,
		`PUT /v1/commute/plans/${WORK_PLAN}`,
	]);
	expect(store.get()).toEqual({ pendingDeletes: [GYM_PLAN], places: [] });
});

it("keeps an edited place pending at the limit when the waiting delete keeps failing on the server (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN), planOf(HOME_PLAN)]);
	const { deps, store } = setup(
		{
			pendingDeletes: [GYM_PLAN],
			places: [place("home", HOME_PLAN, { kind: "home" })],
		},
		server
	);
	server.setOverride((call) =>
		call.method === "PUT" ? LIMIT : { json: null, status: 500 }
	);
	const edited = place("home", HOME_PLAN, { kind: "home", name: "본가" });

	expect(await savePlace(deps, edited)).toBe("limit");
	expect(store.get()).toEqual({
		pendingDeletes: [GYM_PLAN],
		places: [{ ...edited, sync: "pending", updatedAt: NOW }],
	});
});

it("keeps a new place pending when the waiting delete cannot reach the server (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	server.setOverride((call) => (call.method === "PUT" ? LIMIT : offline));
	const work = place("work", WORK_PLAN);

	expect(await savePlace(deps, work)).toBe("pending");
	expect(server.requests()).toEqual([
		`PUT /v1/commute/plans/${WORK_PLAN}`,
		`DELETE /v1/commute/plans/${GYM_PLAN}`,
	]);
	expect(store.get()).toEqual({
		pendingDeletes: [GYM_PLAN],
		places: [{ ...work, sync: "pending", updatedAt: NOW }],
	});
});

it("drops a new place when the server is still at its limit after the waiting deletes (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	server.setOverride((call) => (call.method === "PUT" ? LIMIT : undefined));

	expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("limit");
	expect(server.requests()).toEqual([
		`PUT /v1/commute/plans/${WORK_PLAN}`,
		`DELETE /v1/commute/plans/${GYM_PLAN}`,
		`PUT /v1/commute/plans/${WORK_PLAN}`,
	]);
	expect(store.get()).toEqual({ pendingDeletes: [], places: [] });
});

it("reports saved when reconcile stores the same save while the waiting deletes go out (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	server.setOverride((call) => {
		if (call.method === "DELETE") {
			// 그사이 맞추기가 같은 장소를 비어 있던 자리에 올리고 synced로 바꾼다.
			server.plans.set(WORK_PLAN, planOf(WORK_PLAN));
			store.markSynced("work", NOW);
			return;
		}
		return call.method === "PUT" && !server.plans.has(WORK_PLAN)
			? LIMIT
			: undefined;
	});
	const work = place("work", WORK_PLAN);

	expect(await savePlace(deps, work)).toBe("saved");
	expect(store.get()).toEqual({
		pendingDeletes: [],
		places: [{ ...work, sync: "synced", updatedAt: NOW }],
	});
	expect(server.plans.has(WORK_PLAN)).toBe(true);
});

it("does not drop a new place that a newer save replaced while the waiting deletes go out (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	const newer = place("work", WORK_PLAN, { name: "본사", updatedAt: NOW + 1 });
	server.setOverride((call) => {
		if (call.method === "DELETE") {
			server.plans.set(WORK_PLAN, newer.plan);
			store.upsert(newer);
			return;
		}
		return call.method === "PUT" && !server.plans.has(WORK_PLAN)
			? LIMIT
			: undefined;
	});

	await savePlace(deps, place("work", WORK_PLAN));
	expect(store.get()).toEqual({ pendingDeletes: [], places: [newer] });
});

it("does not upload the older plan again when a newer pending save replaced it during the deletes (409)", async () => {
	const server = fakeServer([planOf(GYM_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [GYM_PLAN] }, server);
	const newer = place("work", WORK_PLAN, {
		name: "본사",
		sync: "pending",
		updatedAt: NOW + 1,
	});
	server.setOverride((call) => {
		if (call.method === "DELETE") {
			store.upsert(newer);
			return;
		}
		return call.method === "PUT" && server.plans.size > 0 ? LIMIT : undefined;
	});

	await savePlace(deps, place("work", WORK_PLAN));
	expect(server.requests()).toEqual([
		`PUT /v1/commute/plans/${WORK_PLAN}`,
		`DELETE /v1/commute/plans/${GYM_PLAN}`,
	]);
	expect(store.get().places).toEqual([newer]);
});

for (const status of [0, 401, 500, 503]) {
	it(`keeps the place pending on the device when the upload gets ${status}`, async () => {
		const { deps, headers, server, store } = setup();
		server.setOverride(() => ({ json: null, status }));

		expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("pending");
		expect(store.get().places).toEqual([
			place("work", WORK_PLAN, { sync: "pending", updatedAt: NOW }),
		]);
		expect(headers).toEqual([{ [WORK_PLAN]: "출근 · 회사까지" }]);
	});
}

it("keeps an edit made during the upload pending", async () => {
	const { deps, server, store } = setup();
	let time = NOW;
	deps.now = () => time;
	server.setOverride((call) => {
		if (call.method === "PUT" && time === NOW) {
			time = NOW + 1;
			store.upsert(
				place("work", WORK_PLAN, {
					name: "본사",
					sync: "pending",
					updatedAt: time,
				})
			);
		}
	});

	expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("saved");
	expect(store.get().places.map((p) => p.sync)).toEqual(["pending"]);
});

// deletePlace

for (const status of [204, 404]) {
	it(`deletes a place and forgets the pending delete on ${status}`, async () => {
		const { deps, headers, server, store } = setup({
			places: [
				place("work", WORK_PLAN),
				place("home", HOME_PLAN, { kind: "home" }),
			],
		});
		server.setOverride(() => ({ json: null, status }));

		expect(await deletePlace(deps, "work")).toBe("deleted");
		expect(server.requests()).toEqual([
			`DELETE /v1/commute/plans/${WORK_PLAN}`,
		]);
		expect(store.get().pendingDeletes).toEqual([]);
		expect(store.get().places.map((p) => p.id)).toEqual(["home"]);
		expect(headers).toEqual([{ [HOME_PLAN]: "퇴근 · 집까지" }]);
	});
}

it("keeps the plan in pendingDeletes when the delete cannot reach the server", async () => {
	const { deps, headers, server, store } = setup({
		places: [place("work", WORK_PLAN)],
	});
	server.setOverride(() => offline);

	expect(await deletePlace(deps, "work")).toBe("pending");
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
	expect(headers).toEqual([{}]);
});

// reconcile

it("sends pending deletes and pending saves before reading the server list", async () => {
	const server = fakeServer([planOf(WORK_PLAN)]);
	const { deps, store } = setup(
		{
			pendingDeletes: [WORK_PLAN],
			places: [place("home", HOME_PLAN, { kind: "home", sync: "pending" })],
		},
		server
	);

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 1, removed: 1 });
	expect(server.requests()).toEqual([
		`DELETE /v1/commute/plans/${WORK_PLAN}`,
		`PUT /v1/commute/plans/${HOME_PLAN}`,
		"GET /v1/commute/plans",
	]);
	expect(store.get()).toEqual({
		pendingDeletes: [],
		places: [place("home", HOME_PLAN, { kind: "home" })],
	});
	expect([...server.plans.keys()]).toEqual([HOME_PLAN]);
});

it("imports a plan that only the server has as an unnamed other place", async () => {
	const server = fakeServer([planOf(SERVER_PLAN)]);
	const { deps, headers, store } = setup({}, server);

	expect(await reconcile(deps)).toEqual({ imported: 1, pushed: 0, removed: 0 });
	expect(store.get().places).toEqual([
		{
			busMeta: {},
			id: expect.any(String),
			kind: "other",
			name: "",
			plan: planOf(SERVER_PLAN),
			sync: "synced",
			updatedAt: NOW,
		},
	]);
	expect(headers).toEqual([{ [SERVER_PLAN]: "가져온 경로까지" }]);
});

it("does not import a plan that is waiting to be deleted", async () => {
	const server = fakeServer([planOf(WORK_PLAN)]);
	const { deps, store } = setup({ pendingDeletes: [WORK_PLAN] }, server);
	server.setOverride((call) =>
		call.method === "DELETE" ? { json: null, status: 500 } : undefined
	);

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 0 });
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
});

it("uploads a synced place again when the server no longer has it", async () => {
	const server = fakeServer();
	const { deps, store } = setup({ places: [place("work", WORK_PLAN)] }, server);

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 1, removed: 0 });
	expect(server.requests()).toEqual([
		"GET /v1/commute/plans",
		`PUT /v1/commute/plans/${WORK_PLAN}`,
	]);
	expect(server.plans.get(WORK_PLAN)).toEqual(planOf(WORK_PLAN));
	expect(store.get().places).toEqual([place("work", WORK_PLAN)]);
});

it("leaves a re-uploaded place pending when the upload fails", async () => {
	const server = fakeServer();
	const { deps, store } = setup({ places: [place("work", WORK_PLAN)] }, server);
	server.setOverride((call) =>
		call.method === "PUT" ? { json: null, status: 503 } : undefined
	);

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 0 });
	expect(store.get().places.map((p) => p.sync)).toEqual(["pending"]);
});

it("keeps a place pending when the server rejects it during reconcile", async () => {
	const server = fakeServer();
	const { deps, store } = setup(
		{ places: [place("work", WORK_PLAN, { sync: "pending" })] },
		server
	);
	server.setOverride((call) =>
		call.method === "PUT"
			? { json: { error: "too many plans" }, status: 409 }
			: undefined
	);

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 0 });
	expect(store.get().places).toEqual([
		place("work", WORK_PLAN, { sync: "pending" }),
	]);
});

it("keeps the same places when it runs twice in a row", async () => {
	const server = fakeServer([planOf(SERVER_PLAN), planOf(HOME_PLAN)]);
	const { deps, store } = setup(
		{
			pendingDeletes: [GYM_PLAN],
			places: [
				place("work", WORK_PLAN),
				place("home", HOME_PLAN, { kind: "home", sync: "pending" }),
			],
		},
		server
	);

	await reconcile(deps);
	const first = store.get();
	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 0 });
	expect(store.get()).toEqual(first);
	expect(first.places).toHaveLength(3);
	expect(new Set(first.places.map((p) => p.plan.planId)).size).toBe(3);
	expect(server.plans.size).toBe(3);
});

it("imports a plan listed twice by the server only once", async () => {
	const server = fakeServer();
	const { deps, store } = setup({}, server);
	server.setOverride((call) =>
		call.method === "GET"
			? {
					json: { plans: [planOf(SERVER_PLAN), planOf(SERVER_PLAN)] },
					status: 200,
				}
			: undefined
	);

	expect(await reconcile(deps)).toEqual({ imported: 1, pushed: 0, removed: 0 });
	expect(store.get().places).toHaveLength(1);
});

it("does not import a plan the device still holds as pending", async () => {
	const server = fakeServer([planOf(WORK_PLAN)]);
	const { deps, store } = setup(
		{ places: [place("work", WORK_PLAN, { sync: "pending" })] },
		server
	);
	server.setOverride((call) =>
		call.method === "PUT" ? { json: null, status: 500 } : undefined
	);

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 0 });
	expect(store.get().places.map((p) => p.id)).toEqual(["work"]);
});

it("skips plans in the server list that do not parse", async () => {
	const server = fakeServer();
	const { deps, store } = setup({}, server);
	server.setOverride((call) =>
		call.method === "GET"
			? {
					json: { plans: [{ planId: GYM_PLAN }, planOf(SERVER_PLAN)] },
					status: 200,
				}
			: undefined
	);

	expect(await reconcile(deps)).toEqual({ imported: 1, pushed: 0, removed: 0 });
	expect(store.get().places.map((p) => p.plan.planId)).toEqual([SERVER_PLAN]);
});

it("returns offline and leaves the device as it was when the list cannot be read", async () => {
	const server = fakeServer([planOf(SERVER_PLAN)]);
	const { deps, store } = setup({ places: [place("work", WORK_PLAN)] }, server);
	const before = store.get();
	server.setOverride((call) => (call.method === "GET" ? offline : undefined));

	expect(await reconcile(deps)).toBe("offline");
	expect(server.requests()).toEqual(["GET /v1/commute/plans"]);
	expect(store.get()).toEqual(before);
});

it("returns offline when the list response is not a plan list", async () => {
	const server = fakeServer();
	const { deps, store } = setup({ places: [place("work", WORK_PLAN)] }, server);
	const before = store.get();
	server.setOverride((call) =>
		call.method === "GET" ? { json: { error: "boom" }, status: 500 } : undefined
	);

	expect(await reconcile(deps)).toBe("offline");
	expect(store.get()).toEqual(before);
});

it("stops at the first request that cannot reach the server", async () => {
	const server = fakeServer();
	const { deps, store } = setup(
		{
			pendingDeletes: [GYM_PLAN],
			places: [place("work", WORK_PLAN, { sync: "pending" })],
		},
		server
	);
	const before = store.get();
	server.setOverride(() => offline);

	expect(await reconcile(deps)).toBe("offline");
	expect(server.requests()).toEqual([`DELETE /v1/commute/plans/${GYM_PLAN}`]);
	expect(store.get()).toEqual(before);
});

it("does not bring back a plan deleted while the server list is on its way", async () => {
	const server = fakeServer([planOf(WORK_PLAN)]);
	const { deps, store } = setup({ places: [place("work", WORK_PLAN)] }, server);
	server.setOverride((call) => {
		if (call.method !== "GET") {
			return;
		}
		const listed = { json: { plans: [...server.plans.values()] }, status: 200 };
		store.remove("work");
		server.plans.delete(WORK_PLAN);
		store.clearPendingDelete(WORK_PLAN);
		return listed;
	});

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 0 });
	expect(store.get()).toEqual({ pendingDeletes: [], places: [] });
	expect(server.requests()).not.toContain(`PUT /v1/commute/plans/${WORK_PLAN}`);
	server.setOverride(() => undefined);
	await reconcile(deps);
	expect(server.plans.has(WORK_PLAN)).toBe(false);
	expect(store.get().places).toEqual([]);
});

it("does not upload a place deleted while an earlier upload is on its way", async () => {
	const server = fakeServer();
	const { deps, store } = setup(
		{
			places: [
				place("work", WORK_PLAN, { sync: "pending" }),
				place("home", HOME_PLAN, { kind: "home", sync: "pending" }),
			],
		},
		server
	);
	server.setOverride((call) => {
		if (call.method === "PUT" && call.path.endsWith(WORK_PLAN)) {
			store.remove("home");
			store.clearPendingDelete(HOME_PLAN);
		}
	});

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 1, removed: 0 });
	expect(server.requests()).not.toContain(`PUT /v1/commute/plans/${HOME_PLAN}`);
	expect(server.plans.has(HOME_PLAN)).toBe(false);
	expect(store.get().places.map((p) => p.id)).toEqual(["work"]);
});

it("uploads the latest version of a place edited during an earlier upload", async () => {
	const server = fakeServer();
	const edited = place("home", HOME_PLAN, {
		kind: "home",
		name: "새 집",
		sync: "pending",
		updatedAt: 2000,
	});
	const { deps, store } = setup(
		{
			places: [
				place("work", WORK_PLAN, { sync: "pending" }),
				place("home", HOME_PLAN, { kind: "home", sync: "pending" }),
			],
		},
		server
	);
	const changedPlan: CommutePlan = { ...edited.plan, enabled: false };
	server.setOverride((call) => {
		if (call.method === "PUT" && call.path.endsWith(WORK_PLAN)) {
			store.upsert({ ...edited, plan: changedPlan });
		}
	});

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 2, removed: 0 });
	expect(server.plans.get(HOME_PLAN)).toEqual(changedPlan);
	expect(store.get().places.map((p) => p.sync)).toEqual(["synced", "synced"]);
});

it("deletes again a place deleted while its own save is on its way", async () => {
	const server = fakeServer();
	const { deps, store } = setup({}, server);
	let deleting: Promise<unknown> | undefined;
	server.setOverride((call) => {
		if (call.method === "PUT" && deleting === undefined) {
			// DELETE가 서버에 먼저 닿고(지울 것이 없어 204), 그 뒤 PUT이 쓰인다.
			deleting = deletePlace(deps, "work");
		}
	});

	expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("saved");
	await deleting;
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 1 });
	expect(server.plans.has(WORK_PLAN)).toBe(false);
	expect(store.get()).toEqual({ pendingDeletes: [], places: [] });
});

it("deletes again a place deleted while reconcile uploads it", async () => {
	const server = fakeServer();
	const { deps, store } = setup(
		{ places: [place("work", WORK_PLAN, { sync: "pending" })] },
		server
	);
	let deleting: Promise<unknown> | undefined;
	server.setOverride((call) => {
		if (call.method === "PUT" && deleting === undefined) {
			deleting = deletePlace(deps, "work");
		}
	});

	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 1, removed: 0 });
	await deleting;
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 1 });
	expect(server.plans.has(WORK_PLAN)).toBe(false);
	expect(store.get()).toEqual({ pendingDeletes: [], places: [] });
});

it("keeps the delete pending when its answer comes after the answer of an earlier save", async () => {
	const server = fakeServer();
	const { deps, store } = setup({}, server);
	deps.client = {
		request: (method, path, body) => {
			const response = server.client.request(method, path, body);
			if (method !== "DELETE") {
				return response;
			}
			return new Promise((resolve) => {
				setTimeout(() => resolve(response), 0);
			});
		},
	};
	let deleting: Promise<unknown> | undefined;
	server.setOverride((call) => {
		if (call.method === "PUT" && deleting === undefined) {
			deleting = deletePlace(deps, "work");
		}
	});

	await savePlace(deps, place("work", WORK_PLAN));
	expect(await deleting).toBe("pending");
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
	await reconcile(deps);
	expect(server.plans.has(WORK_PLAN)).toBe(false);
	expect(store.get()).toEqual({ pendingDeletes: [], places: [] });
});

it("keeps the delete pending when the save it raced timed out but was stored", async () => {
	const server = fakeServer();
	const { deps, store } = setup({}, server);
	let deleting: Promise<unknown> | undefined;
	server.setOverride((call) => {
		if (call.method !== "PUT" || deleting !== undefined) {
			return;
		}
		deleting = deletePlace(deps, "work");
		server.plans.set(WORK_PLAN, call.body as CommutePlan);
		return offline;
	});

	expect(await savePlace(deps, place("work", WORK_PLAN))).toBe("pending");
	await deleting;
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
	expect(await reconcile(deps)).toEqual({ imported: 0, pushed: 0, removed: 1 });
	expect(server.plans.has(WORK_PLAN)).toBe(false);
});

it("sets every planId header once at the end", async () => {
	const server = fakeServer([planOf(SERVER_PLAN), planOf(WORK_PLAN)]);
	const { deps, headers } = setup(
		{
			places: [
				place("work", WORK_PLAN),
				place("gym", GYM_PLAN, {
					kind: "other",
					name: "헬스장",
					sync: "pending",
				}),
			],
		},
		server
	);

	await reconcile(deps);
	expect(headers).toEqual([
		{
			[GYM_PLAN]: "헬스장까지",
			[SERVER_PLAN]: "가져온 경로까지",
			[WORK_PLAN]: "출근 · 회사까지",
		},
	]);
});

it("uploads only the plan and keeps the bus line meta on the device", async () => {
	const { deps, server, store } = setup();
	const work = place("work", WORK_PLAN, {
		busMeta: {
			"seoul-bus:100100341": { region: "gyeonggi", routeType: "8" },
		},
	});

	expect(await savePlace(deps, work)).toBe("saved");
	expect(server.calls[0]?.body).toEqual(work.plan);
	expect(JSON.stringify(server.calls[0]?.body)).not.toContain("busMeta");
	expect(store.get().places[0]?.busMeta).toEqual(work.busMeta);
});
