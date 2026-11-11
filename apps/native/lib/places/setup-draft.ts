import type { Place, PlaceKind } from "./places";
import { emptyRoute, type RouteDraft } from "./route-draft";

/** 등록 화면이 열려 있는 동안만 사는 값. 구간 고르기 화면이 고른 구간을 여기에 쓰고 돌아온다. */
export interface SetupDraft {
	days: number[];
	includeHolidays: boolean;
	kind: PlaceKind;
	leaveMinute: number;
	name: string;
	placeId: string;
	planId: string;
	/** `routes[0]`이 기본 경로, 나머지가 대안이다. */
	routes: RouteDraft[];
}

export interface SetupDraftStore {
	clear: () => void;
	get: () => SetupDraft | null;
	/** 있는 경로를 바꾸거나, `index`가 경로 수와 같으면 끝에 더한다. 그 밖의 `index`는 무시한다. */
	setRoute: (index: number, route: RouteDraft) => void;
	/** 새 장소(`place` null)면 기본값과 `ids`로, 있는 장소면 그 값으로 시작한다. */
	start: (
		place: Place | null,
		ids: { placeId: string; planId: string }
	) => void;
	subscribe: (listener: () => void) => () => void;
	update: (patch: Partial<SetupDraft>) => void;
}

const DEFAULT_KIND: PlaceKind = "work";
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
/** 08:10 */
const DEFAULT_LEAVE_MINUTE = 490;

function draftOfPlace(place: Place): SetupDraft {
	const { schedule } = place.plan;
	const routes = [...place.plan.routes]
		.sort((a, b) => a.rank - b.rank)
		.map((route) => ({
			legs: [...route.legs],
			walkMinutes: [...route.walkMinutes],
		}));
	return {
		days: [...schedule.days],
		includeHolidays: schedule.includeHolidays,
		kind: place.kind,
		leaveMinute: schedule.leaveMinute,
		name: place.name,
		placeId: place.id,
		planId: place.plan.planId,
		routes,
	};
}

export function createSetupDraft(): SetupDraftStore {
	let draft: SetupDraft | null = null;
	const listeners = new Set<() => void>();

	function set(next: SetupDraft | null): void {
		draft = next;
		for (const listener of listeners) {
			listener();
		}
	}

	return {
		clear: () => set(null),
		get: () => draft,
		setRoute: (index, route) => {
			if (draft === null) {
				return;
			}
			const count = draft.routes.length;
			if (!Number.isInteger(index) || index < 0 || index > count) {
				return;
			}
			const routes =
				index === count
					? [...draft.routes, route]
					: draft.routes.map((entry, i) => (i === index ? route : entry));
			set({ ...draft, routes });
		},
		start: (place, ids) => {
			set(
				place === null
					? {
							days: [...DEFAULT_DAYS],
							includeHolidays: false,
							kind: DEFAULT_KIND,
							leaveMinute: DEFAULT_LEAVE_MINUTE,
							name: "",
							placeId: ids.placeId,
							planId: ids.planId,
							routes: [emptyRoute()],
						}
					: draftOfPlace(place)
			);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		update: (patch) => {
			if (draft !== null) {
				set({ ...draft, ...patch });
			}
		},
	};
}

/** 앱 전체가 쓰는 등록 화면 임시 값 하나. */
export const appSetupDraft = createSetupDraft();
