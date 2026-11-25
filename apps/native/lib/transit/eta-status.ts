import { t } from "@/lib/i18n/t";

const MS_PER_MIN = 60_000;

/** 공식 예측이 아니라 시간표·배차간격·보간으로 낸 값의 method. 지도 시트와 도착 칸이 같이 쓴다. */
export const ESTIMATED_METHODS: readonly string[] = [
	"timetable",
	"headway",
	"extrapolated",
];

export interface EtaStatus {
	kind: "live" | "estimated" | "ended";
	text: string;
}

export interface ArrivalStatusInput {
	etaAt: number | null;
	etaState: "live" | "estimated";
	method: string | null;
	now: number;
}

const roundedMinutes = (ms: number): number =>
	Math.max(1, Math.round(ms / MS_PER_MIN));

/** 도착 한 칸의 글자와 태그. 단정하지 않는다. etaAt이 없으면 글자가 비고 화면은 그 줄을 그리지 않는다. */
export function arrivalStatus(input: ArrivalStatusInput): EtaStatus {
	const { etaAt, etaState, method, now } = input;
	if (etaAt === null) {
		return { kind: "estimated", text: "" };
	}
	const remainingMs = etaAt - now;
	if (etaState === "estimated" || ESTIMATED_METHODS.includes(method ?? "")) {
		return {
			kind: "estimated",
			text: t("eta.minutesEstimated", { minutes: roundedMinutes(remainingMs) }),
		};
	}
	if (remainingMs < MS_PER_MIN) {
		return { kind: "live", text: t("eta.arriving") };
	}
	return {
		kind: "live",
		text: t("eta.minutes", { minutes: roundedMinutes(remainingMs) }),
	};
}

/** 정적 배차간격 칸. null이면 운행 시간 밖이다. */
export function headwayStatus(headwayMs: number | null): EtaStatus {
	if (headwayMs === null) {
		return { kind: "ended", text: t("eta.ended") };
	}
	return {
		kind: "estimated",
		text: t("eta.headway", { minutes: roundedMinutes(headwayMs) }),
	};
}
