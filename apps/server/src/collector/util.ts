import type { ReferenceBatchKind } from "@Betro/db/schema/transit";
import type { AnyObservation } from "@Betro/realtime/metrics";

export const DAY_MS = 86_400_000;

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 문자열을 JSON 문자열 안에 넣었을 때의 모양(따옴표 제외). */
const jsonEscaped = (text: string): string => JSON.stringify(text).slice(1, -1);

/**
 * 가릴 키 목록. 원문·URL 인코딩 형태는 `redactKeys`가 가리고, 상류 JSON 본문에
 * 들어갈 수 있는 `\/` 이스케이프 형태와, 그 둘을 다시 JSON 문자열에 넣은 형태를 더한다.
 */
export function secretVariants(keys: readonly string[]): string[] {
	const variants = new Set<string>();
	for (const key of keys) {
		if (key === "") {
			continue;
		}
		for (const form of [key, key.replaceAll("/", "\\/")]) {
			variants.add(form);
			variants.add(jsonEscaped(form));
		}
	}
	return [...variants];
}

/** 관측 중 가장 늦은 원천 시각. */
export function latestSourceAt(
	observations: readonly AnyObservation[]
): number | null {
	let latest: number | null = null;
	for (const obs of observations) {
		if (obs.sourceAt !== null && (latest === null || obs.sourceAt > latest)) {
			latest = obs.sourceAt;
		}
	}
	return latest;
}

/** 참조 배치 묶음의 비교용 문자열(`kind=id,...`). */
export function batchSignature(
	ids: Partial<Record<ReferenceBatchKind, number>>,
	kinds: readonly ReferenceBatchKind[]
): string {
	return kinds.map((kind) => `${kind}=${ids[kind] ?? "none"}`).join(",");
}

/** `items`를 최대 `limit`개씩 동시에 처리한다. */
export async function runLimited<T>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		const index = next;
		next += 1;
		if (index >= items.length) {
			return;
		}
		await fn(items[index] as T);
		await worker();
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker)
	);
}
