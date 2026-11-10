# MVP 2-C: 출퇴근 서버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록한 출퇴근 경로의 예약 시각에 세션을 만들고, 탈 차량의 위치와 도착 시각을 계산해 iOS(APNs)와 Android(FCM)로 시작·갱신·종료 푸시를 보내는 서버를 만든다.

**Architecture:** 순수 로직은 새 패키지 `packages/commute`에 둔다(경로 형식, 시간대·공휴일, 출처 어댑터, 차량 선택, 단계 기계, 푸시 값, 정확도 기록). Cloudflare API를 쓰지 않아 `bun test`로 전부 검증한다. `apps/server/src/commute`는 이것을 Hono REST 라우트, D1, Durable Object `CommuteRunner` 하나(alarm 30초)에 연결한다. 지하철은 수집기가 이미 받는 `realtimeStationArrival/ALL`에서 역 도착판을 꺼내 쓰고(추가 호출 0건), 버스는 실행기가 `getArrInfoByRouteAll`을 노선당 한 번씩 직접 부른다(수집기 위치 예산과 별개).

**Tech Stack:** TypeScript 6, bun test, Hono, zod, drizzle(D1), Cloudflare Workers / Durable Objects(SQLite) / R2, APNs(ES256 JWT, WebCrypto), FCM HTTP v1.

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` 4.2, 4.3, 5.2, 5.3, 5.4, 5.10, 6장, 7.1. 실험 결과: `docs/research/2026-11-06-mvp2-experiments.md`.

## 계획 중 확인한 사실 (2026-11-10)

- **기기 식별**: 앱은 `apps/native/lib/device/install-identity.ts`에서 `installId`(UUID)와 `secret`(32바이트 base64url)을 만든다. 서버 쪽 등록은 아직 없다.
- **API**: `apps/server/src/app.ts`가 Hono 앱이고 oRPC는 `/rpc/*`에 있다. 잠금화면 버튼(Swift App Intent, Kotlin 수신기)과 iOS 네이티브 토큰 보고가 서버를 직접 불러야 하므로, 출퇴근 API는 oRPC가 아니라 평범한 JSON REST(`/v1/…`)로 만든다. **[설계 판단]**
- **지하철 도착판**: `realtimeStationArrival/ALL` 행에는 역별로 `btrainNo`, `barvlDt`(초), `recptnDt`, `arvlCd`, `ordkey`가 있다. `ordkey`의 3~5번째 글자가 "몇 정거장 전"이다(`01001성수0` → 1, `02006성수0` → 6). 수집기는 정규화하면서 이 행들을 버리므로, 세션이 보는 역의 행만 따로 남겨야 한다.
- **지하철 예측의 성격**(실험 6): `barvlDt`는 강남역 2호선에서 약 1분 이르다. 편향을 빼면 ±2분 95%를 넘는다. 8호선·경의중앙·공항철도·경춘·수인분당·신분당·경강·서해·신림·GTX-A와 1호선 대부분은 `barvlDt`가 0이라 시간표로 계산해야 한다. 받는 시점에 원천 정보는 이미 약 70초 지나 있다.
- **버스 도착판**: `http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?busRouteId=…`가 노선의 전 정류장을 한 번에 준다(6411: 117개 정류장, 180KB). 정류장마다 `staOrd`, `stId`, `stNm`, 다가오는 차량 둘의 `vehId1/2`, `traTime1/2`(초), `sectOrd1/2`(차량이 있는 순번), `isArrive1/2`, `isLast1/2`, `plainNo1/2`, 그리고 `term`(배차간격 분), `firstTm`, `lastTm`, `mkTm`이 있다. 같은 차량이 이어지는 여러 정류장의 `vehId1`로 나온다. 오퍼레이션 한도는 하루 1,000건이고 수집기가 쓰는 `getBusPosByRtid`와 따로 센다.
- **버스 예측의 정확도는 아직 모른다.** 실험 6의 버스 측정이 2026-11-11, 11-12에 있다. 이 계획은 공식 예측을 그대로 쓰고 출처·방법을 기록해 두는 데까지 만든다. 결과가 7.1에 못 미치면 보정이나 자체 예측은 후속 계획에서 `ArrivalMethod`를 하나 더하는 일이 된다.
- **푸시**(실험 2, 4, 5): Worker의 일반 `fetch`로 APNs에 직접 보낸다. push-to-start 토큰은 재설치·재부팅에도 같고, 업데이트 토큰은 Activity마다 새로 오며 시작 뒤 4초 안에 도착했다. 끝난 Activity의 토큰에도 APNs는 200을 준다. Android는 높은 우선순위 FCM 데이터 메시지로 끊김이 없었고, 강제 종료 중에 보낸 메시지는 나중에 순서가 섞여 도착했다.
- **Durable Object는 요청·alarm 없이 10초가 지나면 잠들고 메모리를 비운다**(4단계에서 이력을 잃은 원인). 실행기는 재시작해도 이어져야 하는 값을 전부 DO 저장소에 둔다.
- **공휴일**: `packages/realtime/src/holidays.ts`에 2027년까지의 고정 목록이 있다. 임시공휴일은 들어 있지 않다.
- **공휴일 API**(2026-11-10 활용신청 승인, 같은 `DATA_GO_KR_API_KEY`로 200 확인): `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?ServiceKey=…&solYear=2027&_type=json&numOfRows=100`. `solMonth`를 빼면 그 해 전체가 한 번에 온다(2027년 24건). 항목은 `locdate`(`20270209`, 숫자), `dateName`("대체공휴일(설날)"), `isHoliday`("Y"), `dateKind`("01")다. `response.body.items`는 여러 건이면 `{ item: [...] }`, 한 건이면 `{ item: {...} }`, 0건이면 빈 문자열 `""`이다. 임시공휴일은 지정 뒤 하루 안에 반영된다(활용가이드 v1.4, Google Drive `공공데이터포털 문서/한국천문연구원_천문우주정보_특일_정보제공_서비스`).

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/mvp2-server`, 브랜치 `feat/mvp2-commute-server`(develop에서 만듦). PR은 develop으로.
- 커밋 메시지와 PR 본문에 AI 서명이나 출처 표기(`Co-Authored-By`, 세션 URL 등)를 넣지 않는다.
- 커밋 전 `bunx ultracite fix`. 각 Task 끝에 저장소 루트에서 `bun test`와 `bun run check-types`가 통과해야 한다. 테스트는 소스 옆 `*.test.ts`.
- **서버에 주소, 좌표, 장소 이름을 저장하지 않는다**(5.2). 저장하는 것은 설치 ID, 비밀값 해시, 플랫폼, 푸시 토큰, 경로 구간(노선·정류장 ID와 이름, 방향, 도보 분), 예약(요일, 시각, 시간대), 세션 상태뿐이다. 정류장 이름은 공개된 교통 데이터라 저장해도 된다.
- **키와 비밀값을 남기지 않는다.** `DATA_GO_KR_API_KEY`, `APNS_KEY_P8`, `FCM_SERVICE_ACCOUNT_JSON`, 설치 비밀값, 푸시 토큰 전체는 로그·R2·응답 본문·오류 문구에 나오면 안 된다. 상류 URL은 `@Betro/realtime/upstream/urls`의 `redactKeys`를 거치고, 푸시 토큰은 앞 8자만 남긴다.
- **시간대는 데이터다**(5.10). `packages/commute`와 `apps/server/src/commute`에 `Asia/Seoul`, `+09:00`, `9 * 3600`을 직접 쓰지 않는다. 기본값은 `packages/commute/src/config.ts`의 `DEFAULT_TIMEZONE` 한 곳에만 둔다.
- **세션 로직은 출처를 모른다**(5.10). `packages/commute/src/session/*`은 `sources/types.ts`의 공통 형태만 import한다. `seoul-`로 시작하는 문자열이나 서울 API 필드 이름이 나오면 안 된다.
- **푸시에는 문장을 넣지 않는다**(5.10). 구조화된 값만 보내고 문장은 기기가 만든다. 노선 이름과 정류장 이름은 값이므로 넣는다.
- 한도와 간격은 코드에 박지 않고 `CommuteConfig`(환경 변수)로 둔다. 기본값: 세션 tick 30초, 버스 호출 간격 60초(탈 차량이 6분 안이면 30초), 하루 버스 도착 예산 900건, 시작 선행 10분, 대안 제안 최소 이득 3분, 종료 여유 10분, 세션 최대 3시간, 무전송 상한 110초, 원천 묵음 기준 150초.
- 상류는 타임아웃 10초, 재시도는 1초·2초 뒤 최대 2번, 재시도도 예산 1건이다(4단계와 같다). 401이나 게이트웨이 오류(초당 한도 23 제외)를 받으면 그 출처는 그날 멈춘다.
- 로컬 개발·테스트는 상류와 푸시 서버를 부르지 않는다. `UPSTREAM_MODE=fixture`와 `PUSH_MODE=log`가 기본이고, 실제 호출은 각각 `live`, `send`일 때만 한다.
- Durable Object 이름: 클래스 `CommuteRunner`, 바인딩 `COMMUTE`, 인스턴스 `commute-v1`, `locationHint: "apac"`. `Collector`는 그대로 둔다.
- 범위 밖: TAGO·GBIS 어댑터(경기·인천 연결, 별도 계획), 앱 화면(2-E), 네이티브 Live Activity·Live Update(2-F), 정적 데이터 확장(2-D), 예측 보정, 기기 위치 판단, 세션 수 제한.

## Review Focus

1. **자정과 요일 경계.** 나가는 시각이 00:05이고 선행이 10분이면 세션은 전날 23:55에 시작해야 하고, 요일과 공휴일은 나가는 날 기준으로 본다. 기대: 월요일 00:05 예약은 일요일 23:55에 시작하고, 일요일이 공휴일이어도 월요일이 아니면 건너뛰지 않는다. Task 3(`dueStarts`) 테스트로 고정.
2. **실행기 재시작.** DO가 잠들었다 깨어나거나 배포로 다시 떠도 같은 예약의 세션을 두 번 만들지 않고, 시작 푸시를 다시 보내지 않고, `seq`가 이어지고, APNs JWT를 새로 만들지 않는다. Task 9 테스트(같은 저장소로 만든 두 번째 `RunnerCore`)로 고정.
3. **토큰이 없거나 늦거나 죽은 경우.** push-to-start 토큰이 없는 기기, 시작 뒤 60초 안에 업데이트 토큰이 오지 않는 세션, `BadDeviceToken`·`Unregistered` 응답. 기대: 시작을 다시 보내 Activity를 둘 만들지 않고, 죽은 토큰은 지우고, 세션은 "갱신 불가"로 기록한다. Task 8, 9 테스트로 고정.
4. **원천이 멈춘 경우.** 도착판이 150초 넘게 새로 오지 않으면 시간표·배차간격 추정으로 바꾸고 `etaState: "estimated"`, `positionState: "stale"`로 보낸다. 값이 그대로여도 110초마다 한 번은 보낸다. 기대: 실시간인 척 멈춘 화면이 없다. Task 5, 7 테스트로 고정.
5. **남의 세션, 끝난 세션, 중복 입력.** 다른 설치의 비밀값으로 보낸 입력은 404, 끝난 세션의 입력은 409, "탔어요"를 두 번 눌러도 상태가 한 번만 바뀐다. 강제 종료 뒤 늦게 도착한 옛 메시지가 최신 값을 덮지 않도록 모든 값에 `seq`가 있다. Task 6, 10 테스트로 고정.

## 파일 구조

```
packages/commute/                     새 패키지(순수 로직)
  src/config.ts                       CommuteConfig, 기본값, DEFAULT_TIMEZONE
  src/refs.ts                         출처 구분 ID
  src/plan.ts                         경로·예약 형식과 zod 스키마
  src/calendar.ts                     시간대, 요일, 공휴일, 시작할 예약 찾기
  src/sources/types.ts                출처 공통 형태(도착판, 차량, 방법)
  src/sources/seoul-bus.ts            getArrInfoByRouteAll → 도착판
  src/sources/seoul-subway.ts         ALL 행 → 도착판, 시간표 보충
  src/sources/assemble.ts             구간의 출처를 보고 도착판을 고르는 유일한 곳
  src/session/estimate.ts             차량 선택, 경로의 목적지 도착 계산
  src/session/stage.ts                단계 기계와 사용자 입력
  src/session/content.ts              푸시 값, 대안 제안, 보낼지 판단
  src/push/apns.ts                    JWT, 요청, 응답 분류
  src/push/fcm.ts                     데이터 메시지 요청
  src/accuracy.ts                     예측·도착 기록과 세션 요약
  src/__fixtures__/                   상류 응답 표본
packages/db/src/schema/commute.ts     install, push_token, commute_plan, commute_session, holiday
apps/server/src/commute/
  auth.ts                             설치 인증
  routes.ts                           /v1 REST 라우트
  ports.ts                            실행기 포트
  runner-core.ts                      RunnerCore(포트만 쓴다, 테스트 대상)
  runner-do.ts                        Durable Object CommuteRunner
  cf-ports.ts                         D1, R2, 수집기, 상류, 푸시 구현
  client.ts                           Worker가 쓰는 실행기 클라이언트
apps/server/src/collector/            역 도착판 보관과 RPC 추가(Task 4)
```

---

### Task 1: 경로 형식과 출처 구분 ID

**Files:**
- Create: `packages/commute/package.json`, `tsconfig.json`(`packages/realtime`과 같은 구성, `check-types`는 `tsc -b`), `src/config.ts`, `src/refs.ts`, `src/plan.ts`
- Test: `packages/commute/src/refs.test.ts`, `src/plan.test.ts`

**Interfaces:**
- Produces:
  - `refs.ts`
    - `type SourceId = "seoul-bus" | "seoul-subway"`(나중에 `"tago"`, `"gbis"`가 더해진다)
    - `type LineRef = \`${SourceId}:${string}\``, `type StopRef = \`${SourceId}:${string}\``
    - `parseRef(ref: string): { source: SourceId; id: string }`(모르는 출처나 빈 id는 `Error`)
    - `lineRef(source: SourceId, id: string): LineRef`, `stopRef(source: SourceId, id: string): StopRef`
    - 버스 노선은 `seoul-bus:100100290`, 정류장은 `seoul-bus:119000011`. 지하철 노선은 `seoul-subway:line2`(`LineKey`), 역은 `seoul-subway:1002000222`.
  - `plan.ts`
    - `interface BusLeg { mode: "bus"; line: LineRef; lineName: string; board: { stop: StopRef; seq: number; name: string }; alight: { stop: StopRef; seq: number; name: string } }`
    - `interface SubwayLeg { mode: "subway"; line: LineRef; lineName: string; direction: "up" | "down"; board: { stop: StopRef; name: string }; alight: { stop: StopRef; name: string } }`
    - `type Leg = BusLeg | SubwayLeg`
    - `interface Route { rank: number; legs: Leg[]; walkMinutes: number[] }`. `rank` 0이 기본 경로, 1~3이 대안. `walkMinutes`는 길이가 `legs.length + 1`이다(집 → 첫 승차, 환승 도보들, 마지막 하차 → 목적지).
    - `interface Schedule { days: number[]; leaveMinute: number; timezone: string; includeHolidays: boolean; leadMinutes: number }`. `days`는 0(일)~6(토), `leaveMinute`는 그 시간대의 자정 기준 분.
    - `interface CommutePlan { planId: string; enabled: boolean; schedule: Schedule; routes: Route[] }`
    - `const commutePlanSchema: z.ZodType<CommutePlan>`, `parsePlan(input: unknown): { ok: true; plan: CommutePlan } | { ok: false; issues: string[] }`
  - `config.ts`: `interface CommuteConfig`와 `commuteConfig(env: Record<string, string | undefined>): CommuteConfig`. 필드와 기본값은 Global Constraints의 값 그대로다(`tickMs` 30000, `busPollMs` 60000, `busNearPollMs` 30000, `busNearWindowMs` 360000, `dailyBudgetBusArrival` 900, `suggestMinGainMs` 180000, `endGraceMs` 600000, `maxSessionMs` 10800000, `heartbeatMs` 110000, `staleAfterMs` 150000, `tokenWaitMs` 60000, `subwayEtaBiasSec: Record<string, number>` 기본 `{ line2: 60 }`). `DEFAULT_TIMEZONE = "Asia/Seoul"`, `DEFAULT_LEAD_MINUTES = 10`.

- [ ] **Step 1: 실패하는 테스트**
  - `refs`: `parseRef("seoul-bus:100100290")` → `{ source: "seoul-bus", id: "100100290" }`. `parseRef("tago:GGB1")`, `parseRef("seoul-bus:")`, `parseRef("100100290")`는 던진다.
  - `plan`, 통과: 버스 구간 하나짜리 기본 경로(`walkMinutes: [5, 3]`)와 예약 `{ days: [1,2,3,4,5], leaveMinute: 490, timezone: "Asia/Seoul", includeHolidays: false, leadMinutes: 10 }`.
  - `plan`, 거부(각각 `issues`에 경로가 담긴다): 경로 0개, `rank` 0이 없거나 둘, 경로 5개, 구간 0개나 5개, `walkMinutes` 길이가 `legs.length + 1`이 아님, 도보 61분이나 음수, `days`가 비었거나 7 포함이나 중복, `leaveMinute` 1440, `leadMinutes` 4나 31, `timezone: "Seoul"`(`Intl.DateTimeFormat`이 던지는 값), 버스 구간의 `alight.seq <= board.seq`, 구간의 `line`과 정류장의 출처가 다름, 지하철 구간의 승차역과 하차역이 같음, `planId`가 UUID가 아님, 모르는 필드에 `address`나 `lat`이 들어옴(엄격 모드로 거부).
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute` / Expected: FAIL
- [ ] **Step 3: 구현** — zod 객체는 모두 `.strict()`. 루트 `package.json`의 workspaces에는 `packages/*`가 이미 있다.
- [ ] **Step 4: 통과 확인** — Run: `bun test packages/commute && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): add route plan format and source-qualified ids`

---

### Task 2: DB 스키마와 설치·토큰·경로 API

**Files:**
- Create: `packages/db/src/schema/commute.ts`, 마이그레이션(`bun run db:generate` → `bun run db:d1-migrations`), `apps/server/src/commute/auth.ts`, `apps/server/src/commute/routes.ts`
- Modify: `packages/db/src/schema/index.ts`, `apps/server/src/app.ts`(API 호스트에 `/v1` 라우트 연결, CORS `allowHeaders`에 `X-Betro-Install` 추가)
- Test: `apps/server/src/commute/routes.test.ts`(`createTestDb()` libsql + Hono `app.request`)

**Interfaces:**
- Consumes: `parsePlan`, `CommutePlan`(Task 1)
- Produces:
  - 테이블(모든 시각은 UTC epoch ms 정수)
    - `install`: `id` text PK, `secret_hash` text, `platform` text(`"ios" | "android"`), `created_at`, `last_seen_at`
    - `push_token`: `id` 정수 PK, `install_id` FK(cascade), `kind` text(`"apns-start" | "apns-activity" | "fcm"`), `token` text, `env` text(`"sandbox" | "production"`), `activity_id` text(없으면 빈 문자열), `session_id` text(없으면 빈 문자열), `updated_at`. 유일 인덱스 `(install_id, kind, activity_id)`.
    - `commute_plan`: `id` text PK(`planId`), `install_id` FK(cascade), `enabled` 정수, `timezone` text, `start_minute` 정수(`(leaveMinute - leadMinutes + 1440) % 1440`), `plan_json` text(JSON 모드, `CommutePlan`), `updated_at`. 인덱스 `(enabled, timezone, start_minute)`.
    - `commute_session`: `id` text PK, `plan_id` text, `install_id` text, `service_date` text(나가는 날 `YYYY-MM-DD`), `status` text(`"active" | "ended"`), `started_at`, `ended_at` 널 허용, `end_reason` text 널 허용. 유일 인덱스 `(plan_id, service_date)`.
    - `holiday`: `country` text, `date` text, `name` text, `fetched_at`. PK `(country, date)`.
  - `auth.ts`
    - `sha256Hex(text: string): Promise<string>`
    - `interface PushTokenRow { activityId: string; env: "sandbox" | "production"; id: number; installId: string; kind: "apns-start" | "apns-activity" | "fcm"; sessionId: string; token: string; updatedAt: number }`
    - `authenticateInstall(db: Database, headers: Headers): Promise<{ installId: string } | null>`. `X-Betro-Install: <installId>`와 `Authorization: Bearer <secret>`를 읽어 `sha256Hex(secret)`을 저장된 해시와 길이가 같은 상수 시간 비교로 맞춘다. 맞으면 `last_seen_at`을 하루에 한 번만 갱신한다.
  - 라우트(본문과 응답은 JSON, 인증 실패는 401 `{ "error": "unauthorized" }`)
    - `POST /v1/installs` `{ installId, secretHash, platform }` → 201. 같은 `installId`에 같은 해시면 200, 다른 해시면 409(남의 ID를 가져갈 수 없게).
    - `PUT /v1/push-tokens`(인증) `{ kind, token, env, activityId?, sessionId? }` → 204. `(install, kind, activityId)`로 덮어쓴다.
    - `PUT /v1/commute/plans/:planId`(인증) 본문 `CommutePlan` → 204. 본문의 `planId`가 경로와 다르면 400, 스키마 위반은 400 `{ error: "invalid", issues }`, 다른 설치의 `planId`면 404. 설치당 경로는 최대 16개(넘으면 409).
    - `GET /v1/commute/plans`(인증) → `{ plans: CommutePlan[] }`
    - `DELETE /v1/commute/plans/:planId`(인증) → 204(없어도 204)
    - `DELETE /v1/installs/me`(인증) → 204. 토큰·경로·세션 기록까지 지운다.
  - **경로의 원본은 기기다.** iOS는 앱을 지워도 설치 ID가 남아 서버에만 경로가 남을 수 있다(5.2). 앱은 실행할 때 `GET /v1/commute/plans`로 받아 기기에 없는 `planId`를 `DELETE`한다(2-E가 만든다). 서버는 맞추는 일을 하지 않는다. **[설계 판단]**

- [ ] **Step 1: 실패하는 테스트**
  - 등록: 새 설치 201, 같은 값 다시 200, 다른 `secretHash` 409, `platform: "web"` 400.
  - 인증: 헤더 없음, 틀린 비밀값, 모르는 `installId` 모두 401이고 응답 본문이 서로 같다.
  - 토큰: 같은 `(kind, activityId)`를 두 번 올리면 행이 하나이고 토큰이 새 값이다. 저장된 값과 응답 어디에도 비밀값 원문이 없다.
  - 경로: 저장 후 조회하면 같은 객체, `enabled: false`로 다시 저장하면 `enabled`만 바뀜, `start_minute`이 `leaveMinute: 5, leadMinutes: 10`일 때 1435, 다른 설치가 같은 `planId`로 `PUT`하면 404이고 원본이 그대로다, 17번째 경로는 409.
  - 삭제: `DELETE /v1/installs/me` 뒤 같은 비밀값으로 401, 세 테이블에 그 설치의 행이 없다.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server/src/commute` / Expected: FAIL
- [ ] **Step 3: 구현** — 본문 검증은 zod `safeParse`. 새 의존성은 넣지 않는다.
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 5: 로컬 D1** — Run: `cd apps/server && bun run d1:migrate:local` / Expected: 새 마이그레이션 1개 적용, 오류 없음.
- [ ] **Step 6: 커밋** — `feat(server): add install, push token and commute plan APIs`

---

### Task 3: 시간대, 공휴일, 시작할 예약 찾기

**Files:**
- Create: `packages/commute/src/calendar.ts`
- Test: `packages/commute/src/calendar.test.ts`

**Interfaces:**
- Consumes: `Schedule`(Task 1)
- Produces:
  - `localParts(epochMs: number, timezone: string): { date: string; minute: number; weekday: number }`. `Intl.DateTimeFormat`으로 계산한다. `date`는 `YYYY-MM-DD`, `minute`은 자정 기준 분, `weekday`는 0(일)~6(토).
  - `localToEpochMs(date: string, minute: number, timezone: string): number`
  - `interface DueStart { leaveAt: number; serviceDate: string; startAt: number }`
  - `dueStart(schedule: Schedule, now: number, isHoliday: (date: string) => boolean): DueStart | null`. `now`가 `[startAt, startAt + 3분)` 안이면 그 실행을 돌려준다. `startAt = leaveAt - leadMinutes분`, `serviceDate`는 `leaveAt`의 현지 날짜다. 요일과 공휴일은 `serviceDate`로 판단한다. `includeHolidays`가 false이고 `isHoliday(serviceDate)`면 null.
  - `startMinutesToCheck(now: number, timezone: string): number[]`. 지금과 앞선 2분의 현지 분 3개(자정을 넘으면 0으로 돌아간다). 실행기가 `commute_plan.start_minute`으로 조회할 값이다.

- [ ] **Step 1: 실패하는 테스트**
  - `localParts(Date.UTC(2026, 10, 9, 15, 5), "Asia/Seoul")` → `{ date: "2026-11-10", minute: 5, weekday: 2 }`. `"America/New_York"`으로는 `{ date: "2026-11-09", minute: 605, weekday: 1 }`.
  - `localToEpochMs`와 `localParts`가 서로 되돌린다(두 시간대, 자정 직전·직후).
  - 평일 08:10, 선행 10분: 화요일 08:00:00에 `startAt`이 그 시각이고 `leaveAt`이 08:10, `serviceDate`가 그날. 07:59:59와 08:03:00에는 null. 토요일 08:00에는 null.
  - **자정 경계**: `days: [1]`(월), `leaveMinute: 5`, 선행 10분 → 일요일 23:55에 시작하고 `serviceDate`는 월요일. 월요일 23:55에는 null.
  - **공휴일**: `serviceDate`가 공휴일이면 null, `includeHolidays: true`면 시작. 위 자정 경계 예약에서 일요일만 공휴일이면 시작한다.
  - `startMinutesToCheck`: 현지 00:01에 `[1, 0, 1439]`.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute/src/calendar.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 시간대 문자열은 인자로만 받는다. 이 파일에 시간대 이름이나 오프셋 상수를 쓰지 않는다.
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): find due commute starts across midnight and holidays`

---

### Task 4: 출처 공통 형태와 서울 버스·지하철 도착판

**Files:**
- Create: `packages/commute/src/sources/types.ts`, `sources/seoul-bus.ts`, `sources/seoul-subway.ts`, `sources/assemble.ts`, 표본 `src/__fixtures__/arr-all-6411.json`, `arr-all-150.json`, `subway-board-gangnam.json`
- Modify: `apps/server/src/collector/core.ts`, `collector-state.ts`, `core-state.ts`, `durable-object.ts`, `client.ts`(역 도착판 보관과 RPC)
- Test: `packages/commute/src/sources/seoul-bus.test.ts`, `seoul-subway.test.ts`, `assemble.test.ts`, `apps/server/src/collector/core.test.ts`(추가)

**Interfaces:**
- Produces:
  - `types.ts`
    - `type ArrivalMethod = "official" | "official-corrected" | "timetable" | "headway" | "extrapolated"`
    - `interface Approaching { etaAt: number | null; method: ArrivalMethod | null; plate: string | null; lastOfDay: boolean; stopsAway: number | null; vehicleId: string }`
    - `interface StopBoard { approaching: Approaching[]; fetchedAt: number; headwayMs: number | null; passed: { at: number; vehicleId: string }[]; sourceAt: number }`. `approaching`은 가까운 순서. `passed`는 직전 도착판에는 다가오고 있었는데 지금은 그 정류장을 지난 차량이다.
    - `interface Progress { etaAt: number | null; method: ArrivalMethod | null; stopsAway: number | null }`
    - `interface TransitBoards { board(leg: Leg, at: "board" | "alight"): StopBoard | null; progress(leg: Leg, vehicleId: string): Progress | null; rideMs(leg: Leg, vehicleId: string | null): number | null }`. 세션 로직이 보는 유일한 창구다.
  - `seoul-bus.ts`
    - `parseRouteArrivals(json: unknown): { ok: true; fetchedHeaderCd: string; stops: RouteStopArrival[] } | { ok: false; headerCd: string | null }`
    - `interface RouteStopArrival { seq: number; stopId: string; vehicles: { etaSec: number; isArrived: boolean; lastOfDay: boolean; plate: string; seqNow: number; vehicleId: string }[]; headwayMin: number | null; madeAt: number }`
    - `busBoards(prev: RouteStopArrival[] | null, now: RouteStopArrival[], fetchedAt: number): { board(seq: number): StopBoard; progress(vehicleId: string, alightSeq: number): Progress | null; rideMs(vehicleId: string | null, boardSeq: number, alightSeq: number): number | null }`
    - `routeArrivalsUrl(key: string, busRouteId: string): string`
  - `seoul-subway.ts`
    - `interface StationRow { arvlCd: string; barvlSec: number; direction: "up" | "down"; ordkey: string; sourceAt: number; trainNo: string }`
    - `stationBoard(prev: StationRow[] | null, rows: StationRow[], direction: "up" | "down", biasSec: number, fetchedAt: number): StopBoard`
    - `fillFromTimetable(board: StopBoard, arrivals: { at: number; tripId: number }[]): StopBoard`. `etaAt`이 null인 열차에 `sourceAt` 뒤의 시간표 도착을 가까운 순서대로 하나씩 붙이고 `method`를 `"timetable"`로 둔다. `headwayMs`가 null이면 시간표의 이웃한 두 도착의 차로 채운다.
    - `interface TimetablePort { nextArrivals(line: string, direction: "up" | "down", statnId: string, fromMs: number, limit: number): Promise<{ at: number; tripId: number }[]>; rideMs(line: string, direction: "up" | "down", fromStatnId: string, toStatnId: string, atMs: number): Promise<number | null> }`
  - `assemble.ts`
    - `interface RawBoards { bus: Record<string, { fetchedAt: number; now: RouteStopArrival[]; prev: RouteStopArrival[] | null }>; subway: Record<string, { fetchedAt: number; prev: StationRow[] | null; rows: StationRow[] }>; timetable: { arrivals: Record<string, { at: number; tripId: number }[]>; rideMs: Record<string, number | null> } }`. `bus`의 키는 `busRouteId`, `subway`의 키는 `statnId`, `timetable`의 키는 `legKey(leg)`.
    - `legKey(leg: Leg): string`
    - `assembleBoards(raw: RawBoards, config: CommuteConfig): TransitBoards`. `parseRef(leg.line).source`로 갈라 버스는 `busBoards`, 지하철은 `stationBoard` + `fillFromTimetable`을 쓴다. 지하철의 `rideMs`는 `raw.timetable.rideMs`, `progress`는 하차역 도착판에서 그 열차를 찾는다. 출처 이름이 나오는 곳은 `sources/` 폴더뿐이다.
  - 수집기
    - `CollectorCore.watchStations(statnIds: string[], until: number): Promise<void>`: 세션이 보는 역을 등록한다. 만료 시각이 지난 역은 지운다.
    - `CollectorCore.stationRows(statnIds: string[]): Promise<Record<string, { fetchedAt: number; rows: StationRow[] }>>`
    - 수집기는 ALL 응답을 받을 때마다 등록된 역의 행만 `StationRow`로 줄여 저장소 키 `boards`에 둔다(DO가 잠들어도 남게). 방향은 `subway/normalize.ts`가 쓰는 변환을 그대로 쓴다.
    - `CollectorRpcClient`에 `watchStations`, `stationRows` 추가.

- [ ] **Step 1: 표본 받기** — `getArrInfoByRouteAll`을 6411(`100100290`)과 150(`100100029`)에 한 번씩 부르고(2건, 호출 수를 커밋 메시지에 적는다) 키를 지운 응답을 표본으로 둔다. 지하철 표본은 R2 `raw/subway-all/…`의 본문 하나에서 강남역(`1002000222`) 행만 남긴 연속 두 폴링이다.
- [ ] **Step 2: 실패하는 테스트**
  - 버스 파서: 6411 표본에서 정류장 117개, 순번 39의 `stopId`가 `119000011`, 차량 둘, `headwayMin`이 12. `headerCd`가 4면 `ok: true, stops: []`, 7이면 `ok: false, headerCd: "7"`, JSON이 아니면 `ok: false, headerCd: null`.
  - 버스 도착판: 순번 39에서 첫 차량의 `stopsAway`가 `39 - seqNow`, `etaAt`이 `madeAt + etaSec * 1000`, `method`가 `"official"`. `isArrived`나 `seqNow >= seq`인 차량은 `stopsAway` 0.
  - 버스 `passed`: 직전에는 순번 39의 첫 차량이던 A가 지금은 순번 39의 목록에 없고 순번 41의 첫 차량이면 `passed`에 A가 있고 `at`은 지금 `madeAt`.
  - 버스 `progress`: 탄 차량이 하차 정류장의 두 차량 안에 있으면 그 값(`official`). 없으면 그 차량이 `vehId1`로 나오는 가장 먼 정류장까지의 `etaSec`에 남은 정류장 수 × (지금까지의 정류장당 평균 초)를 더하고 `method`는 `"extrapolated"`. 차량이 어디에도 없으면 null.
  - 버스 `rideMs`: 차량을 주면 `progress`의 도착과 승차 정류장 도착의 차, 차량이 없으면 두 정류장에 지금 나온 첫 차량의 `etaSec` 차(음수면 null).
  - 지하철 도착판: `ordkey` `"01001성수0"`은 `stopsAway` 1, `"02006성수0"`은 6. `barvlSec` 240, `biasSec` 60이면 `etaAt = sourceAt + 300000`, `method`는 `"official-corrected"`. `biasSec` 0이면 `"official"`. `barvlSec`이 0이면 `etaAt: null, method: null`이고 `stopsAway`는 그대로 나온다(위치는 계속 보여 준다).
  - `fillFromTimetable`: `barvlSec`이 0인 열차 둘, 시간표 도착 08:14·08:18·08:22 → 08:14와 08:18이 붙고 `method`가 `"timetable"`, `headwayMs`가 240000. 시간표가 비었으면 그대로다.
  - `assembleBoards`: 버스 구간은 버스 도착판을, 지하철 구간은 지하철 도착판을 돌려준다. 그 노선·역의 자료가 `raw`에 없으면 null.
  - 지하철 방향: 다른 방향의 행은 빠진다. `passed`: 직전 폴링에 있던 열차가 지금 없으면 `passed`에 있고 `at`은 지금 `sourceAt`.
  - 수집기: 역을 등록하고 tick을 돌리면 `stationRows`가 그 역의 행을 돌려주고, 등록하지 않은 역은 키가 없다. 같은 저장소로 `CollectorCore`를 새로 만들어도 행이 남아 있다. 만료 시각이 지난 역은 다음 tick에 사라진다. 저장된 값에 키 원문이 없다.
- [ ] **Step 3: 실패 확인** — Run: `bun test packages/commute/src/sources apps/server/src/collector` / Expected: FAIL
- [ ] **Step 4: 구현**
- [ ] **Step 5: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS(4단계 테스트 포함)
- [ ] **Step 6: 커밋** — `feat(commute): add stop boards for Seoul bus and subway`

---

### Task 5: 차량 선택과 목적지 도착 계산

**Files:**
- Create: `packages/commute/src/session/estimate.ts`
- Test: `packages/commute/src/session/estimate.test.ts`(도착판은 손으로 만든 `TransitBoards` 가짜)

**Interfaces:**
- Consumes: `Route`, `Leg`(Task 1), `TransitBoards`, `StopBoard`, `Approaching`, `ArrivalMethod`(Task 4), `CommuteConfig`(Task 1)
- Produces:
  - `interface LegEstimate { alightEtaAt: number | null; boardEtaAt: number | null; etaState: "live" | "estimated"; method: ArrivalMethod | null; positionState: "live" | "stale" | "none"; stopsAway: number | null; vehicleId: string | null }`
  - `interface RouteEstimate { destinationEtaAt: number | null; legs: LegEstimate[]; rank: number }`
  - `selectVehicle(board: StopBoard, readyAt: number, skip: ReadonlySet<string>): Approaching | null`. `etaAt >= readyAt`인 첫 차량. `skip`에 든 차량은 건너뛴다. `etaAt`이 null인 차량은 고르지 않는다.
  - `estimateRoute(route: Route, boards: TransitBoards, input: { fixed: (string | null)[]; fromLeg?: number; now: number; readyAt: number; skip: ReadonlySet<string> }, config: CommuteConfig): RouteEstimate`
    - `fromLeg`(기본 0)는 지금 구간(Task 6의 `legIndex`)이다. `input.readyAt`은 `fromLeg` 구간의 `readyAt`이고, 그 뒤 구간 i의 `readyAt`은 앞 구간의 `alightEtaAt + walkMinutes[i]분`이다. **[검토 반영]** 앞 구간 차량이 하차 정류장에 닿으면 진행 정보의 도착 시각이 null이 되어 다음 구간을 고를 수 없었다. 그래서 환승 도보·대기 중에는 호출하는 쪽이 `fromLeg`와 그 구간의 `readyAt`을 준다.
    - `fromLeg` 앞 구간은 끝난 구간이다. 잡아 둔 차량만 보고(`readyAt` 없음, 새로 고르지 않음) 그 하차 시각을 다음 구간으로 잇지 않는다.
    - `fixed[i]`가 있으면 그 차량을 쓰고 고르지 않는다(이미 잡았거나 탄 차량).
    - 도착판이 없거나 `now - sourceAt > config.staleAfterMs`면 `positionState: "stale"`(도착판이 아예 없으면 `"none"`), `etaState: "estimated"`로 두고 `boardEtaAt`은 `readyAt + headwayMs / 2`(배차간격을 모르면 null), `method`는 `"headway"`다. 단 `fixed[i]`가 승차 도착판에 없고(탄 차량) `progress`가 도착 시각을 주면 `alightEtaAt`은 그 값, `boardEtaAt`은 null이다(상태·방법·`stopsAway: null`은 그대로). **[검토 반영]** 묵은 도착판에서 탄 차량에 배차간격 추정을 쓰면 하차 예정이 매 tick 미래로 밀려 Task 6 규칙 6이 걸리지 않는다.
    - 고를 차량이 도착판의 범위 밖이면(둘 다 `readyAt`보다 이르면) 마지막 차량의 `etaAt + headwayMs`를 쓰고 `etaState: "estimated"`, `method: "headway"`.
    - `etaState`는 도착판이 묵었거나 `method`가 `"timetable"`, `"headway"`, `"extrapolated"`면 `"estimated"`, 그 밖에는 `"live"`다.
    - `alightEtaAt = boardEtaAt + rideMs`. `rideMs`가 null이면 `alightEtaAt`도 null이다.
    - `destinationEtaAt`은 마지막 구간의 `alightEtaAt + walkMinutes[마지막]분`.

- [ ] **Step 1: 실패하는 테스트**
  - `selectVehicle`: 도착 08:13과 08:22 두 대, `readyAt` 08:15 → 08:22 차량. `readyAt` 08:13 → 08:13 차량(같으면 탈 수 있다). 첫 차량이 `skip`에 있으면 둘째. 둘 다 이르면 null.
  - 버스 구간 하나: `readyAt` 08:15, 승차 도착 08:17, 주행 14분, 마지막 도보 3분 → `destinationEtaAt` 08:34, `etaState: "live"`, `positionState: "live"`.
  - 환승(버스 → 지하철, 환승 도보 4분): 둘째 구간의 `readyAt`이 첫 구간 하차 + 4분이고, 그 뒤 첫 열차를 고른다.
  - `fixed`가 있으면 더 이른 차량이 있어도 그 차량을 쓴다. 그 차량이 도착판에서 사라졌으면 `vehicleId`는 유지하고 `boardEtaAt: null`.
  - **묵은 도착판**: `sourceAt`이 151초 전이고 배차간격 12분 → `positionState: "stale"`, `etaState: "estimated"`, `method: "headway"`, `boardEtaAt = readyAt + 6분`. 150초 전이면 `"live"`.
  - 도착판은 새것이지만 차량의 `method`가 `"timetable"` → `positionState: "live"`, `etaState: "estimated"`(위치는 실시간, 시각은 추정).
  - 도착판 없음 → `positionState: "none"`, `boardEtaAt: null`, `destinationEtaAt: null`.
  - 범위 밖: 두 대가 모두 `readyAt`보다 이르고 배차간격 10분 → 마지막 차량 + 10분, `method: "headway"`.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute/src/session/estimate.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 이 파일은 `sources/types.ts`와 `plan.ts`, `config.ts`만 import한다.
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): select vehicles and estimate destination arrival`

---

### Task 6: 단계 기계와 사용자 입력

**Files:**
- Create: `packages/commute/src/session/stage.ts`
- Test: `packages/commute/src/session/stage.test.ts`

**Interfaces:**
- Consumes: `RouteEstimate`, `estimateRoute`(Task 5), `CommutePlan`, `TransitBoards`, `CommuteConfig`
- Produces:
  - `type Stage = "walk" | "wait" | "ride" | "arrived" | "ended"`
  - `type EndReason = "arrived" | "user" | "timeout" | "no-token" | "plan-removed"`
  - `interface SessionState { boardedBy: ("time" | "user" | null)[]; endReason: EndReason | null; estimates: RouteEstimate[]; fixed: (string | null)[]; initialDestinationEtaAt: number | null; leaveAt: number; legIndex: number; passed: { lineName: string } | null; planId: string; readyAt: number | null; seq: number; sessionId: string; skip: string[]; stage: Stage; startedAt: number }`. JSON으로 그대로 저장한다.
    - `readyAt`(**[검토 반영]**, 규칙 2의 "넘긴 시각"을 담는 필드): 지금 구간의 승차 정류장에 있을 수 있는 시각이다. 첫 `advance`에서 `max(now, leaveAt) + walkMinutes[0]분`으로, 환승 구간은 내린 시각 + 환승 도보로 한 번 정하고 그 뒤로 바꾸지 않는다(매번 `now`로 다시 계산하면 `now >= readyAt`이 되지 않아 `wait`과 규칙 3의 탑승 판단이 걸리지 않는다). `estimateRoute`에는 `max(now, readyAt)`을 준다. `arrived`에서는 목적지에 닿는 시각(내린 시각 + 마지막 도보)이고 규칙 8의 종료 판단에 쓴다. `startSession`은 null로 둔다.
  - `startSession(plan: CommutePlan, due: { leaveAt: number; startAt: number }, sessionId: string): SessionState`
  - `type SessionInput = { kind: "boarded" } | { kind: "next" } | { kind: "end" }`
  - `advance(state: SessionState, plan: CommutePlan, boards: TransitBoards, now: number, config: CommuteConfig, input?: SessionInput): SessionState`. 순수 함수다. 규칙은 아래와 같다.
    1. `stage`가 `ended`면 그대로 돌려준다.
    2. 기본 경로의 지금 구간에서 `readyAt`을 정한다. 첫 구간은 `max(now, leaveAt) + walkMinutes[0]분`, 그 뒤 구간은 앞 구간 하차 + 환승 도보다. 기본 경로의 `estimateRoute`에는 `fromLeg: legIndex`와 이 `readyAt`을 준다(Task 5). 앞 구간 차량이 하차 정류장에 닿은 뒤에는 그 하차 시각을 진행 정보에서 다시 얻을 수 없고, `fromLeg` 앞 구간의 `alightEtaAt`도 null로 돌아올 수 있다. 그래서 규칙 6에서 구간을 넘길 때의 시각을 상태에 남겨 두고 `max(now, 넘긴 시각 + 환승 도보)`로 쓴다(이를 위해 `SessionState`에 필드가 하나 늘 수 있다). **[검토 반영]**
    3. 잡은 차량(`fixed[legIndex]`)이 승차 정류장의 `passed`에 있고 아직 타지 않았으면: `now >= readyAt`(정류장에 있을 시각)이면 탄 것으로 본다(`stage: "ride"`, `boardedBy: "time"`). 아니면 차량을 놓고(`fixed`를 null로, `skip`에 추가) `passed`에 그 노선 이름을 넣고 다시 고른다.
    4. `input.kind === "next"`: 탑승 전이면 잡은 차량을 `skip`에 넣고 다시 고른다. 탑승 뒤면 무시한다.
    5. `input.kind === "boarded"`: 탑승 전이면 `stage: "ride"`, `boardedBy: "user"`. 탈 차량은 승차 정류장을 3분 안에 지난 차량 중 가장 최근 것, 없으면 `stopsAway`가 0인 차량, 그것도 없으면 잡아 둔 차량이다. 이미 탑승 중이면 무시한다.
    6. `ride` 단계에서 탄 차량이 하차 정류장에 도착했거나(`progress.stopsAway === 0` 또는 하차 정류장의 `passed`) 하차 예정 시각이 지났으면 다음 구간으로 넘어간다(`legIndex + 1`, `stage: "walk"`). 마지막 구간이면 `stage: "arrived"`.
    7. 탑승 전 단계는 `now < readyAt`이면 `walk`, 아니면 `wait`.
    8. 종료: `input.kind === "end"`(`"user"`), `arrived`가 된 뒤 마지막 도보 + `endGraceMs`가 지남(`"arrived"`), `now - startedAt >= maxSessionMs`(`"timeout"`). 이때 `stage: "ended"`.
    9. 매번 모든 경로(기본과 대안)의 `estimates`를 다시 계산한다. 대안은 `fixed`와 `skip` 없이 `readyAt`만 같게 준다. 탑승 뒤에는 대안을 계산하지 않고 비운다.
    10. `initialDestinationEtaAt`은 기본 경로의 `destinationEtaAt`이 처음 null이 아닐 때 한 번 정한다.
    11. `seq`는 `advance`가 건드리지 않는다(보낼 때 Task 7이 올린다).

- [ ] **Step 1: 실패하는 테스트**
  - 시작 직후(나가기 10분 전): `stage: "walk"`, 첫 구간 차량은 `leaveAt + 도보` 뒤 첫 차량.
  - 늦게 나간 경우: `now`가 `leaveAt`을 5분 넘겼으면 `readyAt`이 `now + 도보`가 되어 더 늦은 차량을 고른다.
  - `readyAt`이 지나면 `wait`.
  - 잡은 차량이 `readyAt` 전에 지나감 → 다음 차량으로 바뀌고 `passed.lineName`이 그 노선, 지나간 차량은 `skip`에 있다. 다음 `advance`에서 `passed`는 null로 돌아간다.
  - 잡은 차량이 `readyAt` 뒤에 지나감 → `ride`, `boardedBy[0] === "time"`.
  - `"next"`: 다음 차량으로 바뀐다. 두 번 누르면 그다음 차량. 탑승 뒤에는 상태가 같다.
  - `"boarded"`: 2분 전에 지난 차량이 있으면 그 차량으로 `ride`, 없고 `stopsAway` 0인 차량이 있으면 그 차량. **두 번 눌러도 두 번째는 상태가 같다.**
  - 환승 경로: 첫 구간 하차 도착 → `legIndex: 1`, `stage: "walk"`, 환승 도보가 지나면 `wait`.
  - 마지막 구간 하차 → `arrived`, 마지막 도보 + 10분 뒤 `ended`(`"arrived"`).
  - `"end"` → 즉시 `ended`(`"user"`). **끝난 세션에 어떤 입력을 줘도 상태가 같다.**
  - 시작 후 3시간 → `ended`(`"timeout"`).
  - 탑승 뒤 `estimates`에는 기본 경로만 있다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute/src/session/stage.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): add the commute session stage machine`

---

### Task 7: 푸시 값, 대안 제안, 보낼지 판단

**Files:**
- Create: `packages/commute/src/session/content.ts`
- Modify: `docs/superpowers/specs/2026-11-05-mvp-design.md`(5.3 아래에 "푸시 값 v1" 절로 아래 형식을 옮겨 적는다. 2-F가 이 절을 기준으로 Swift·Kotlin 타입을 만든다)
- Test: `packages/commute/src/session/content.test.ts`

**Interfaces:**
- Consumes: `SessionState`(Task 6), `CommutePlan`, `CommuteConfig`
- Produces:
  - `interface ContentState`(JSON 필드 이름 그대로, 시각은 epoch **초**)

    ```ts
    interface ContentState {
      v: 1;
      seq: number;                 // 세션 안에서 보낼 때마다 1씩 오른다. 기기는 더 작은 값을 버린다
      sentAt: number;
      stage: "walk" | "wait" | "ride" | "arrived" | "ended";
      legIndex: number;
      legCount: number;
      mode: "bus" | "subway";
      lineName: string;
      stopName: string;            // walk·wait: 승차 정류장, ride·arrived: 하차 정류장
      stopsAway: number | null;
      etaEpoch: number | null;     // stopName에 도착하는 시각
      leaveEpoch: number | null;   // 첫 구간 walk 단계에서 나가는 시각. 그 밖에는 null
      passed: { lineName: string } | null;
      positionState: "live" | "stale" | "none";
      etaState: "live" | "estimated";
      delayMinutes: number;        // 처음 계산한 목적지 도착보다 늦어진 분(0 이상)
      destinationEtaEpoch: number | null;
      suggestion: { rank: number; mode: "bus" | "subway"; lineName: string; boardEtaEpoch: number; savesMinutes: number } | null;
    }
    ```
  - `buildContent(state: SessionState, plan: CommutePlan, now: number, config: CommuteConfig): ContentState`. `seq`는 `state.seq + 1`.
  - `suggestion` 규칙: 탑승 전(`walk`, `wait`)이고, 대안 중 `destinationEtaAt`이 기본 경로보다 `suggestMinGainMs` 이상 빠른 것 가운데 가장 빠른 것. 기본 경로나 그 대안의 `destinationEtaAt`이 null이거나 대안의 첫 구간 `etaState`가 `"estimated"`면 제안하지 않는다(확신이 없을 때 단정하지 않는다). `mode`와 `lineName`은 그 대안의 첫 구간 것이다(기기가 수단에 맞는 문구를 고른다).
  - `type SendDecision = { send: false } | { send: true; priority: 5 | 10; reason: "change" | "stage" | "heartbeat" }`
  - `decideSend(prev: ContentState | null, next: ContentState, lastSentAt: number | null, now: number, config: CommuteConfig): SendDecision`
    - `prev`가 null이면 `{ send: true, priority: 10, reason: "stage" }`.
    - `stage`, `legIndex`, `lineName`, `passed` 유무, `suggestion`의 유무·`rank`가 바뀌면 우선순위 10, `reason: "stage"`.
    - `stopsAway`, `etaEpoch`의 분(60으로 나눈 몫), `positionState`, `etaState`, `delayMinutes`, `suggestion.savesMinutes`, `destinationEtaEpoch`의 분이 바뀌면 우선순위 5, `reason: "change"`.
    - 바뀐 것이 없어도 `now - lastSentAt >= config.heartbeatMs`면 우선순위 5, `reason: "heartbeat"`.
  - `activityAttributes(state: SessionState): { planId: string; sessionId: string }`(iOS 시작 푸시의 `attributes`)

- [ ] **Step 1: 실패하는 테스트**
  - `walk` 단계 첫 구간: `stopName`이 승차 정류장 이름, `leaveEpoch`가 나가는 시각, `etaEpoch`가 승차 도착. `ride`에서는 `stopName`이 하차 정류장, `leaveEpoch: null`, `stopsAway`가 하차까지 남은 정거장.
  - `delayMinutes`: 처음 08:34, 지금 08:39 → 5. 더 일러지면 0.
  - 제안: 기본 08:40, 대안 08:34(6분 이득) → `{ rank: 1, savesMinutes: 6 }`이고 `mode`가 대안 첫 구간의 수단이다. 대안 08:38(2분) → null. 대안이 둘이면 더 빠른 쪽. `ride`에서는 null. 대안 첫 구간이 `"estimated"`면 null.
  - `decideSend`: 정거장 수만 바뀜 → 5/`change`. 단계가 바뀜 → 10/`stage`. 초만 바뀌고 분이 같음 → 보내지 않음. **값이 같아도 110초가 지나면** 5/`heartbeat`, 109초면 보내지 않음.
  - 직렬화한 `ContentState`가 4KB(APNs 한도)의 절반보다 작다. 값 어디에도 한글 조사나 문장이 없다(`lineName`, `stopName` 제외한 문자열 값이 정해진 영어 낱말뿐이다).
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute/src/session/content.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): build push content and decide when to send`

---

### Task 8: APNs와 FCM 요청

**Files:**
- Create: `packages/commute/src/push/apns.ts`, `push/fcm.ts`
- Test: `packages/commute/src/push/apns.test.ts`, `fcm.test.ts`

**Interfaces:**
- Consumes: `ContentState`(Task 7)
- Produces:
  - `apns.ts`
    - `APNS_JWT_MAX_AGE_MS = 3_000_000`(50분)
    - `apnsJwt(p8Pem: string, keyId: string, teamId: string, issuedAtSec: number): Promise<string>`(ES256, WebCrypto)
    - `interface ApnsJwtCache { issuedAt: number; token: string }`, `reusableJwt(cache: ApnsJwtCache | undefined, now: number): string | null`
    - `apnsStartRequest(input: { attributes: { planId: string; sessionId: string }; env: "sandbox" | "production"; jwt: string; now: number; state: ContentState; token: string; topic: string }): Request`. 헤더는 `apns-push-type: liveactivity`, `apns-topic: <topic>.push-type.liveactivity`, `apns-priority: 10`. 본문은 `{ aps: { timestamp, event: "start", "attributes-type": "CommuteActivityAttributes", attributes, "content-state": state, alert: { title: { "loc-key": "commute.start.title" }, body: { "loc-key": "commute.start.body" } } } }`. 알림 문구는 기기의 문자열 리소스 키다.
    - `apnsUpdateRequest(input: { env; jwt; now; priority: 5 | 10; staleAt: number; state: ContentState; token: string; topic: string }): Request`(`event: "update"`, `"stale-date": staleAt`)
    - `apnsEndRequest(input: { env; jwt; now; state: ContentState; token: string; topic: string }): Request`(`event: "end"`, `"dismissal-date": now`). 단위: `now`와 `staleAt`은 밀리초이고, 요청 본문의 `timestamp`·`dismissal-date`·`stale-date`는 함수 안에서 epoch 초로 바꾼다.
    - 호스트는 `env`가 `"sandbox"`면 `api.sandbox.push.apple.com`, 아니면 `api.push.apple.com`.
    - `type PushOutcome = "ok" | "token-dead" | "jwt-expired" | "config" | "retry"`
    - `classifyApns(status: number, reason: string | null): PushOutcome`. 200 → `ok`. 400 `BadDeviceToken`·410 `Unregistered`·410 `ExpiredToken` → `token-dead`. 403 `ExpiredProviderToken`·`InvalidProviderToken` → `jwt-expired`. 400 `TopicDisallowed`와 그 밖의 400·403 → `config`. 429·5xx → `retry`.
  - `fcm.ts`
    - `FCM_TTL_SECONDS = 120`
    - `fcmCommuteRequest(input: { accessToken: string; event: "start" | "update" | "end"; planId: string; projectId: string; sessionId: string; state: ContentState; token: string }): Request`. 본문은 `{ message: { token, android: { priority: "HIGH", ttl: "120s", collapse_key: sessionId }, data: { type: "commute", event, planId, sessionId, state: JSON.stringify(state) } } }`. `notification` 블록은 넣지 않는다(데이터 메시지만).
    - `classifyFcm(status: number, errorStatus: string | null): PushOutcome`. 200 → `ok`. 404 `UNREGISTERED`·400 `INVALID_ARGUMENT` → `token-dead`. 401 → `jwt-expired`. 403 → `config`. 429·5xx → `retry`.
  - OAuth 토큰은 `@Betro/realtime/alerts`의 `fcmAccessTokenRequest`를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트**
  - JWT: 테스트 안에서 P-256 키쌍을 만들어 서명하고, 헤더가 `{ alg: "ES256", kid }`, 본문이 `{ iss: teamId, iat }`, 서명이 공개키로 검증된다.
  - `reusableJwt`: 49분 된 것은 그대로, 50분 된 것과 없는 것은 null.
  - 시작 요청: URL이 `https://api.sandbox.push.apple.com/3/device/<token>`, 헤더 세 개가 위 값, 본문의 `content-state`가 넘긴 `state`와 같다. `env: "production"`이면 호스트가 바뀐다.
  - 갱신 요청: `apns-priority`가 넘긴 값, `stale-date`가 있다. 종료 요청: `dismissal-date`가 `now`.
  - `classifyApns`: 위 표의 각 줄. **sandbox 토큰을 운영 호스트로 보냈을 때 오는 400 `BadDeviceToken`도 `token-dead`다**(그래서 토큰마다 `env`를 저장해 맞는 호스트로만 보낸다 — Task 9가 지킨다).
  - FCM: `ttl`이 `"120s"`, `collapse_key`가 세션 ID, `data`의 모든 값이 문자열, `notification` 키가 없다.
  - 요청 객체의 URL·헤더·본문을 문자열로 합쳐도 p8 원문이 없다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute/src/push` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): build APNs and FCM requests for commute pushes`

---

### Task 9: 세션 실행기

**Files:**
- Create: `apps/server/src/commute/ports.ts`, `runner-core.ts`, `runner-do.ts`, `cf-ports.ts`, `client.ts`
- Modify: `apps/server/src/index.ts`(`CommuteRunner` export, cron에서 `commuteClient(env).healthCheck()`), `wrangler.jsonc`(바인딩 `COMMUTE`, 마이그레이션 태그 `v2`에 `new_sqlite_classes: ["CommuteRunner"]`, vars `PUSH_MODE`, `APNS_KEY_ID: "HFSD7YXX9N"`, `APNS_TEAM_ID: "5JKMP6D4C5"`, `APNS_TOPIC: "com.cmu02.betro"`), `worker-env.ts`, `.dev.vars.example`
- Test: `apps/server/src/commute/runner-core.test.ts`(포트는 모두 메모리 가짜, 시계는 수동)

**Interfaces:**
- Consumes: Task 1~8 전부, `CollectorRpcClient.watchStations`·`stationRows`(Task 4)
- Produces:
  - `ports.ts`
    - `interface PlanStore { duePlans(timezone: string, startMinutes: number[]): Promise<{ installId: string; plan: CommutePlan }[]>; getPlan(planId: string): Promise<{ installId: string; plan: CommutePlan } | null>; isHoliday(country: string, date: string): Promise<boolean>; openSession(row: { id: string; installId: string; planId: string; serviceDate: string; startedAt: number }): Promise<boolean>; closeSession(id: string, endedAt: number, reason: EndReason): Promise<void> }`. `openSession`은 `(plan_id, service_date)`가 이미 있으면 false다.
    - `interface TokenStore { tokens(installId: string): Promise<PushTokenRow[]>; remove(id: number): Promise<void> }`
    - `interface PushSender { send(request: Request): Promise<{ reason: string | null; status: number }> }`
    - `interface RunnerStore { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>; list<T>(prefix: string): Promise<Map<string, T>> }`
    - `interface RunnerPorts { boards: BoardSource; clock: () => number; config: CommuteConfig; log: (line: string) => void; plans: PlanStore; push: PushSender; secrets: { apnsKeyId: string; apnsP8: string; apnsTeamId: string; apnsTopic: string; fcmServiceAccountJson: string }; store: RunnerStore; timetable: TimetablePort; timezones: string[]; tokens: TokenStore }`
    - `interface BoardSource { busRoute(busRouteId: string): Promise<RouteStopArrival[] | null>; stations(statnIds: string[]): Promise<Record<string, { fetchedAt: number; rows: StationRow[] }>>; watch(statnIds: string[], until: number): Promise<void> }`
  - `runner-core.ts`
    - `class RunnerCore { constructor(ports: RunnerPorts); tick(): Promise<{ nextAlarmAt: number }>; input(installId: string, sessionId: string, input: SessionInput): Promise<"ok" | "not-found" | "ended">; activeSession(installId: string): Promise<{ content: ContentState; planId: string; sessionId: string } | null>; ack(installId: string, sessionId: string, at: number): Promise<"ok" | "not-found"> }`
    - 저장소 키: `session:<id>`(`{ dueAt, installId, lastContent, lastSentAt, platform, shownAt, state, timetable, timetableAt, tokenAt, tokenWaitUntil, updatable }`), `apnsJwt`, `fcmAccess`(`{ expiresAt, token }`), `budget:<날짜>`, `busRoute:<id>`(직전 응답과 받은 시각), `stopped:<날짜>`.
  - `client.ts`: `commuteClient(env): { healthCheck(): Promise<void>; input(…); activeSession(…); ack(…) }`
  - 라우트(Task 2의 `routes.ts`에 추가, 모두 인증)
    - `POST /v1/commute/sessions/:sessionId/input` `{ kind: "boarded" | "next" | "end" }` → 204. 남의 세션이나 없는 세션은 404, 끝난 세션은 409.
    - `POST /v1/commute/sessions/:sessionId/ack` `{ shownAt }` → 204(기기가 처음 그린 시각, 자동 시작 ±1분 판정용)
    - `GET /v1/commute/sessions/active` → `{ session: { sessionId, planId, content } | null }`(17 출퇴근 안내 화면용)
- `tick` 순서
  1. 세션이 하나도 없고 다음 확인까지 남았으면 다음 분 경계로 alarm을 건다. 세션이 있으면 `now + tickMs`.
  2. **예약 확인**(분마다): `timezones`마다 `startMinutesToCheck` → `duePlans` → `dueStart`(공휴일은 `isHoliday("KR", date)`) → `openSession`이 true인 것만 `startSession`하고 저장한다.
  3. 세션이 보는 역을 `boards.watch`에 등록하고(만료는 `now + 5분`), 지하철 행과 버스 노선 응답을 모은다. 지하철 구간의 시간표(`nextArrivals` 6개, `rideMs`)는 세션 시작 때와 그 뒤 10분마다 받아 세션 항목에 둔다. 모은 것을 `assembleBoards`로 묶는다. 버스 노선은 그 노선을 보는 세션 중 탈 차량이 `busNearWindowMs` 안인 탑승 전 세션이 있으면 `busNearPollMs`, 아니면 `busPollMs`가 지났을 때만 부른다. 호출 전에 하루 예산을 확인하고 쓴다.
  4. 세션마다 경로를 다시 읽는다(`getPlan`). 지워졌거나 `enabled: false`면 `plan-removed`로 끝낸다. 아니면 `advance` → `buildContent` → `decideSend`.
  5. **시작**: 처음 보내는 세션은 iOS면 `apns-start` 토큰으로 시작 요청, Android면 FCM `event: "start"`. 시작 토큰이 없으면 `no-token`으로 닫는다.
  6. **갱신**: iOS는 그 세션의 `apns-activity` 토큰(`session_id`가 같은 것)이 있어야 보낸다. 없으면 `tokenWaitUntil`(시작 + `tokenWaitMs`)까지 기다리고, 지나면 `updatable: false`로 기록하고 **시작을 다시 보내지 않는다.**
  7. **종료**: `stage`가 `ended`가 되면 종료 요청을 보내고 `closeSession`, 저장소에서 세션과 그 세션의 `apns-activity` 토큰을 지운다.
  8. 응답 분류: `token-dead` → 토큰 삭제. 죽은 것이 FCM 토큰이면 그 설치를 통째로 지운다(Android는 앱을 지우면 설치 ID가 사라져 서버 등록이 고아가 된다, 5.2). iOS는 재설치해도 설치 ID가 이어지므로 토큰만 지운다. `jwt-expired` → JWT를 새로 만들어 한 번만 다시 보낸다. `config` → 로그만. `retry` → 다음 tick에 맡긴다(같은 tick에서 다시 보내지 않는다).
  9. 보냈으면 `state.seq`를 올리고 `lastContent`, `lastSentAt`을 저장한다. **모든 변경은 tick이 끝나기 전에 저장소에 쓴다.**

- [ ] **Step 1: 실패하는 테스트**
  - 예약 시각이 되면 세션 하나가 생기고 시작 요청이 한 번 나간다(iOS는 APNs 시작, Android는 FCM start).
  - **같은 분에 tick이 두 번 돌아도, 같은 저장소로 `RunnerCore`를 새로 만들어 돌려도** 세션과 시작 요청은 하나다. 새 인스턴스의 다음 갱신은 `seq`가 이어지고, APNs JWT는 저장된 것을 다시 쓴다(서명 호출 1회).
  - 공휴일이면 세션이 없다. `includeHolidays: true`면 있다.
  - iOS: 업데이트 토큰이 오기 전 tick에서는 갱신을 보내지 않는다. 토큰이 오면 다음 tick에 보낸다. **60초가 지나도 안 오면 `updatable: false`이고 시작 요청은 여전히 한 번이다.**
  - `BadDeviceToken` → 그 토큰 행이 지워진다. FCM `UNREGISTERED` → 그 설치의 토큰·경로·설치 행이 모두 지워진다.
  - 세션 도중 경로를 지우면 다음 tick에 종료 요청이 나가고 `closeSession("plan-removed")`. `ExpiredProviderToken` → JWT를 새로 만들어 같은 tick에 한 번 다시 보낸다.
  - sandbox 토큰은 sandbox 호스트로, production 토큰은 운영 호스트로 나간다.
  - **도착판이 멈춤**: 가짜 `boards`가 같은 `sourceAt`을 계속 주면 151초 뒤 보낸 값의 `etaState`가 `"estimated"`, `positionState`가 `"stale"`이다. 값이 그대로인 동안에도 전송 간격이 120초를 넘지 않는다.
  - 버스 호출: 탈 차량이 10분 뒤면 60초에 한 번, 5분 뒤면 30초에 한 번. 같은 노선을 보는 세션이 둘이어도 호출은 한 번. 하루 예산을 다 쓰면 부르지 않고 `"headway"` 추정으로 간다.
  - 상류가 401 → 그날 버스 호출을 멈추고 세션은 추정으로 계속 간다.
  - 입력: 다른 `installId` → `not-found`, 끝난 세션 → `ended`, `"end"` → 종료 요청이 나가고 `closeSession("user")`.
  - 세션 종료 뒤 그 세션의 저장소 키와 `apns-activity` 토큰이 없다.
  - 기록된 모든 로그 줄에 API 키, p8, 설치 비밀값, 푸시 토큰 전체가 없다(가짜 포트가 키가 든 오류를 던져도).
  - `PUSH_MODE=log`용 `PushSender`는 요청을 보내지 않고 200을 돌려준다.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server/src/commute` / Expected: FAIL
- [ ] **Step 3: 구현** — `runner-do.ts`와 `cf-ports.ts`는 `cloudflare:workers`를 쓰므로 bun 테스트에서 import하지 않는다. DO의 `alarm()`은 4단계 `Collector`와 같은 모양이다(`tick` 실패 시 60초 뒤 재시도, alarm은 최소 1초 뒤).
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 5: 로컬 확인(상류·푸시 호출 없음)** — `cd apps/server && bun run dev`. 설치 등록 → 토큰 등록 → 2분 뒤 시작하는 경로 등록을 `curl`로 하고, 로그에 `commute start session=…`과 `push (log) start`가 2분 안에 찍히는지 본다. `GET /v1/commute/sessions/active`가 `content`를 돌려준다.
- [ ] **Step 6: 커밋** — `feat(server): run commute sessions in a Durable Object`

---

### Task 10: 공휴일 받아 오기

**Files:**
- Create: `apps/server/src/commute/holidays.ts`
- Modify: `apps/server/src/index.ts`(cron), `cf-ports.ts`(`isHoliday`)
- Test: `apps/server/src/commute/holidays.test.ts`

**Interfaces:**
- Produces:
  - `parseRestDays(json: string): { date: string; name: string }[] | null`(`getRestDeInfo`의 JSON 응답. `isHoliday`가 `"Y"`인 항목만, `locdate` `20270209` → `"2027-02-09"`. `resultCode`가 `"00"`이 아니거나 JSON이 아니면 null)
  - `restDaysUrl(key: string, year: number): string`(`_type=json`, `numOfRows=100`, `solMonth` 없음)
  - `refreshHolidays(deps: { db: Database; fetch: Upstream; key: string; now: number; timezone: string }): Promise<{ fetched: number } | { error: string }>`. 올해와 내년을 받아(2건) `holiday`의 그 두 해 `country: "KR"` 행을 통째로 바꾼다(취소된 임시공휴일이 남지 않게). 한 해라도 실패하면 아무것도 바꾸지 않는다. `Upstream`은 `apps/server/src/collector/ports.ts`의 것이다.
  - `isHoliday(country, date)`: `holiday` 테이블에 있거나 `@Betro/realtime/holidays`의 고정 목록에 있으면 true(받아 오기가 한 번도 성공하지 않아도 고정 목록으로 동작한다).
  - cron은 5분마다 돌지만 `refreshHolidays`는 마지막 성공에서 24시간이 지났을 때만 부른다(D1 `holiday.fetched_at`의 최댓값으로 판단).

- [ ] **Step 1: 표본 받기** — 2027년 전체(24건), 2026년 12월(`solMonth=12`, 1건), 2026년 11월(0건)을 한 번씩 받아(3건) 키를 지우고 `apps/server/src/commute/__fixtures__/rest-days-{2027,2026-12,2026-11}.json`으로 둔다. Worker secret `DATA_GO_KR_API_KEY`는 이미 있다.
- [ ] **Step 2: 실패하는 테스트**
  - 2027년 표본에서 24건이 나오고 `2027-02-09`의 이름이 "대체공휴일(설날)"이다. 한 건 표본(`item`이 객체)에서 1건, 0건 표본(`items`가 `""`)에서 빈 배열. `isHoliday`가 `"N"`인 항목을 섞으면 빠진다. `resultCode: "30"` 응답과 XML 오류 본문은 null.
  - `refreshHolidays`: 성공하면 두 해 치가 들어가고, 그 해에 있던 옛 행 중 응답에 없는 것은 지워진다. 둘째 해에서 실패하면 `{ error }`이고 기존 행이 그대로다. 오류 문구에 키가 없다.
  - `isHoliday`: 테이블에만 있는 임시공휴일은 true, 고정 목록에만 있는 날도 true, 둘 다 없으면 false.
  - 23시간 전에 받았으면 다시 받지 않는다.
- [ ] **Step 3: 실패 확인** — Run: `bun test apps/server/src/commute/holidays.test.ts` / Expected: FAIL
- [ ] **Step 4: 구현**
- [ ] **Step 5: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 6: 커밋** — `feat(server): refresh public holidays daily`

---

### Task 11: 예측 기록과 정확도 요약

**Files:**
- Create: `packages/commute/src/accuracy.ts`
- Modify: `apps/server/src/commute/runner-core.ts`, `ports.ts`(`RunnerPorts`에 `records: RecordStore`, `blobs: CommuteBlobs` 추가), `cf-ports.ts`, `apps/server/src/index.ts`(cron)
- Test: `packages/commute/src/accuracy.test.ts`, `apps/server/src/commute/runner-core.test.ts`(추가)

**Interfaces:**
- Consumes: `SessionState`, `RouteEstimate`, `StopBoard`, `ContentState`
- Produces:
  - `type AccuracyRecord =`
    - `{ kind: "prediction"; at: number; sessionId: string; planId: string; rank: number; legIndex: number; line: LineRef; stop: StopRef; direction: string | null; vehicleId: string; etaAt: number; method: ArrivalMethod; positionState: string; etaState: string; stopsAway: number | null; sourceAt: number; weekday: number; localMinute: number }`
    - `| { kind: "arrival"; sessionId: string; line: LineRef; stop: StopRef; vehicleId: string; low: number; high: number }`(실제 도착은 `low`와 `high` 사이)
    - `| { kind: "input"; at: number; sessionId: string; input: "boarded" | "next" | "end"; vehicleId: string | null }`
    - `| { kind: "suggestion"; at: number; sessionId: string; primary: { vehicleId: string; alightStop: StopRef; destinationEtaAt: number }; alternative: { rank: number; vehicleId: string; alightStop: StopRef; destinationEtaAt: number } }`
    - `| { kind: "start"; sessionId: string; dueAt: number; sentAt: number; shownAt: number | null; tokenAt: number | null }`
    - `| { kind: "send"; at: number; sessionId: string; seq: number; reason: string; outcome: string }`
  - `recordsOf(prev: SessionState | null, next: SessionState, boards: TransitBoards, plan: CommutePlan, now: number, timezone: string): AccuracyRecord[]`. tick마다 기본 경로와 대안의 첫 구간 예측, 새로 보인 `passed`의 `arrival`을 낸다.
  - `interface SessionSummary { sessionId: string; planId: string; startDelayMs: number | null; maxSendGapMs: number; endReason: EndReason; predictions: { line: LineRef; stop: StopRef; method: ArrivalMethod; errorMs: number; halfWidthMs: number; leadMs: number }[]; suggestions: { verdict: "faster" | "slower" | "unknown"; gainMs: number | null }[] }`
  - `summarize(records: AccuracyRecord[]): SessionSummary`. 예측 평가는 실험 6과 같다: `arrival`마다 가운데 값 5분 전에서 ±60초 안의 예측 중 5분에 가장 가까운 것 하나, 오차는 `etaAt - 가운데 값`. 제안 판정은 두 차량의 하차 `arrival`이 모두 있으면 도보를 더해 비교하고, 하나라도 없으면 `"unknown"`.
  - `interface RecordStore { append(sessionId: string, records: AccuracyRecord[]): Promise<void>; drain(sessionId: string): Promise<AccuracyRecord[]> }`. DO SQLite 표에 쓴다(메모리에 두지 않는다).
  - 세션이 끝나면 `drain` → `summarize` → R2 `commute/records/<서비스일>/<세션ID>.ndjson.gz`와 `commute/summaries/<서비스일>/<세션ID>.json`을 쓴다.
  - `interface CommuteBlobs { get(key: string): Promise<string | null>; list(prefix: string): Promise<string[]>; put(key: string, body: Uint8Array, contentType: string): Promise<void> }`
  - `interface DailyCommuteReport { date: string; sessions: number; starts: { late: number; onTime: number; unknown: number }; maxSendGapMs: number; endReasons: Record<string, number>; accuracy: Record<string, { n: number; within60: number; within120: number; medianErrorMs: number }>; suggestions: { faster: number; slower: number; unknown: number } }`. `accuracy`의 키는 `<출처>|<방법>`(예: `seoul-bus|official`). `onTime`은 `startDelayMs`가 ±60초 안이다.
  - `dailyReport(date: string, summaries: SessionSummary[]): DailyCommuteReport`
  - `RunnerCore.writeDailyReport(date: string): Promise<boolean>`. `commute/summaries/<date>/`를 읽어 `commute/reports/<date>.json`을 쓴다. cron이 부르고, 실행기는 마지막으로 쓴 날짜를 저장해 하루에 한 번만 쓴다(4단계 일일 보고서와 같은 방식).
  - 제안이 나간 세션은 종료 뒤에도 두 차량이 하차 정류장에 도착하거나 30분이 지날 때까지 그 두 노선의 도착판만 계속 보고 `arrival`을 남긴다(푸시는 보내지 않는다).
  - **[구현 반영]** `AccuracyRecord`에 `{ kind: "end"; at; sessionId; planId; reason: EndReason }`를 더했다(요약의 `planId`·`endReason`이 나올 곳이 없었다). `suggestion`의 `primary`·`alternative`에는 `afterAlightMs`(하차 예정 → 목적지 도착 예상, 구간이 하나면 마지막 도보)를 더해 "도보를 더해 비교"를 기록만으로 한다. `StopBoard`에 선택 필드 `prevSourceAt`(직전 도착판의 `sourceAt`)을 더해 `arrival.low`로 쓴다. 따라가기는 저장소 키 `follow:<세션ID>`, 마지막 보고서 날짜는 `commuteReportDate`, cron은 `commuteReportDate(now, DEFAULT_TIMEZONE)`(서비스일 D를 D+1 04:00부터)로 `writeDailyReport`를 부른다.

- [ ] **Step 1: 실패하는 테스트**
  - `recordsOf`: tick 하나에서 기본 경로 첫 구간 예측 1건, 대안 2개면 3건. 차량이 정류장을 지난 tick에서 `arrival`의 `low`가 직전 도착판의 `sourceAt`, `high`가 지금 `sourceAt`.
  - `summarize`: 실제 도착 가운데 값 08:15:00, 08:10:10에 낸 예측 08:14:20 → `errorMs` −40000, `leadMs` 290000. 5분 전 ±60초 안에 예측이 없으면 그 도착은 빠진다.
  - `startDelayMs`는 `shownAt - dueAt`(`shownAt`이 없으면 `tokenAt`, 둘 다 없으면 null). `maxSendGapMs`는 `ok`인 `send` 사이의 최대 간격.
  - 제안 판정: 대안 차량이 4분 먼저 하차 → `"faster"`, `gainMs` 240000. 기본 쪽 `arrival`이 없으면 `"unknown"`.
  - `dailyReport`: 요약 3개(제시간 2, 80초 늦음 1) → `starts: { onTime: 2, late: 1, unknown: 0 }`. 오차 30초·90초·150초 → `within60` 1, `within120` 2, `n` 3. 요약이 없으면 `sessions: 0`이고 던지지 않는다.
  - `writeDailyReport`: 같은 날짜로 두 번 불러도 R2 쓰기는 한 번이다.
  - 실행기: 세션이 끝나면 R2에 두 객체가 생기고 DO 표가 비워진다. **실행기를 중간에 새로 만들어도 그 전 tick의 기록이 요약에 들어 있다.** 기록에 설치 ID, 토큰, 키가 없다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute/src/accuracy.test.ts apps/server/src/commute` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(commute): record predictions and summarize session accuracy`

---

### Task 12: 배포, 실기기 확인, 문서

**Files:**
- Create: `packages/commute/README.md`
- Modify: `apps/server/README.md`(출퇴근 절: 라우트, secret, `PUSH_MODE`, 실행기 상태 보는 법, 기록 위치), 이 계획 문서(결과 기록)

- [ ] **Step 1: secret** — `APNS_KEY_P8`을 `~/Documents/Betro-APNs/AuthKey_HFSD7YXX9N.p8`에서 표준입력으로 넣는다(화면 출력 없음). `FCM_SERVICE_ACCOUNT_JSON`은 이미 있다. Expected: `wrangler secret list`에 6개.
- [ ] **Step 2: 배포** — `packages/db`에서 `bun run db:d1-migrations`, `apps/server`에서 `bunx wrangler d1 migrations apply betro --remote`, `PUSH_MODE=send`로 `bun run deploy`. Expected: 수집기는 그대로 돌고(`/v1/snapshot/subway` 200), `GET /v1/commute/plans`는 인증 없이 401.
- [ ] **Step 3: 서버만으로 한 바퀴** — 시험용 설치를 등록하고, 5분 뒤 시작하는 경로(6411 노량진역 → 고속터미널, 대안 없음)를 넣는다. 토큰은 넣지 않는다. Expected: `wrangler tail`에 세션 시작과 `no-token` 종료, R2 `commute/summaries/…`에 요약 1개, 로그에 키 0건. 끝나면 `DELETE /v1/installs/me`.
- [ ] **Step 4: 푸시 서버 응답 확인** — 실험 4의 iPhone push-to-start 토큰(sandbox)과 실험 5의 S20 FCM 토큰을 시험용 설치 둘에 등록하고 Step 3의 경로를 한 번씩 돌린다. Expected: 로그에 APNs 시작 `status=200`, FCM start·update·end `status=200`, `token-dead` 0건. 기기에 설치된 실험 빌드는 값 모양이 달라 화면에는 뜨지 않는다. 화면 확인은 2-F의 첫 실기기 확인에서 한다. 끝나면 시험용 설치를 지운다.
- [ ] **Step 5: 문서와 결과** — README 두 개를 쓰고, 이 문서에 "2-C 결과"(배포 버전, Step 3·4 결과, 버스 도착 예산 사용량)를 적는다.
- [ ] **Step 6: 커밋** — `docs: document the commute server and record the 2-C run`
