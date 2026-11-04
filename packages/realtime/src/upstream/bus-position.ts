import { z } from "zod";

export interface BusPositionRow {
	busType: string;
	congetion: string;
	dataTm: string;
	fullSectDistM: number;
	gpsX: number;
	gpsY: number;
	islastyn: boolean;
	isrunyn: boolean;
	lastStnId: string;
	plainNo: string;
	sectDistM: number;
	sectionId: string;
	sectOrd: number;
	stopFlag: boolean;
	vehId: string;
}

export type ParsedBus =
	| { ok: true; headerCd: string; rows: BusPositionRow[] }
	| { ok: false; code: string; message: string };

const M_PER_KM = 1000;

const itemSchema = z.object({
	busType: z.string(),
	congetion: z.string(),
	dataTm: z.string(),
	fullSectDist: z.string(),
	gpsX: z.string(),
	gpsY: z.string(),
	islastyn: z.string(),
	isrunyn: z.string(),
	lastStnId: z.string(),
	plainNo: z.string(),
	sectDist: z.string(),
	sectionId: z.string(),
	sectOrd: z.string(),
	stopFlag: z.string(),
	vehId: z.string(),
});

const envelopeSchema = z.object({
	msgBody: z.object({ itemList: z.array(z.unknown()).nullish() }).nullish(),
	msgHeader: z.object({
		headerCd: z.string(),
		headerMsg: z.string().nullish(),
	}),
});

const malformed = (message: string): ParsedBus => ({
	code: "MALFORMED",
	message,
	ok: false,
});

/** getBusPosByRtid 응답을 파싱한다. km 거리를 m로 바꾼다. 던지지 않는다. */
export function parseBusPositions(json: unknown): ParsedBus {
	const env = envelopeSchema.safeParse(json);
	if (!env.success) {
		return malformed("unrecognized getBusPosByRtid envelope");
	}
	const { headerCd, headerMsg } = env.data.msgHeader;
	if (headerCd !== "0") {
		// headerCd 4(결과 없음) 등은 행이 없는 정상 봉투로 돌려준다.
		return { headerCd, ok: true, rows: [] };
	}
	const rows: BusPositionRow[] = [];
	for (const item of env.data.msgBody?.itemList ?? []) {
		const p = itemSchema.safeParse(item);
		if (!p.success) {
			return malformed(headerMsg ?? p.error.message);
		}
		const d = p.data;
		rows.push({
			busType: d.busType,
			congetion: d.congetion,
			dataTm: d.dataTm,
			fullSectDistM: Math.round(Number(d.fullSectDist) * M_PER_KM),
			gpsX: Number(d.gpsX),
			gpsY: Number(d.gpsY),
			islastyn: d.islastyn === "1",
			isrunyn: d.isrunyn === "1",
			lastStnId: d.lastStnId,
			plainNo: d.plainNo,
			sectDistM: Math.round(Number(d.sectDist) * M_PER_KM),
			sectionId: d.sectionId,
			sectOrd: Number(d.sectOrd),
			stopFlag: d.stopFlag === "1",
			vehId: d.vehId,
		});
	}
	return { headerCd, ok: true, rows };
}
