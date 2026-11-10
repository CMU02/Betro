import { type CommutePlan, parsePlan } from "@Betro/commute/plan";
import { z } from "zod";

export type PlaceKind = "home" | "work" | "school" | "other";

/**
 * 기기에만 두는 장소. 이름과 종류는 서버에 보내지 않고, `plan`만 서버에 올린다(스펙 5.2).
 * `updatedAt`은 epoch 밀리초이고, 올리는 도중에 고친 장소를 `synced`로 잘못 표시하지 않는 데 쓴다.
 */
export interface Place {
	id: string;
	kind: PlaceKind;
	name: string;
	plan: CommutePlan;
	sync: "synced" | "pending";
	updatedAt: number;
}

export interface PlacesState {
	/** 기기에서 지웠지만 아직 서버에서 지우지 못한 planId */
	pendingDeletes: string[];
	places: Place[];
}

export const PLACES_KEY = "betro.places";

const PLACES_VERSION = 1;

const placeFieldsSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["home", "work", "school", "other"]),
	name: z.string(),
	sync: z.enum(["synced", "pending"]),
	updatedAt: z.number().finite(),
});

export function emptyPlacesState(): PlacesState {
	return { pendingDeletes: [], places: [] };
}

function parseJson(raw: string | null): unknown {
	if (raw === null) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlace(value: unknown): Place | null {
	if (!isRecord(value)) {
		return null;
	}
	const fields = placeFieldsSchema.safeParse(value);
	if (!fields.success) {
		return null;
	}
	const plan = parsePlan(value.plan);
	if (!plan.ok) {
		return null;
	}
	return { ...fields.data, plan: plan.plan };
}

function parsePlaces(value: unknown): Place[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const places: Place[] = [];
	const ids = new Set<string>();
	const planIds = new Set<string>();
	for (const entry of value) {
		const place = parsePlace(entry);
		if (place === null || ids.has(place.id) || planIds.has(place.plan.planId)) {
			continue;
		}
		ids.add(place.id);
		planIds.add(place.plan.planId);
		places.push(place);
	}
	return places;
}

function parsePendingDeletes(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const planIds = value.filter(
		(entry): entry is string => typeof entry === "string" && entry.length > 0
	);
	return [...new Set(planIds)];
}

/**
 * 저장된 문자열을 장소 상태로 바꾼다. 장소는 사용자가 등록한 것이라 읽지 못한 장소만 버리고 나머지는 살린다.
 * 버전이 다르거나 JSON이 깨졌으면 빈 상태를 준다.
 */
export function parsePlacesState(raw: string | null): PlacesState {
	const data = parseJson(raw);
	if (!isRecord(data) || data.version !== PLACES_VERSION) {
		return emptyPlacesState();
	}
	return {
		pendingDeletes: parsePendingDeletes(data.pendingDeletes),
		places: parsePlaces(data.places),
	};
}

export function serializePlacesState(state: PlacesState): string {
	return JSON.stringify({
		pendingDeletes: state.pendingDeletes,
		places: state.places,
		version: PLACES_VERSION,
	});
}
