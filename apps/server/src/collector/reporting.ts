import { decideAlerts } from "@Betro/realtime/alerts";
import {
	buildDailyReport,
	buildStatus,
	METRICS_RETENTION_DAYS,
	operatingWindow,
	type SourceStatus,
} from "@Betro/realtime/metrics";
import type { CollectorState } from "./collector-state";
import {
	latestEndedOperatingDate,
	previousOperatingDate,
	STATE_KEYS,
} from "./core-state";
import type { CollectorPorts } from "./ports";
import { errorText } from "./util";

const encoder = new TextEncoder();

type Log = (line: string) => void;

/** 보고서를 아직 쓰지 않은 끝난 운행일, 오래된 것부터(지표 보관 기간 안만). */
function unreportedDates(
	state: CollectorState,
	ports: CollectorPorts,
	now: number
): string[] {
	const { config } = ports;
	const dates: string[] = [];
	let date = latestEndedOperatingDate(now, config);
	while (
		date > state.core.lastReportDate &&
		dates.length < METRICS_RETENTION_DAYS
	) {
		dates.push(date);
		date = previousOperatingDate(date, config);
	}
	return dates.reverse();
}

/** 운행일 하나의 보고서를 쓴다. 성공하면 true. */
async function writeReport(
	date: string,
	ports: CollectorPorts,
	log: Log
): Promise<boolean> {
	const { blobs, config } = ports;
	const window = operatingWindow(date, config);
	const buckets = await ports.state.metricsSince(window.from);
	const report = buildDailyReport(date, buckets, config);
	const key = `reports/${date}.json`;
	try {
		await blobs.put(
			key,
			encoder.encode(JSON.stringify(report)),
			"application/json"
		);
	} catch (error) {
		log(`report ${key} failed: ${errorText(error)}`);
		return false;
	}
	log(`report ${key} written ok=${report.ok}`);
	return true;
}

/**
 * 끝난 운행일 중 보고서가 없는 날마다 `reports/<운행일>.json`을 쓴다(오래 멈췄다 깨어나도
 * 사이의 날을 건너뛰지 않는다). 지표는 저장소에서 읽으므로 이번 tick의 지표를 먼저 저장한
 * 뒤 부른다. 쓰기에 실패하면 그날부터 다음 tick에 다시 쓴다. 모두 썼으면 true.
 */
export async function writeReportIfDue(
	state: CollectorState,
	ports: CollectorPorts,
	now: number,
	log: Log
): Promise<boolean> {
	const dates = unreportedDates(state, ports, now);
	if (dates.length === 0) {
		return true;
	}
	// 순서대로 써야 lastReportDate가 빠진 날 없이 오른다.
	const writeFrom = async (index: number): Promise<boolean> => {
		const date = dates[index];
		if (date === undefined) {
			return true;
		}
		if (!(await writeReport(date, ports, log))) {
			return false;
		}
		state.core.lastReportDate = date;
		return writeFrom(index + 1);
	};
	const done = await writeFrom(0);
	await state.saveCore(ports.state);
	return done;
}

/**
 * 알림 판단과 전송. 401로 그날 멈춘 소스와, 모든 노선이 운행 종료로 쉬는 버스는
 * 멈춤 알림에서 뺀다(키 오류 알림이 따로 나가고, 쉬는 노선은 10분마다만 부르므로).
 * 전송에 실패해도 같은 알림을 곧바로 다시 보내지 않는다(30분 간격 유지).
 */
export async function evaluateAlerts(
	state: CollectorState,
	ports: CollectorPorts,
	now: number,
	log: Log
): Promise<void> {
	const { config, notifier } = ports;
	const status = buildStatus({
		budget: state.budget,
		config,
		lineCounts: {},
		now,
		recentBuckets: [],
		sources: state.core.sources,
	});
	const suppressed = (source: SourceStatus): boolean =>
		state.isStoppedByAuth(source.name, now) ||
		(source.name === "bus" && state.allBusRoutesResting(config, now));
	const sources = status.sources.map(
		(source): SourceStatus =>
			source.health === "stalled" && suppressed(source)
				? { ...source, health: "delayed" }
				: source
	);
	const { next, send } = decideAlerts(
		state.alerts,
		{ ...status, sources },
		state.core.authFailedAt,
		now
	);
	state.alerts = next;
	const results = await Promise.allSettled(
		send.map((alert) => notifier.send(alert.title, alert.body))
	);
	for (const [i, result] of results.entries()) {
		if (result.status === "rejected") {
			log(`alert "${send[i]?.title}" failed: ${errorText(result.reason)}`);
		}
	}
	await ports.state.put(STATE_KEYS.alerts, next);
}
