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

export class HistoryBuffer {
	private readonly prefix: "raw" | "events";
	private readonly keys: readonly string[];
	private readonly groups = new Map<string, string[]>();
	private bytes = 0;
	private firstAt: number | null = null;

	constructor(prefix: "raw" | "events", keys: readonly string[]) {
		this.prefix = prefix;
		this.keys = keys;
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
	): Promise<{ key: string; body: Uint8Array }[]> {
		const entries = [...this.groups.entries()].sort(([a], [b]) =>
			a < b ? -1 : 1
		);
		const out = await Promise.all(
			entries.map(async ([hourKey, lines]) => ({
				body: await gzip(`${lines.join("\n")}\n`),
				key: `${hourKey}-${nextPart(hourKey)}.ndjson.gz`,
			}))
		);
		this.groups.clear();
		this.bytes = 0;
		this.firstAt = null;
		return out;
	}
}
