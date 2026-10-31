import type {
	ExpressKind,
	TimetableSourceKind,
} from "@Betro/db/schema/transit";
import { z } from "zod";
import { LINES, type LineKey } from "../lines";

/** 사람이 data/manual/timetables/에 넣는 파일에서 읽는 출처. 노선 설정의 manualFile이 있어야 쓴다. */
const MANUAL_FILE_KINDS: ReadonlySet<TimetableSourceKind> = new Set([
	"korail-xlsx",
	"airport-express-csv",
]);

/**
 * 기본 출처 전체가 아니라 그 안의 한 열차 종류만 대신하는 출처(부분 대체).
 * 공항철도 직통은 KRIC 파일(kric-packed)에도 정차를 건너뛰는 열차로 들어 있다(요일마다 52편, express "direct").
 * 공식 직통 시각표(airport-express-csv)를 쓰면 기본 출처의 direct trip을 빼고 이 출처의 trip으로 바꾼다.
 * 두 출처의 열차번호가 달라 duplicate-trip 검사로는 겹침을 잡을 수 없다.
 */
const PARTIAL_REPLACEMENT_KINDS: ReadonlyMap<TimetableSourceKind, ExpressKind> =
	new Map([["airport-express-csv", "direct"]]);

/** 이 출처가 다른 출처의 어떤 열차 종류를 대신하는지. 부분 대체 출처가 아니면 undefined. */
export function replacedExpress(
	kind: TimetableSourceKind
): ExpressKind | undefined {
	return PARTIAL_REPLACEMENT_KINDS.get(kind);
}

const isPartialReplacement = (kind: TimetableSourceKind): boolean =>
	PARTIAL_REPLACEMENT_KINDS.has(kind);

const KRIC_KEY_KINDS: ReadonlySet<TimetableSourceKind> = new Set(["kric-api"]);

const sourceKindSchema = z.enum([
	"seoul-metro-csv",
	"kric-korail",
	"kric-packed",
	"korail-xlsx",
	"airport-express-csv",
	"kric-api",
]);

const lineEntrySchema = z.object({
	manualFile: z.string().min(1).optional(),
	primary: sourceKindSchema,
	secondary: z.array(sourceKindSchema).optional(),
});

export type TimetableSourceEntry = z.infer<typeof lineEntrySchema>;

export interface TimetableSourcesConfig {
	lines: Record<LineKey, TimetableSourceEntry>;
}

const configSchema = z.object({
	lines: z.record(z.string(), lineEntrySchema),
});

/** timetable-sources.json을 검사한다. 19개 노선이 모두 있어야 하고, 모르는 노선·출처는 던진다. */
export function parseTimetableSourcesConfig(
	json: unknown
): TimetableSourcesConfig {
	const parsed = configSchema.parse(json);
	const lines = {} as Record<LineKey, TimetableSourceEntry>;
	const known = new Set<string>(LINES.map((line) => line.lineKey));
	for (const key of Object.keys(parsed.lines)) {
		if (!known.has(key)) {
			throw new Error(`timetable-sources.json: unknown lineKey ${key}`);
		}
	}
	for (const { lineKey } of LINES) {
		const entry = parsed.lines[lineKey];
		if (!entry) {
			throw new Error(`timetable-sources.json: missing line ${lineKey}`);
		}
		lines[lineKey] = entry;
	}
	return { lines };
}

export interface AvailableSources {
	hasKricKey: boolean;
	/** data/manual/timetables/에 있는 파일 이름들 */
	manualFiles: string[];
}

export interface ResolvedLineSources {
	lineKey: LineKey;
	/** 쓸 수 없어 건너뛴 출처와 그 이유 */
	missing: string[];
	/** 실제로 읽을 출처. 비어 있으면 그 노선은 시간표가 없다. */
	sources: TimetableSourceKind[];
}

/** 이 출처를 지금 쓸 수 없으면 그 이유, 쓸 수 있으면 undefined. */
function unavailableReason(
	kind: TimetableSourceKind,
	entry: TimetableSourceEntry,
	available: AvailableSources
): string | undefined {
	if (MANUAL_FILE_KINDS.has(kind)) {
		if (!entry.manualFile) {
			return `${kind}: manualFile이 지정되지 않음`;
		}
		if (!available.manualFiles.includes(entry.manualFile)) {
			return `${kind}: data/manual/timetables/${entry.manualFile} 없음`;
		}
	}
	if (KRIC_KEY_KINDS.has(kind) && !available.hasKricKey) {
		return `${kind}: KRIC_SERVICE_KEY 없음(키 대기)`;
	}
	return undefined;
}

/**
 * 노선마다 실제로 쓸 출처를 정한다. primary, secondary 순으로 처음 쓸 수 있는 기본 출처 하나를 고르고
 * (1차의 수동 파일이 없으면 2차로 내려간다), 부분 대체 출처(공항철도 직통)는 쓸 수 있으면 뒤에 붙인다.
 * 부분 대체 출처가 대신하는 열차 종류(replacedExpress)는 build-timetable이 기본 출처의 trip에서 뺀다.
 * 결과는 LINES 순서다.
 */
export function resolveSources(
	config: TimetableSourcesConfig,
	available: AvailableSources
): ResolvedLineSources[] {
	return LINES.map(({ lineKey }) => {
		const entry = config.lines[lineKey];
		const candidates = [entry.primary, ...(entry.secondary ?? [])];
		const sources: TimetableSourceKind[] = [];
		const missing: string[] = [];
		let base: TimetableSourceKind | undefined;
		for (const kind of candidates.filter((k) => !isPartialReplacement(k))) {
			if (base) {
				break;
			}
			const reason = unavailableReason(kind, entry, available);
			if (reason) {
				missing.push(reason);
			} else {
				base = kind;
			}
		}
		if (base) {
			sources.push(base);
		}
		for (const kind of candidates.filter(isPartialReplacement)) {
			const reason = unavailableReason(kind, entry, available);
			if (reason) {
				missing.push(reason);
			} else {
				sources.push(kind);
			}
		}
		return { lineKey, missing, sources };
	});
}
