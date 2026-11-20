import type { Route } from "@Betro/commute/plan";
import type { SessionInput } from "@Betro/commute/session/stage";
import type { Env } from "../worker-env";
import type { ActiveSession, InputResult, RouteView } from "./runner-core";

/** 출퇴근 실행기 Durable Object 이름. 이름 하나 = 인스턴스 하나. */
export const COMMUTE_NAME = "commute-v1";

/** Worker 라우트와 cron이 쓰는 실행기 메서드. 실제로는 DO RPC 스텁이고, 테스트는 가짜를 넣는다. */
export interface CommuteRunnerClient {
	ack: (
		installId: string,
		sessionId: string,
		at: number
	) => Promise<"ok" | "not-found">;
	activeSession: (installId: string) => Promise<ActiveSession | null>;
	/** cron(5분)용: alarm이 사라졌으면 다시 건다. */
	healthCheck: () => Promise<void>;
	input: (
		installId: string,
		sessionId: string,
		input: SessionInput
	) => Promise<InputResult>;
	/** 지도에서 고른 경로 하나의 예상(경로 보기). 실행기가 버스 도착정보를 지도 용도로 부른다. */
	routeView: (route: Route) => Promise<RouteView>;
	/** cron용: 서비스일 하나의 출퇴근 일일 보고서(`commute/reports/<date>.json`). 이미 썼으면 false. */
	writeDailyReport: (date: string) => Promise<boolean>;
}

/**
 * `env.COMMUTE`의 `commute-v1` 스텁(아시아·태평양). 스텁은 호출마다 새로 얻는다
 * (DO가 다시 뜬 뒤 깨진 스텁을 들고 있지 않게).
 */
export function commuteClient(env: Pick<Env, "COMMUTE">): CommuteRunnerClient {
	const stub = () =>
		env.COMMUTE.get(env.COMMUTE.idFromName(COMMUTE_NAME), {
			locationHint: "apac",
		});
	return {
		ack: (installId, sessionId, at) => stub().ack(installId, sessionId, at),
		activeSession: (installId) => stub().activeSession(installId),
		healthCheck: () => stub().healthCheck(),
		input: (installId, sessionId, input) =>
			stub().input(installId, sessionId, input),
		routeView: (route) => stub().routeView(route),
		writeDailyReport: (date) => stub().writeDailyReport(date),
	};
}
