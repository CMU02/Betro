import { type CommutePlan, parsePlan } from "@Betro/commute/plan";

import type { MessageKey, MessageParams } from "../i18n/translate";
import type { ServerClient, ServerResponse } from "../server/api-client";
import type { Place } from "./places";
import type { PlacesStore } from "./places-store";
import { headersOf } from "./plan-headers";

export interface SyncDeps {
	client: ServerClient;
	now: () => number;
	/** planId → 머리줄 전체를 잠금화면에 넘긴다. */
	setHeaders: (headers: Record<string, string>) => Promise<void>;
	store: PlacesStore;
	t: (key: MessageKey, params?: MessageParams) => string;
}

/** `rejected`는 서버가 400과 함께 준 문구 그대로다. */
export type SaveResult = "saved" | "pending" | "limit" | { rejected: string[] };

export interface ReconcileSummary {
	imported: number;
	pushed: number;
	removed: number;
}

const PLANS_PATH = "/v1/commute/plans";
const NETWORK_ERROR_STATUS = 0;
const NO_CONTENT = 204;
const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const IMPORTED_ID_PREFIX = "imported-";

function planPath(planId: string): string {
	return `${PLANS_PATH}/${encodeURIComponent(planId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 400 응답의 문구. `issues`가 없으면 `error` 하나를 쓴다. */
function rejectedIssues(json: unknown): string[] {
	if (!isRecord(json)) {
		return [];
	}
	if (Array.isArray(json.issues)) {
		return json.issues.filter(
			(issue): issue is string => typeof issue === "string"
		);
	}
	return typeof json.error === "string" ? [json.error] : [];
}

async function pushHeaders(deps: SyncDeps): Promise<void> {
	await deps.setHeaders(headersOf(deps.store.get().places, deps.t));
}

function putPlan(deps: SyncDeps, plan: CommutePlan): Promise<ServerResponse> {
	return deps.client.request("PUT", planPath(plan.planId), plan);
}

function deletePlan(deps: SyncDeps, planId: string): Promise<ServerResponse> {
	return deps.client.request("DELETE", planPath(planId), undefined);
}

function isDeleted(status: number): boolean {
	return status === NO_CONTENT || status === NOT_FOUND;
}

/**
 * 기기에 `pending`으로 먼저 쓰고 서버에 올린다. 서버가 받으면 `synced`로 바꾼다.
 * 409(설치당 예약 한도)는 새 장소를 올릴 때만 나므로 기기에서도 지운다(지울 목록에도 넣지 않는다).
 */
export async function savePlace(
	deps: SyncDeps,
	place: Place
): Promise<SaveResult> {
	const stored: Place = { ...place, sync: "pending", updatedAt: deps.now() };
	deps.store.upsert(stored);
	const { json, status } = await putPlan(deps, stored.plan);
	let result: SaveResult = "pending";
	if (status === NO_CONTENT) {
		deps.store.markSynced(stored.id, stored.updatedAt);
		result = "saved";
	} else if (status === BAD_REQUEST) {
		result = { rejected: rejectedIssues(json) };
	} else if (status === CONFLICT) {
		deps.store.remove(stored.id);
		deps.store.clearPendingDelete(stored.plan.planId);
		result = "limit";
	}
	await pushHeaders(deps);
	return result;
}

/** 기기에서 지우고(지울 목록에 들어간다) 서버에서 지운다. 서버가 이미 없다고 해도(404) 지운 것이다. */
export async function deletePlace(
	deps: SyncDeps,
	placeId: string
): Promise<"deleted" | "pending"> {
	const target = deps.store.get().places.find((entry) => entry.id === placeId);
	if (target === undefined) {
		return "deleted";
	}
	const { planId } = target.plan;
	deps.store.remove(placeId);
	const { status } = await deletePlan(deps, planId);
	const deleted = isDeleted(status);
	if (deleted) {
		deps.store.clearPendingDelete(planId);
	}
	await pushHeaders(deps);
	return deleted ? "deleted" : "pending";
}

/** 서버 목록의 예약. 읽지 못한 예약은 빼고, 같은 planId는 하나만 남긴다. 목록이 아니면 null. */
function serverPlans(response: ServerResponse): CommutePlan[] | null {
	if (
		response.status !== OK ||
		!isRecord(response.json) ||
		!Array.isArray(response.json.plans)
	) {
		return null;
	}
	const plans = new Map<string, CommutePlan>();
	for (const entry of response.json.plans) {
		const parsed = parsePlan(entry);
		if (parsed.ok && !plans.has(parsed.plan.planId)) {
			plans.set(parsed.plan.planId, parsed.plan);
		}
	}
	return [...plans.values()];
}

/** ① 밀린 삭제. 서버에 닿지 않으면 null. */
async function sendPendingDeletes(deps: SyncDeps): Promise<number | null> {
	let removed = 0;
	for (const planId of deps.store.get().pendingDeletes) {
		// biome-ignore lint/performance/noAwaitInLoops: one at a time so the first unreachable request stops the rest
		const { status } = await deletePlan(deps, planId);
		if (status === NETWORK_ERROR_STATUS) {
			return null;
		}
		if (isDeleted(status)) {
			deps.store.clearPendingDelete(planId);
			removed += 1;
		}
	}
	return removed;
}

/** 지금 기기에 있는 장소의 최신 값. 지워졌거나, 지울 목록에 있거나, 더는 `pending`이 아니면 undefined. */
function stillPending(deps: SyncDeps, placeId: string): Place | undefined {
	const { pendingDeletes, places } = deps.store.get();
	const latest = places.find((entry) => entry.id === placeId);
	if (
		latest === undefined ||
		latest.sync !== "pending" ||
		pendingDeletes.includes(latest.plan.planId)
	) {
		return;
	}
	return latest;
}

/**
 * 장소들의 예약을 올린다. 받은 것만 `synced`로 바꾸고 나머지(400, 409, 5xx)는 `pending`으로 둔다.
 * 사용자가 등록한 장소라 409여도 뒤에서 지우지 않는다. 서버에 닿지 않으면 null.
 * 앞 요청을 기다리는 사이 지워지거나 고쳐질 수 있어, 올리기 직전에 기기에서 다시 찾아 최신 값을 올린다.
 */
async function pushPlaces(
	deps: SyncDeps,
	places: Place[]
): Promise<number | null> {
	let pushed = 0;
	for (const { id } of places) {
		const latest = stillPending(deps, id);
		if (latest === undefined) {
			continue;
		}
		// biome-ignore lint/performance/noAwaitInLoops: one at a time so the first unreachable request stops the rest
		const { status } = await putPlan(deps, latest.plan);
		if (status === NETWORK_ERROR_STATUS) {
			return null;
		}
		if (status === NO_CONTENT) {
			deps.store.markSynced(latest.id, latest.updatedAt);
			pushed += 1;
		}
	}
	return pushed;
}

/** 기기가 아는 planId(장소와 지울 목록). */
function knownPlanIds(deps: SyncDeps): Set<string> {
	const { pendingDeletes, places } = deps.store.get();
	return new Set([
		...pendingDeletes,
		...places.map((place) => place.plan.planId),
	]);
}

/**
 * ④ 서버에만 있는 예약(지울 목록에 없는 것)을 이름 없는 기타 장소로 가져온다.
 * `knownBefore`는 목록을 요청하기 직전에 기기가 알던 planId다. 응답을 기다리는 사이 지운 예약을
 * 서버 목록이 아직 담고 있어도 가져오지 않는다.
 */
function importServerOnly(
	deps: SyncDeps,
	plans: CommutePlan[],
	knownBefore: Set<string>
): number {
	const state = deps.store.get();
	const known = new Set([...knownBefore, ...knownPlanIds(deps)]);
	const usedIds = new Set(state.places.map((place) => place.id));
	const imported: Place[] = [];
	for (const plan of plans) {
		const id = `${IMPORTED_ID_PREFIX}${plan.planId}`;
		if (known.has(plan.planId) || usedIds.has(id)) {
			continue;
		}
		known.add(plan.planId);
		usedIds.add(id);
		imported.push({
			id,
			kind: "other",
			name: "",
			plan,
			sync: "synced",
			updatedAt: deps.now(),
		});
	}
	if (imported.length > 0) {
		deps.store.replace({ ...state, places: [...state.places, ...imported] });
	}
	return imported.length;
}

/** ⑤ 기기에 `synced`로 있는데 서버에 없는 장소(서버가 설치를 지운 경우)를 `pending`으로 바꾼다. */
function markMissingPending(deps: SyncDeps, plans: CommutePlan[]): Place[] {
	const onServer = new Set(plans.map((plan) => plan.planId));
	const missing = deps.store
		.get()
		.places.filter(
			(place) => place.sync === "synced" && !onServer.has(place.plan.planId)
		);
	for (const place of missing) {
		deps.store.upsert({ ...place, sync: "pending" });
	}
	return missing;
}

async function syncWithServer(
	deps: SyncDeps
): Promise<ReconcileSummary | "offline"> {
	const removed = await sendPendingDeletes(deps);
	if (removed === null) {
		return "offline";
	}
	const pending = deps.store
		.get()
		.places.filter((place) => place.sync === "pending");
	const pushedPending = await pushPlaces(deps, pending);
	if (pushedPending === null) {
		return "offline";
	}
	const knownBefore = knownPlanIds(deps);
	const plans = serverPlans(
		await deps.client.request("GET", PLANS_PATH, undefined)
	);
	if (plans === null) {
		return "offline";
	}
	const imported = importServerOnly(deps, plans, knownBefore);
	const pushedMissing = await pushPlaces(deps, markMissingPending(deps, plans));
	return {
		imported,
		pushed: pushedPending + (pushedMissing ?? 0),
		removed,
	};
}

/**
 * 기기와 서버의 예약을 맞춘다. ① 밀린 삭제 ② 밀린 저장 ③ 서버 목록 ④ 서버에만 있는 예약 가져오기
 * ⑤ 서버가 잃은 예약 다시 올리기 ⑥ 머리줄. ③을 읽지 못하면(또는 그 전에 서버에 닿지 않으면) `"offline"`이고
 * ④⑤를 하지 않는다. 머리줄은 어느 경우에도 끝에 한 번 넘긴다.
 */
export async function reconcile(
	deps: SyncDeps
): Promise<ReconcileSummary | "offline"> {
	const result = await syncWithServer(deps);
	await pushHeaders(deps);
	return result;
}
