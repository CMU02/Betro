import type { ReferenceBatchKind } from "@Betro/db/schema/transit";
import type { MetricsBucket } from "@Betro/realtime/metrics";
import type { BusReference, SubwayReference } from "@Betro/realtime/reference";
import type { CollectorConfig } from "@Betro/realtime/schedule";

/**
 * 재시작 뒤에도 이어져야 하는 값(DO SQLite). 값은 JSON으로 직렬화할 수 있어야 한다.
 * 5분 지표는 `metrics_5m` 테이블에 (bucketStart, source)를 키로 둔다.
 */
export interface StateStore {
	get: <T>(key: string) => Promise<T | undefined>;
	/** `bucketStart >= t`인 버킷 전부(시각 순). */
	metricsSince: (t: number) => Promise<MetricsBucket[]>;
	/** `bucketStart < before`인 버킷을 지운다. */
	pruneMetrics: (before: number) => Promise<void>;
	put: (key: string, value: unknown) => Promise<void>;
	/** 같은 (bucketStart, source)는 덮어쓴다. */
	putMetrics: (bucket: MetricsBucket) => Promise<void>;
}

/** 이력·보고서를 쓰는 곳(R2 `betro-data`). */
export interface BlobStore {
	put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
}

/** D1의 현재 참조 배치. */
export interface ReferenceSource {
	currentBatchIds: () => Promise<Record<ReferenceBatchKind, number>>;
	loadBus: (routeIds: string[], withShapes: boolean) => Promise<BusReference>;
	loadSubway: () => Promise<SubwayReference>;
}

export interface UpstreamResponse {
	body: string;
	/** 연결 실패·시간 초과 등. 키가 들어 있을 수 있으므로 남기기 전에 가린다. */
	error?: string;
	/** HTTP 상태. 응답을 받지 못했으면 null. */
	status: number | null;
}

/** 상류 HTTP 호출. 타임아웃 10초, 던지지 않는다. */
export interface Upstream {
	fetch: (url: string) => Promise<UpstreamResponse>;
}

export interface Notifier {
	send: (title: string, body: string) => Promise<void>;
}

export interface CollectorKeys {
	bus: string;
	subway: string;
}

export interface CollectorPorts {
	blobs: BlobStore;
	clock: () => number;
	config: CollectorConfig;
	/**
	 * 다음 alarm까지 이 시간 이상 남으면 이번 tick에서 이력 버퍼를 바로 R2에 쓴다.
	 * DO는 쉬는 동안 메모리에서 내려갈 수 있고(운영 70~140초, 로컬 약 10초) 그러면 메모리
	 * 버퍼를 잃는다. 없으면 크기·시간(5분)이 찼을 때와 운행 시간 밖에서만 쓴다.
	 */
	idleFlushMs?: number;
	keys: CollectorKeys;
	/** 한 줄씩 남긴다(Workers Logs). `CollectorCore`가 키를 지운 뒤 넘긴다. */
	log: (line: string) => void;
	notifier: Notifier;
	reference: ReferenceSource;
	/** 재시도 백오프·토큰 대기. 테스트는 수동 시계를 옮긴다. 없으면 `setTimeout`. */
	sleep?: (ms: number) => Promise<void>;
	state: StateStore;
	upstream: Upstream;
}
