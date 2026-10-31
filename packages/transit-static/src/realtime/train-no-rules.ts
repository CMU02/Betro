import type { LineKey } from "../lines";

/** 실시간 열차번호 하나에서 나온 시간표 열차번호 후보. */
export interface TrainNoMatch {
	/** 2호선만: 지선(1xxx/5xxx) 번호인지 본선 번호인지. */
	branchHint?: "main" | "branch";
	candidates: string[];
	/** 어떤 규칙을 썼는지(보고서용 이름). */
	rule: string;
}

export interface TrainNoOptions {
	/** 급행 여부(실시간 directAt). 모르면 undefined. 9호선만 쓴다. */
	express?: boolean;
}

/** 실시간 trainNo → 시간표 trainNo 후보. 노선마다 바꿔 끼울 수 있다. */
export type TrainNoRule = (
	raw: string,
	options: TrainNoOptions
) => TrainNoMatch;

const LINE1_PREFIX = /^[KS]/;
const LINE2_BRANCH = /^[15]\d{3}$/;
const LINE1_DIGITS = 4;
const LINE2_SUFFIX_DIGITS = 3;

/** 1호선: 앞의 K/S를 떼고 4자리로 0을 채운다. 시간표 쪽 번호(K802, S2)도 같은 형태로 만든다. */
const normalizeLine1 = (trainNo: string): string =>
	trainNo.replace(LINE1_PREFIX, "").padStart(LINE1_DIGITS, "0");

const same =
	(rule: string): TrainNoRule =>
	(raw) => ({ candidates: [raw], rule });

const line1: TrainNoRule = (raw) => ({
	candidates: [normalizeLine1(raw)],
	rule: "line1-strip-ks-pad4",
});

const line2: TrainNoRule = (raw) =>
	LINE2_BRANCH.test(raw)
		? { branchHint: "branch", candidates: [raw], rule: "line2-branch" }
		: {
				branchHint: "main",
				candidates: [`2${raw.slice(-LINE2_SUFFIX_DIGITS)}`],
				rule: "line2-main-2xxx",
			};

const line3: TrainNoRule = (raw) => ({
	candidates: [raw, `${raw}K`],
	rule: "line3-k-suffix",
});

const line4: TrainNoRule = (raw) => ({
	candidates: [raw, `K${raw}`],
	rule: "line4-k-prefix",
});

function line9Prefixes(express: boolean | undefined): string[] {
	if (express === undefined) {
		return ["C", "E"];
	}
	return express ? ["E"] : ["C"];
}

const line9: TrainNoRule = (raw, { express }) => ({
	candidates: line9Prefixes(express).map((prefix) => `${prefix}${raw}`),
	rule: "line9-c-e-prefix",
});

const korail: TrainNoRule = (raw) => ({
	candidates: [`K${raw}`, raw],
	rule: "korail-k-prefix",
});

/**
 * 노선별 규칙표(설계 §4.3). null은 규칙이 없다는 뜻이고 그 노선 열차는 "시간표 없음"으로 넘긴다.
 * 공식 보장이 없는 관행이라 실제 응답 표본으로 매칭률을 재서 검증한다(report:match-rate).
 */
export const TRAIN_NO_RULES: Readonly<Record<LineKey, TrainNoRule | null>> = {
	airport: same("same"),
	"gtx-a": null,
	gyeongchun: korail,
	gyeonggang: korail,
	"gyeongui-jungang": korail,
	line1,
	line2,
	line3,
	line4,
	line5: same("same"),
	line6: same("same"),
	line7: same("same"),
	line8: same("same"),
	line9,
	seohae: korail,
	shinbundang: null,
	sillim: same("same"),
	"suin-bundang": korail,
	"ui-sinseol": same("same"),
};

/** 실시간 trainNo의 시간표 번호 후보. 규칙이 없는 노선(신분당, GTX-A)은 null. */
export function trainNoCandidates(
	lineKey: LineKey,
	rawTrainNo: string,
	options: TrainNoOptions = {}
): TrainNoMatch | null {
	return TRAIN_NO_RULES[lineKey]?.(rawTrainNo, options) ?? null;
}

/**
 * 시간표 trip의 trainNo를 후보와 비교할 형태로 바꾼다. 1호선만 시간표가 접두(K802, S902)를 달고
 * 실시간이 4자리 숫자(0802)라 같은 정규화를 양쪽에 건다. 다른 노선은 그대로.
 */
export function timetableTrainNoKey(lineKey: LineKey, trainNo: string): string {
	return lineKey === "line1" ? normalizeLine1(trainNo) : trainNo;
}
