import { z } from "zod";

import type { MotionViolation } from "./motion";

/**
 * 출시 기준 7.2 지표(지도 설계 4.4). 갱신 한 번에 표시 위치가 뒤로 가거나 정류장 한 구간 이상 앞으로 뛰면
 * 실패 한 건이고, 분모는 갱신 횟수다. 하루(한국 시각) 단위로 kv에 쌓고, 날이 바뀌면 지난날 숫자를 한 번 보낸다.
 * 위치나 노선은 담지 않는다.
 */

/** expo-sqlite kv-store의 동기 API 모양. 설정 저장소(`SyncKeyValue`)와 같다. */
export interface MotionMetricsStore {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

export interface MotionSummary {
	backward: number;
	jump: number;
	ratio: number;
	updates: number;
}

export interface MotionDailyReport extends MotionSummary {
	/** 한국 시각 날짜(`YYYY-MM-DD`). */
	day: string;
}

export interface MotionMetrics {
	record: (violation: MotionViolation | null) => void;
	summary: () => MotionSummary;
}

export const MOTION_METRICS_KEY = "betro.map.motionMetrics";

const KST_OFFSET_MS = 9 * 3_600_000;
const ISO_DATE_LENGTH = 10;

const dailySchema = z.object({
	backward: z.number(),
	day: z.string(),
	jump: z.number(),
	updates: z.number(),
});

type Daily = z.infer<typeof dailySchema>;

function kstDay(epochMs: number): string {
	return new Date(epochMs + KST_OFFSET_MS)
		.toISOString()
		.slice(0, ISO_DATE_LENGTH);
}

function summarize({ backward, jump, updates }: Daily): MotionSummary {
	return {
		backward,
		jump,
		ratio: updates === 0 ? 0 : (backward + jump) / updates,
		updates,
	};
}

function readDaily(store: MotionMetricsStore): Daily | null {
	try {
		const raw = store.getItem(MOTION_METRICS_KEY);
		if (raw === null) {
			return null;
		}
		const parsed = dailySchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/**
 * `report`는 날이 바뀔 때 지난날 숫자로 한 번 불린다(앱에서는 Sentry 메시지 `map-motion-daily`).
 * 갱신이 없던 날은 보내지 않는다. 저장이나 보내기가 실패해도 지도는 그대로 돈다.
 */
export function createMotionMetrics(
	store: MotionMetricsStore,
	nowMs: () => number,
	report: (daily: MotionDailyReport) => void = () => undefined
): MotionMetrics {
	let current: Daily = readDaily(store) ?? {
		backward: 0,
		day: kstDay(nowMs()),
		jump: 0,
		updates: 0,
	};

	const save = (): void => {
		try {
			store.setItem(MOTION_METRICS_KEY, JSON.stringify(current));
		} catch {
			// 못 쓰면 이번 실행 동안만 메모리에 센다.
		}
	};

	const roll = (): void => {
		const today = kstDay(nowMs());
		if (current.day === today) {
			return;
		}
		const finished = current;
		current = { backward: 0, day: today, jump: 0, updates: 0 };
		save();
		if (finished.updates > 0) {
			try {
				report({ ...summarize(finished), day: finished.day });
			} catch {
				// 지표 전송 실패가 지도를 멈추게 해서는 안 된다.
			}
		}
	};

	return {
		record(violation) {
			roll();
			current = {
				...current,
				backward: current.backward + (violation === "backward" ? 1 : 0),
				jump: current.jump + (violation === "jump" ? 1 : 0),
				updates: current.updates + 1,
			};
			save();
		},
		summary() {
			roll();
			return summarize(current);
		},
	};
}
