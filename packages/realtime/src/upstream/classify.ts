import type { ParsedBus } from "./bus-position";
import type { ParsedArrival } from "./subway-arrival";

export type UpstreamOutcome =
	| "ok"
	| "no-data"
	| "service-ended"
	| "temporary"
	| "rate-limited"
	| "quota-exhausted"
	| "auth"
	| "request-error"
	| "network";

const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

type ParsedSubway =
	| ParsedArrival
	| { ok: true; rows: unknown[] }
	| { ok: false; code: string; message: string };

export function classifySubway(
	status: number | null,
	parsed: ParsedSubway | null
): UpstreamOutcome {
	if (status === null) {
		return "network";
	}
	if (status === HTTP_UNAUTHORIZED) {
		return "auth";
	}
	if (status === HTTP_TOO_MANY) {
		return "rate-limited";
	}
	if (status >= HTTP_SERVER_ERROR) {
		return "network";
	}
	if (!parsed) {
		return "request-error";
	}
	if (parsed.ok) {
		return "ok";
	}
	if (parsed.code === "INFO-200") {
		return "no-data";
	}
	if (parsed.code === "INFO-100") {
		return "auth";
	}
	return "request-error";
}

const BUS_HEADER_OUTCOME: Record<string, UpstreamOutcome> = {
	"0": "ok",
	"4": "no-data",
	"6": "temporary",
	"7": "auth",
	"8": "service-ended",
};

const GW_QUOTA = "22";
const GW_RATE = "23";

/** `returnReasonCode`는 공공데이터포털 게이트웨이 오류 본문에서 온 값. */
export function classifyBus(
	status: number | null,
	parsed: ParsedBus | null,
	returnReasonCode?: string
): UpstreamOutcome {
	if (status === null) {
		return "network";
	}
	if (status === HTTP_UNAUTHORIZED) {
		return "auth";
	}
	if (status === HTTP_TOO_MANY || returnReasonCode === GW_QUOTA) {
		return "quota-exhausted";
	}
	if (returnReasonCode === GW_RATE) {
		return "rate-limited";
	}
	if (status >= HTTP_SERVER_ERROR) {
		return "network";
	}
	if (!parsed) {
		return "request-error";
	}
	if (!parsed.ok) {
		return "request-error";
	}
	return BUS_HEADER_OUTCOME[parsed.headerCd] ?? "request-error";
}
