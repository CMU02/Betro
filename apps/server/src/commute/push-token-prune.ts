import { localParts } from "@Betro/commute/calendar";
import type { Database } from "@Betro/db";
import {
	commutePlan,
	commuteSession,
	install,
	pushToken,
} from "@Betro/db/schema/commute";
import { and, eq, exists, lt, notExists, or } from "drizzle-orm";

/** 끝난 세션(또는 세션 행이 없는 표본)의 Live Activity 토큰을 남기는 시간. */
export const ACTIVITY_TOKEN_KEEP_MS = 86_400_000;
/** 켜진 계획이 없는 설치를 접속 없이 두는 시간. 열린 질문이라 바뀔 수 있다. */
export const IDLE_TOKEN_KEEP_MS = 60 * 86_400_000;

/** 정리는 서비스일 경계(03:00) 뒤 04:00~04:05 사이 cron 칸 한 번만 돈다. */
const PRUNE_START_MINUTE = 4 * 60;
const PRUNE_WINDOW_MINUTES = 5;

export function shouldPrune(now: number, timezone: string): boolean {
	const { minute } = localParts(now, timezone);
	return (
		minute >= PRUNE_START_MINUTE &&
		minute < PRUNE_START_MINUTE + PRUNE_WINDOW_MINUTES
	);
}

/**
 * 묵은 푸시 토큰을 지우고 지운 행 수를 돌려준다.
 * D1 바인딩 100개 제한 때문에 ID 목록 대신 하위 질의로 지운다.
 * 시작 토큰은 앱이 다시 보내지 않으므로 updatedAt이 아니라 설치의 접속 시각으로 판단한다.
 */
export async function prunePushTokens(
	db: Database,
	now: number
): Promise<number> {
	const activityCutoff = now - ACTIVITY_TOKEN_KEEP_MS;
	const idleCutoff = now - IDLE_TOKEN_KEEP_MS;
	const deleted = await db
		.delete(pushToken)
		.where(
			or(
				// 끝난 지 하루가 지난 세션의 Activity 토큰
				and(
					eq(pushToken.kind, "apns-activity"),
					exists(
						db
							.select({ id: commuteSession.id })
							.from(commuteSession)
							.where(
								and(
									eq(commuteSession.id, pushToken.sessionId),
									eq(commuteSession.status, "ended"),
									lt(commuteSession.endedAt, activityCutoff)
								)
							)
					)
				),
				// 세션 행이 없는 Activity 토큰(표본 화면 sample-<n>)
				and(
					eq(pushToken.kind, "apns-activity"),
					lt(pushToken.updatedAt, activityCutoff),
					notExists(
						db
							.select({ id: commuteSession.id })
							.from(commuteSession)
							.where(eq(commuteSession.id, pushToken.sessionId))
					)
				),
				// 켜진 계획이 없고 오래 접속하지 않은 설치의 모든 토큰
				and(
					exists(
						db
							.select({ id: install.id })
							.from(install)
							.where(
								and(
									eq(install.id, pushToken.installId),
									lt(install.lastSeenAt, idleCutoff)
								)
							)
					),
					notExists(
						db
							.select({ id: commutePlan.id })
							.from(commutePlan)
							.where(
								and(
									eq(commutePlan.installId, pushToken.installId),
									eq(commutePlan.enabled, 1)
								)
							)
					)
				)
			)
		)
		.returning({ id: pushToken.id });
	return deleted.length;
}
