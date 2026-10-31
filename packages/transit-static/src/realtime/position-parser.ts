import type { TrackDirection } from "@Betro/db/schema/transit";
import { z } from "zod";
import { type LineKey, lineKeyBySubwayId } from "../lines";

export const SAMPLE_POSITION_URL = (lineName: string): string =>
	`http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/${encodeURIComponent(lineName)}`;

export interface RealtimeTrainRow {
	directAt: string;
	direction: TrackDirection;
	lastRecptnDt: string;
	lineKey: LineKey;
	lstcarAt: string;
	recptnDt: string;
	statnId: string;
	statnNm: string;
	statnTid: string;
	statnTnm: string;
	subwayId: string;
	trainNo: string;
	trainSttus: "0" | "1" | "2" | "3";
	updnLine: "0" | "1";
}

export type ParsedPosition =
	| { ok: true; rows: RealtimeTrainRow[]; total: number; dropped: number }
	| { ok: false; code: string; message: string };

const rowSchema = z.object({
	directAt: z.string(),
	lastRecptnDt: z.string(),
	lstcarAt: z.string(),
	recptnDt: z.string(),
	statnId: z.string(),
	statnNm: z.string(),
	statnTid: z.string(),
	statnTnm: z.string(),
	subwayId: z.string(),
	trainNo: z.string(),
	trainSttus: z.enum(["0", "1", "2", "3"]),
	updnLine: z.enum(["0", "1"]),
});

const successSchema = z.object({
	errorMessage: z.object({
		code: z.literal("INFO-000"),
		total: z.number(),
	}),
	realtimePositionList: z.array(z.unknown()),
});

const failureSchema = z.object({
	code: z.string(),
	message: z.string().optional(),
});

const malformed = (message: string): ParsedPosition => ({
	code: "MALFORMED",
	message,
	ok: false,
});

/** realtimePosition 응답 봉투(성공/실패)를 파싱한다. 던지지 않는다. */
export function parseRealtimePosition(json: unknown): ParsedPosition {
	const success = successSchema.safeParse(json);
	if (success.success) {
		const rows: RealtimeTrainRow[] = [];
		let dropped = 0;
		for (const item of success.data.realtimePositionList) {
			const parsed = rowSchema.safeParse(item);
			if (!parsed.success) {
				return malformed(parsed.error.message);
			}
			const lineKey = lineKeyBySubwayId(parsed.data.subwayId);
			if (!lineKey) {
				dropped += 1;
				continue;
			}
			rows.push({
				...parsed.data,
				direction: parsed.data.updnLine === "0" ? "up" : "down",
				lineKey,
			});
		}
		return { dropped, ok: true, rows, total: success.data.errorMessage.total };
	}
	const failure = failureSchema.safeParse(json);
	if (failure.success) {
		return {
			code: failure.data.code,
			message: failure.data.message ?? "",
			ok: false,
		};
	}
	return malformed("unrecognized realtimePosition envelope");
}
