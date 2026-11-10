import { z } from "zod";

export interface ArrivalRow {
	arvlCd: "0" | "1" | "2" | "3" | "4" | "5" | "99";
	/** 공식 도착 예측(초). 출퇴근 세션의 역 도착판이 쓴다. 예전 표본에는 없을 수 있다. */
	barvlDt?: string;
	bstatnId: string;
	btrainNo: string;
	btrainSttus: string;
	lstcarAt: string;
	ordkey: string;
	recptnDt: string;
	statnFid: string;
	statnId: string;
	statnNm: string;
	statnTid: string;
	subwayId: string;
	updnLine: string;
}

export type ParsedArrival =
	| { ok: true; rows: ArrivalRow[]; total: number; dropped: number }
	| { ok: false; code: string; message: string };

const rowSchema = z.object({
	arvlCd: z.enum(["0", "1", "2", "3", "4", "5", "99"]),
	barvlDt: z.string().optional(),
	bstatnId: z.string(),
	btrainNo: z.string(),
	btrainSttus: z.string(),
	lstcarAt: z.string(),
	ordkey: z.string(),
	recptnDt: z.string(),
	statnFid: z.string(),
	statnId: z.string(),
	statnNm: z.string(),
	statnTid: z.string(),
	subwayId: z.string(),
	updnLine: z.string(),
});

const successSchema = z.object({
	errorMessage: z.object({ code: z.literal("INFO-000"), total: z.number() }),
	realtimeArrivalList: z.array(z.unknown()),
});

const failureSchema = z.object({
	code: z.string(),
	message: z.string().optional(),
});

const errorMessageSchema = z.object({
	errorMessage: z.object({ code: z.string(), message: z.string().optional() }),
});

/** realtimeStationArrival 응답 봉투를 파싱한다. 던지지 않는다. */
export function parseStationArrivalAll(json: unknown): ParsedArrival {
	const success = successSchema.safeParse(json);
	if (success.success) {
		const rows: ArrivalRow[] = [];
		let dropped = 0;
		for (const item of success.data.realtimeArrivalList) {
			const parsed = rowSchema.safeParse(item);
			if (parsed.success) {
				rows.push(parsed.data);
			} else {
				dropped += 1;
			}
		}
		return { dropped, ok: true, rows, total: success.data.errorMessage.total };
	}
	const wrapped = errorMessageSchema.safeParse(json);
	if (wrapped.success) {
		return {
			code: wrapped.data.errorMessage.code,
			message: wrapped.data.errorMessage.message ?? "",
			ok: false,
		};
	}
	const failure = failureSchema.safeParse(json);
	if (failure.success) {
		return {
			code: failure.data.code,
			message: failure.data.message ?? "",
			ok: false,
		};
	}
	return {
		code: "MALFORMED",
		message: "unrecognized realtimeStationArrival envelope",
		ok: false,
	};
}
