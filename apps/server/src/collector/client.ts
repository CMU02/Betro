import type { CollectorStatus } from "@Betro/realtime/metrics";
import type { Env } from "../worker-env";
import type { SnapshotKind, SnapshotResponse } from "./core";
import type { StationRowsEntry } from "./core-state";

/** 수집기 Durable Object 이름. 이름 하나 = 인스턴스 하나. */
export const COLLECTOR_NAME = "collector-v1";

export interface CollectorStartResult {
	/** 걸려 있는 다음 alarm 시각. */
	alarmAt: number;
	/** 이미 alarm이 걸려 있어 새로 걸지 않았다. */
	alreadyRunning: boolean;
}

/** Worker 라우트가 쓰는 수집기 메서드. 실제로는 DO RPC 스텁이고, 테스트는 가짜를 넣는다. */
export interface CollectorClient {
	snapshot: (kind: SnapshotKind) => Promise<SnapshotResponse>;
	start: () => Promise<CollectorStartResult>;
	status: () => Promise<CollectorStatus>;
}

/** cron과 출퇴근 실행기가 쓰는 메서드까지 포함한 클라이언트. */
export interface CollectorRpcClient extends CollectorClient {
	healthCheck: () => Promise<void>;
	/** 등록한 역 중 행을 받은 역의 최근 ALL 행. */
	stationRows: (
		statnIds: string[]
	) => Promise<Record<string, StationRowsEntry>>;
	/** 출퇴근 세션이 보는 역을 `until`까지 등록한다. */
	watchStations: (statnIds: string[], until: number) => Promise<void>;
}

/**
 * `env.COLLECTOR`의 `collector-v1` 스텁(아시아·태평양). 스텁은 호출마다 새로 얻는다
 * (DO가 다시 뜬 뒤 깨진 스텁을 들고 있지 않게).
 */
export function collectorClient(
	env: Pick<Env, "COLLECTOR">
): CollectorRpcClient {
	const stub = () =>
		env.COLLECTOR.get(env.COLLECTOR.idFromName(COLLECTOR_NAME), {
			locationHint: "apac",
		});
	return {
		healthCheck: () => stub().healthCheck(),
		snapshot: (kind) => stub().snapshot(kind),
		start: () => stub().start(),
		stationRows: (statnIds) => stub().stationRows(statnIds),
		status: () => stub().status(),
		watchStations: (statnIds, until) => stub().watchStations(statnIds, until),
	};
}
