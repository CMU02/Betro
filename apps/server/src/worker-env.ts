import type {
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
} from "@cloudflare/workers-types";
import type { Collector } from "./collector/durable-object";
import type { CommuteRunner } from "./commute/runner-do";

/**
 * Worker 바인딩·변수·secret. vars는 wrangler.jsonc, secret은 `wrangler secret`/`.dev.vars`.
 * 키(`*_API_KEY`, `BETTER_AUTH_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `ALERT_FCM_TOKEN`,
 * `APNS_KEY_P8`)는 로그·응답에 내보내지 않는다. 출퇴근 실행기 설정은 `COMMUTE_*`와 지역 버스 예산
 * `DAILY_BUDGET_{GBIS,TAGO}_*`(없으면 기본값).
 */
export interface Env {
	/** 알림을 받을 개발자 기기의 FCM 토큰(secret). 없으면 알림은 로그로만 남긴다. */
	ALERT_FCM_TOKEN?: string;
	API_HOST: string;
	/** APNs 키 ID(.p8 `HFSD7YXX9N`). */
	APNS_KEY_ID?: string;
	/** APNs .p8 키 PEM(secret). */
	APNS_KEY_P8?: string;
	APNS_TEAM_ID?: string;
	/** 앱 번들 ID. Live Activity 토픽은 `<topic>.push-type.liveactivity`. */
	APNS_TOPIC?: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	/** `prod` 버스 초당 호출 상한. 없으면 기본값. */
	BUS_REQUESTS_PER_SECOND?: string;
	COLLECTOR: DurableObjectNamespace<Collector>;
	/** `dev`(ALL + 버스 2개 노선) 또는 `prod`. */
	COLLECTOR_MODE?: string;
	/** 출퇴근 실행기 Durable Object. */
	COMMUTE: DurableObjectNamespace<CommuteRunner>;
	/** 예약을 확인할 시간대(쉼표로 구분). 없으면 기본 시간대 하나. */
	COMMUTE_TIMEZONES?: string;
	CORS_ORIGIN: string;
	DAILY_BUDGET_BUS?: string;
	/** 출퇴근 실행기의 GBIS 도착(`getBusArrivalItemv2`) 하루 예산. 기본 900. */
	DAILY_BUDGET_GBIS_ARRIVAL?: string;
	/** 수집기(지도) 몫의 GBIS 위치 목록 하루 예산. 기본 300. */
	DAILY_BUDGET_GBIS_LOCATION_COLLECTOR?: string;
	/** 출퇴근 실행기 몫의 GBIS 위치 목록(`getBusLocationListv2`) 하루 예산. 기본 600. */
	DAILY_BUDGET_GBIS_LOCATION_RUNNER?: string;
	DAILY_BUDGET_SUBWAY?: string;
	/** 출퇴근 실행기의 TAGO 도착 하루 예산. 기본 9000. */
	DAILY_BUDGET_TAGO_ARRIVAL?: string;
	/** 수집기(지도) 몫의 TAGO 위치 목록 하루 예산. 기본 3000. */
	DAILY_BUDGET_TAGO_LOCATION_COLLECTOR?: string;
	/** 출퇴근 실행기 몫의 TAGO 위치 목록 하루 예산. 기본 6000. */
	DAILY_BUDGET_TAGO_LOCATION_RUNNER?: string;
	DATA: R2Bucket;
	/** 공공데이터포털 키(버스, secret). */
	DATA_GO_KR_API_KEY?: string;
	DB: D1Database;
	/** Firebase 서비스 계정 JSON(secret). 없으면 알림은 로그로만 남긴다. */
	FCM_SERVICE_ACCOUNT_JSON?: string;
	/** 다음 alarm까지 이 시간(ms) 이상 남으면 이력을 미리 R2에 쓴다. 기본 5000(10000 미만으로 둔다). */
	HISTORY_IDLE_FLUSH_MS?: string;
	/** 설치 하나가 동시에 관측을 요청할 수 있는 버스 노선 수. 기본 6. */
	MAP_WATCH_MAX_PER_INSTALL?: string;
	/** 수집기가 관측 요청으로 부르는 버스 노선 수 상한(모든 설치 합). 기본 40. */
	MAP_WATCH_MAX_TOTAL?: string;
	/** 지도 관측 요청이 살아 있는 시간(ms). 앱이 60초마다 다시 보낸다. 기본 90000. */
	MAP_WATCH_TTL_MS?: string;
	OPERATING_END_KST?: string;
	OPERATING_START_KST?: string;
	/** `send`면 APNs·FCM에 보내고, `log`(기본)면 로그만 남긴다. */
	PUSH_MODE?: string;
	/** 서울 열린데이터광장 키(지하철, secret). */
	SEOUL_OPEN_API_KEY?: string;
	STATUS_HOST: string;
	/** `live`면 상류를 부르고, `fixture`(로컬 기본)면 저장된 표본을 돌려준다. */
	UPSTREAM_MODE?: string;
}
