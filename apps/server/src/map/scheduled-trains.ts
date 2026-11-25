import type { Database } from "@Betro/db";
import { and, eq, sql } from "@Betro/db/operators";
import {
	referenceBatch,
	type TrackDirection,
	timetableStopTime,
	timetableTrip,
} from "@Betro/db/schema/transit";

import { serviceDayOf } from "../commute/cf-ports";
import { subwayStation } from "../ref/ids";

const SECOND_MS = 1000;

/** 시간표로 지금 달리는 열차 하나. 역은 `seoul-subway:<statnId>`이고 `progress`는 앞 역(0)에서 다음 역(1)까지다. */
export interface ScheduledTrain {
	direction: TrackDirection;
	fromStop: string;
	progress: number;
	toStop: string;
	trainNo: string;
	tripId: number;
}

interface PairRow {
	arriveSec: number;
	departSec: number;
	direction: TrackDirection;
	fromStatn: string;
	toStatn: string;
	trainNo: string;
	tripId: number;
}

/**
 * 시간표 추정 모드(14)에서 그릴 열차 위치(스펙 5.8). `now`가 속한 서비스일(새벽 3시 경계)과 요일 구분의 trip 중
 * 이웃한 두 정차 사이에 있는 열차를 고른다. 앞 역 시각은 `COALESCE(depart, arrive)`, 다음 역 시각은
 * `COALESCE(arrive, depart)`(`loadRunTimes`와 같다)이고, 다음 역 시각이 앞 역보다 늦은 쌍만 쓴다.
 * 앞 역에 서 있는 동안(앞 역 도착 ≤ 지금 < 출발)도 그 역에 `progress` 0으로 둔다. 빼면 역마다 열차가 사라진다.
 * 시간표 배치가 없으면 null.
 */
export async function scheduledTrains(
	db: Database,
	lineKey: string,
	now: number
): Promise<{ generatedAt: number; trains: ScheduledTrain[] } | null> {
	const [batch] = await db
		.select({ id: referenceBatch.id })
		.from(referenceBatch)
		.where(
			and(
				eq(referenceBatch.kind, "timetable"),
				eq(referenceBatch.isCurrent, true)
			)
		)
		.limit(1);
	if (!batch) {
		return null;
	}
	const { dayStart, serviceDay } = serviceDayOf(now);
	const nowSec = Math.floor((now - dayStart) / SECOND_MS);
	const next = sql`next_stop`;
	const leave = sql`coalesce(a.depart_sec, a.arrive_sec)`;
	const reached = sql`coalesce(a.arrive_sec, a.depart_sec)`;
	const reach = sql`coalesce(${next}.arrive_sec, ${next}.depart_sec)`;
	const rows = await db.all<PairRow>(sql`
		select t.id as tripId,
			t.train_no as trainNo,
			t.direction as direction,
			a.statn_id as fromStatn,
			${next}.statn_id as toStatn,
			${leave} as departSec,
			${reach} as arriveSec
		from ${timetableTrip} t
		join ${timetableStopTime} a on a.trip_id = t.id
		join ${timetableStopTime} ${next} on ${next}.trip_id = t.id and ${next}.seq = a.seq + 1
		where t.batch_id = ${batch.id}
			and t.line_key = ${lineKey}
			and t.service_day = ${serviceDay}
			and ${reached} <= ${nowSec}
			and ${reach} > ${nowSec}
			and ${reach} > ${leave}
		order by t.id, a.seq
	`);
	const trains: ScheduledTrain[] = [];
	const seen = new Set<number>();
	for (const row of rows) {
		// 시각이 거꾸로 적힌 정차가 있으면 한 trip이 두 쌍에 걸릴 수 있다. 앞 쌍 하나만 쓴다.
		if (seen.has(row.tripId)) {
			continue;
		}
		seen.add(row.tripId);
		const progress = (nowSec - row.departSec) / (row.arriveSec - row.departSec);
		trains.push({
			direction: row.direction,
			fromStop: subwayStation(row.fromStatn),
			progress: Math.min(1, Math.max(0, progress)),
			toStop: subwayStation(row.toStatn),
			trainNo: row.trainNo,
			tripId: row.tripId,
		});
	}
	return { generatedAt: now, trains };
}
