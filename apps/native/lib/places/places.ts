import { type CommutePlan, parsePlan } from "@Betro/commute/plan";
import { z } from "zod";

import type { BusRegion } from "../transit/line-badge-model";

export type PlaceKind = "home" | "work" | "school" | "other";

/** 구간 고르기에서 고른 버스 노선의 종류와 지역. 저장된 구간(`Leg`)에는 없어서 배지 색을 여기서 찾는다. */
export interface BusMeta {
	region: BusRegion;
	routeType: string;
}

/** 버스 구간의 `line` → `BusMeta`. */
export type BusMetaMap = Record<string, BusMeta>;

/**
 * 기기에만 두는 장소. 이름과 종류는 서버에 보내지 않고, `plan`만 서버에 올린다(스펙 5.2).
 * `updatedAt`은 epoch 밀리초이고, 올리는 도중에 고친 장소를 `synced`로 잘못 표시하지 않는 데 쓴다.
 * `busMeta`도 기기에만 둔다(서버 계약 `CommutePlan`은 바꾸지 않는다). 맵이 생기기 전에 저장한 장소는 비어 있다.
 */
export interface Place {
	busMeta: BusMetaMap;
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

const busMetaSchema = z.object({
	region: z.enum(["seoul", "gyeonggi", "incheon"]),
	routeType: z.string(),
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

/**
 * 배지 색에만 쓰는 값이라 읽지 못한 항목만 버리고 장소는 살린다. 키가 없거나 객체가 아니면 빈 맵이다.
 * `Object.fromEntries`로 만들어 `__proto__` 같은 키도 그냥 값으로 둔다.
 */
function parseBusMeta(value: unknown): BusMetaMap {
	if (!isRecord(value)) {
		return {};
	}
	const entries: [string, BusMeta][] = [];
	for (const [line, entry] of Object.entries(value)) {
		const meta = busMetaSchema.safeParse(entry);
		if (meta.success) {
			entries.push([line, meta.data]);
		}
	}
	return Object.fromEntries(entries);
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
	return {
		...fields.data,
		busMeta: parseBusMeta(value.busMeta),
		plan: plan.plan,
	};
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
