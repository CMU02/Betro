import type {
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
} from "@cloudflare/workers-types";
import type { Collector } from "./collector/durable-object";

/**
 * Worker 바인딩·변수·secret. vars는 wrangler.jsonc, secret은 `wrangler secret`/`.dev.vars`.
 * 키(`*_API_KEY`, `BETTER_AUTH_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `ALERT_FCM_TOKEN`)는
 * 로그·응답에 내보내지 않는다.
 */
export interface Env {
	/** 알림을 받을 개발자 기기의 FCM 토큰(secret). 없으면 알림은 로그로만 남긴다. */
	ALERT_FCM_TOKEN?: string;
	API_HOST: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	/** `prod` 버스 초당 호출 상한. 없으면 기본값. */
	BUS_REQUESTS_PER_SECOND?: string;
	COLLECTOR: DurableObjectNamespace<Collector>;
	/** `dev`(ALL + 버스 2개 노선) 또는 `prod`. */
	COLLECTOR_MODE?: string;
	CORS_ORIGIN: string;
	DAILY_BUDGET_BUS?: string;
	DAILY_BUDGET_SUBWAY?: string;
	DATA: R2Bucket;
	/** 공공데이터포털 키(버스, secret). */
	DATA_GO_KR_API_KEY?: string;
	DB: D1Database;
	/** Firebase 서비스 계정 JSON(secret). 없으면 알림은 로그로만 남긴다. */
	FCM_SERVICE_ACCOUNT_JSON?: string;
	/** 다음 alarm까지 이 시간(ms) 이상 남으면 이력을 미리 R2에 쓴다. 기본 5000(10000 미만으로 둔다). */
	HISTORY_IDLE_FLUSH_MS?: string;
	OPERATING_END_KST?: string;
	OPERATING_START_KST?: string;
	/** 서울 열린데이터광장 키(지하철, secret). */
	SEOUL_OPEN_API_KEY?: string;
	STATUS_HOST: string;
	/** `live`면 상류를 부르고, `fixture`(로컬 기본)면 저장된 표본을 돌려준다. */
	UPSTREAM_MODE?: string;
}
