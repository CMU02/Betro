import { HistoryBuffer } from "@Betro/realtime/history";
import { kstParts } from "@Betro/realtime/time";
import type { BlobStore } from "./ports";

const DAY_MS = 86_400_000;
/** 압축된 NDJSON. R2가 풀지 않도록 `Content-Encoding` 없이 그대로 둔다. */
const NDJSON_GZIP = "application/gzip";
/** 쓰기에 실패해 들고 있는 조각의 상한(압축 바이트). 넘으면 오래된 것부터 버린다(128MB isolate 보호). */
export const MAX_PENDING_BYTES = 32 * 1024 * 1024;
/** 한 번에 R2에 쓰는 조각 수 상한(서브요청 폭주 방지). 나머지는 다음 호출로 미룬다. */
export const MAX_PUTS_PER_WRITE = 50;

interface PendingBlob {
	body: Uint8Array;
	key: string;
}

export interface HistoryWriteHooks {
	onError: (key: string, error: unknown) => void;
	/** 조각 번호를 저장소에 저장한다. R2에 쓰기 전에 부른다. */
	persistParts: (parts: PartCounters) => Promise<void>;
}

/** 시간 파일별 다음 조각 번호. 재시작 뒤에도 같은 키를 덮어쓰지 않도록 저장한다. */
export type PartCounters = Record<string, number>;

/**
 * 원본(`raw/`)과 관측 이벤트(`events/`) 버퍼를 R2에 쓴다.
 * `flush`가 버퍼를 비운 뒤 쓰기에 실패한 조각은 들고 있다가 다음에 다시 쓴다.
 */
export class HistoryWriter {
	readonly raw: HistoryBuffer;
	readonly events: HistoryBuffer;
	readonly #parts: PartCounters;
	readonly #pending: PendingBlob[] = [];
	/** flush로 받은 조각 번호를 아직 저장소에 저장하지 않았다. */
	#partsUnsaved: boolean;

	readonly #maxPendingBytes: number;

	constructor(
		keys: readonly string[],
		parts: PartCounters = {},
		maxPendingBytes = MAX_PENDING_BYTES
	) {
		this.#maxPendingBytes = maxPendingBytes;
		this.raw = new HistoryBuffer("raw", keys);
		this.events = new HistoryBuffer("events", keys);
		this.#parts = { ...parts };
		this.#partsUnsaved = false;
	}

	get parts(): PartCounters {
		return { ...this.#parts };
	}

	get pendingCount(): number {
		return this.#pending.length;
	}

	readonly #nextPart = (hourKey: string): number => {
		const part = this.#parts[hourKey] ?? 0;
		this.#parts[hourKey] = part + 1;
		return part;
	};

	/** 오늘·어제(KST) 시간 파일이 아닌 조각 번호는 버린다. */
	#pruneParts(now: number): void {
		const keep = [now, now - DAY_MS].map(
			(t) => `/${kstParts(t).date.replaceAll("-", "/")}/`
		);
		for (const hourKey of Object.keys(this.#parts)) {
			if (!keep.some((day) => hourKey.includes(day))) {
				delete this.#parts[hourKey];
			}
		}
	}

	/**
	 * 크기·시간이 찼거나 `force`이면 버퍼를 비워 쓰고, 밀린 조각도 다시 쓴다.
	 * 새 조각 번호를 받았으면 R2에 쓰기 전에 `persistParts`로 번호를 먼저 저장한다(쓴 뒤
	 * 저장 전에 죽으면 되살아나 같은 번호로 이미 올린 객체를 덮어쓴다). 저장에 실패하면
	 * 이번에는 쓰지 않고 들고 있다가 다음 호출에서 다시 저장·쓰기를 시도한다.
	 * 실패한 쓰기는 `onError`로 알린다.
	 */
	async write(
		blobs: BlobStore,
		now: number,
		force: boolean,
		hooks: HistoryWriteHooks
	): Promise<void> {
		const flushed = await Promise.all(
			[this.raw, this.events]
				.filter((buffer) => force || buffer.due(now))
				.map((buffer) => buffer.flush(now, this.#nextPart))
		);
		const blobsFlushed = flushed.flat();
		this.#pending.push(...blobsFlushed);
		this.#pruneParts(now);
		const mustPersist = this.#partsUnsaved || blobsFlushed.length > 0;
		if (mustPersist) {
			try {
				await hooks.persistParts(this.parts);
				this.#partsUnsaved = false;
			} catch (error) {
				this.#partsUnsaved = true;
				hooks.onError("parts", error);
				return;
			}
		}
		const batch = this.#pending.splice(0, MAX_PUTS_PER_WRITE);
		const results = await Promise.allSettled(
			batch.map((blob) => blobs.put(blob.key, blob.body, NDJSON_GZIP))
		);
		const failed: PendingBlob[] = [];
		for (const [i, result] of results.entries()) {
			const blob = batch[i] as PendingBlob;
			if (result.status === "rejected") {
				failed.push(blob);
				hooks.onError(blob.key, result.reason);
			}
		}
		// 실패한 조각은 아직 시도하지 않은 조각 앞에 둔다(시간 순서 유지).
		this.#pending.unshift(...failed);
		this.#dropOverflow(hooks);
	}

	/** 들고 있는 조각이 상한(기본 `MAX_PENDING_BYTES`)을 넘으면 오래된 것부터 버리고 알린다. */
	#dropOverflow(hooks: HistoryWriteHooks): void {
		let total = this.#pending.reduce((sum, blob) => sum + blob.body.length, 0);
		while (total > this.#maxPendingBytes && this.#pending.length > 0) {
			const dropped = this.#pending.shift() as PendingBlob;
			total -= dropped.body.length;
			hooks.onError(
				dropped.key,
				new Error("history backlog over limit, dropped oldest part")
			);
		}
	}
}
