import { kstParts } from "./time";
import { redactKeys } from "./upstream/urls";

export const HISTORY_FLUSH_BYTES = 8 * 1024 * 1024;
export const HISTORY_FLUSH_MS = 300_000;

export interface RawRecord {
	body?: string;
	bodyHash: string;
	fetchedAt: number;
	request: string;
	source: string;
	status: number | null;
}

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function dedupeRaw(
	prevHash: string | undefined,
	record: RawRecord
): RawRecord {
	if (prevHash !== undefined && prevHash === record.bodyHash) {
		const { body: _body, ...rest } = record;
		return rest;
	}
	return record;
}

async function gzip(text: string): Promise<Uint8Array> {
	const stream = new Blob([encoder.encode(text)])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

const pad = (n: number): string => String(n).padStart(2, "0");

const HOUR_MS = 3_600_000;
const KST_OFFSET_MS = 9 * HOUR_MS;
const HOUR_KEY = /^(raw|events)\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})$/;

/** 줄 수 한 쌍: 버퍼에 넣은 줄과 그중 R2에 쓴 줄. */
export interface HistoryTotals {
	buffered: number;
	written: number;
}

/** 시간 파일(`<raw|events>/<stream>/YYYY/MM/DD/HH`, KST)별 줄 수. */
export type HistoryLineCounts = Record<string, HistoryTotals>;

/** 운행일 하나의 이력 줄 수. `written`이 `buffered`보다 작으면 그만큼 R2에 남지 않았다. */
export interface HistorySummary {
	events: Record<"subway" | "bus", HistoryTotals>;
	raw: Record<"subway" | "bus", HistoryTotals>;
}

const emptyTotals = (): HistoryTotals => ({ buffered: 0, written: 0 });

/**
 * `window` 안에서 시작하는 시간 파일의 줄 수를 원본·이벤트, 지하철·버스로 더한다.
 * 그 안에 센 시간이 하나도 없으면(세기 전의 날, 이미 지운 날) null.
 */
export function summarizeHistory(
	counts: HistoryLineCounts,
	window: { from: number; to: number }
): HistorySummary | null {
	const summary: HistorySummary = {
		events: { bus: emptyTotals(), subway: emptyTotals() },
		raw: { bus: emptyTotals(), subway: emptyTotals() },
	};
	let found = false;
	for (const [hourKey, totals] of Object.entries(counts)) {
		const m = HOUR_KEY.exec(hourKey);
		if (!m) {
			continue;
		}
		const hourStart =
			Date.UTC(Number(m[3]), Number(m[4]) - 1, Number(m[5]), Number(m[6])) -
			KST_OFFSET_MS;
		if (hourStart < window.from || hourStart >= window.to) {
			continue;
		}
		const prefix = m[1] === "raw" ? "raw" : "events";
		const source = (m[2] as string).startsWith("bus") ? "bus" : "subway";
		summary[prefix][source].buffered += totals.buffered;
		summary[prefix][source].written += totals.written;
		found = true;
	}
	return found ? summary : null;
}

/** 버퍼를 비워 만든 조각 하나. `lines`는 그 안의 줄 수, `hourKey`는 속한 시간 파일. */
export interface HistoryPart {
	body: Uint8Array;
	hourKey: string;
	key: string;
	lines: number;
}

export class HistoryBuffer {
	private readonly prefix: "raw" | "events";
	private readonly keys: readonly string[];
	private readonly onAdd: ((hourKey: string) => void) | undefined;
	private readonly groups = new Map<string, string[]>();
	private bytes = 0;
	private firstAt: number | null = null;

	/** `onAdd`: 줄을 넣을 때마다 그 줄의 시간 파일 키로 부른다(줄 수 세기용). */
	constructor(
		prefix: "raw" | "events",
		keys: readonly string[],
		onAdd?: (hourKey: string) => void
	) {
		this.prefix = prefix;
		this.keys = keys;
		this.onAdd = onAdd;
	}

	add(stream: string, at: number, record: object): void {
		const line = redactKeys(JSON.stringify(record), this.keys);
		const { date, hour } = kstParts(at);
		const hourKey = `${this.prefix}/${stream}/${date.replaceAll("-", "/")}/${pad(hour)}`;
		const lines = this.groups.get(hourKey) ?? [];
		lines.push(line);
		this.groups.set(hourKey, lines);
		this.bytes += encoder.encode(line).length + 1;
		if (this.firstAt === null || at < this.firstAt) {
			this.firstAt = at;
		}
		this.onAdd?.(hourKey);
	}

	due(now: number): boolean {
		if (this.firstAt === null) {
			return false;
		}
		return (
			this.bytes >= HISTORY_FLUSH_BYTES ||
			now - this.firstAt >= HISTORY_FLUSH_MS
		);
	}

	async flush(
		_now: number,
		nextPart: (hourKey: string) => number
	): Promise<HistoryPart[]> {
		const entries = [...this.groups.entries()].sort(([a], [b]) =>
			a < b ? -1 : 1
		);
		const out = await Promise.all(
			entries.map(async ([hourKey, lines]) => ({
				body: await gzip(`${lines.join("\n")}\n`),
				hourKey,
				key: `${hourKey}-${nextPart(hourKey)}.ndjson.gz`,
				lines: lines.length,
			}))
		);
		this.groups.clear();
		this.bytes = 0;
		this.firstAt = null;
		return out;
	}
}
