# 4단계: 실시간 수집기 (dev 모드, Cloudflare) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API 서버를 Cloudflare Workers(Hono) + D1으로 옮기고, Durable Object 수집기가 `dev` 모드 한도 안에서 지하철 전 노선과 버스 6411·150을 하루 동안 끊김 없이 모아 정규화하고, 원본과 관측을 R2에 남기며, 상태 페이지와 멈춤 알림으로 확인할 수 있게 한다.

**Architecture:** 정규화·스케줄·예산·이력 버퍼·지표·알림 판단은 Cloudflare API에 의존하지 않는 순수 TS 패키지 `packages/realtime`에 두고 `bun test`로 검증한다. `apps/server`는 Hono Worker가 되어 기존 oRPC + better-auth를 D1 위에서 돌리고, 같은 Worker에 Durable Object `Collector`를 둔다. DO는 얇은 껍데기이고 실제 흐름은 포트(저장소, R2, D1 참조, 상류 fetch, 시계, 알림)를 주입받는 `CollectorCore`가 맡아 가짜 포트로 테스트한다. 참조 데이터는 이 Mac의 `local.db`(libsql)에서 빌드하고 `bun transit publish:d1`로 D1에 올린다.

**Tech Stack:** Bun 1.4, TypeScript, Hono, oRPC(fetch 어댑터), better-auth 1.7.12, Drizzle ORM 1.0.0-rc.5(libsql + D1 드라이버), zod, wrangler 4.x, Cloudflare Workers / Durable Objects(SQLite) / D1 / R2, FCM HTTP v1. 테스트는 `bun test`. 새 의존성: `hono`, `wrangler`(dev), `@cloudflare/workers-types`(dev).

**Spec:** `docs/superpowers/specs/2026-11-04-phase4-realtime-collector-design.md`(이하 "4단계 설계"). 상위 `docs/superpowers/specs/2026-10-30-data-collection-design.md`(이하 "수집 설계") 7장, 8장, 9.1절, 10장, 11장. 근거는 `docs/research/2026-10-30-data-sources.md` 9절.

## 계획 중 확인한 사실 (2026-11-04)

- 서버 코드: `apps/server/src`(index.ts Fastify, context.ts, services.ts, varlock env.ts/env.server.ts), `packages/api`(oRPC `appRouter`: `healthCheck`, `privateData`), `packages/auth`(`createAuth(env, db)`, drizzle adapter provider `sqlite`, expo 플러그인). 합계 287줄.
- `packages/db`: `createDb({ DATABASE_URL })`가 libsql 클라이언트로 drizzle을 만든다(`relations` 사용). 마이그레이션은 drizzle v1 폴더 형식 `src/migrations/<timestamp>_<name>/migration.sql` 4개. `test-db.ts`가 `:memory:` libsql에 마이그레이션을 적용한다.
- 재사용할 순수 코드: `packages/transit-static/src/lines.ts`(`LINES`, `LineKey`, `lineKeyBySubwayId`), `src/realtime/train-no-rules.ts`(`trainNoCandidates`, `timetableTrainNoKey`, `TRAIN_NO_RULES`), `src/realtime/position-parser.ts`(`parseRealtimePosition`, `RealtimeTrainRow`). 모두 Node API를 쓰지 않는다.
- 1~2단계 원본은 이 Mac `data/raw/`에 있다(`oa-12764-station-xlsx`, `oa-21232-station-master`, `oa-121-station-search`, `osm`, `seoul-metro-timetable`, `kric-timetable`). `local.db`에는 3단계(버스) 배치만 있다. Windows PC 2026-10-31 적재 결과: timetable batch trip 19,745, stop_time 556,108.
- Cloudflare: 계정 `02b5df744e4fdc84c06d51d019b227f5`, Workers Paid. `cmu02-studio.com` zone이 같은 계정에 있다. 현재 wrangler OAuth 토큰 범위에 zone 권한이 보이지 않았다(Task 3에서 확인).
- 2026-11-04 측정 Worker: `compatibility_date = "2025-11-01"`, DO `new_sqlite_classes`, `locationHint: "apac"` → KIX에서 두 API 모두 200(ALL 2,980행 0.6초).
- Firebase 프로젝트 `betro-a77a2`, 앱 번들/패키지 `com.cmu02.betro`. 앱의 FCM 토큰은 dev 빌드 콘솔에 `[push] FCM token`으로 찍힌다.
- **이 Mac 재적재 (2026-11-04)**: 실제로는 `local.db`에 2026-10-31 1~2단계 배치(crosswalk 3, track 4·5, timetable 6·7)가 이미 있었다. 마이그레이션 4개는 모두 적용 상태(새로 적용 0). 원본은 모두 있어 fetch는 하지 않았다. 다시 빌드한 결과 현재 배치: `station_crosswalk` **8**(696행, 매칭 696/696, 코드 없는 역 37), `track` **5** 유지(원본 해시가 같아 재적재 생략; shape 59, track_station 1,526 = osm-stop 1,509 + master 17, stitch 실패·미커버 역 0), `timetable` **9**(trip 19,745, stop_time 556,108, error 0, warn 1,587, 시간표 없는 노선 gtx-a), `bus_route` **2** 유지(노선 427, stop 32,098, segment 31,671, shape 427). 각 kind 현재 배치 1개. 이전 배치 1, 3, 4, 6, 7은 `is_current=0`으로 남아 있다.

## 4단계 결과 (2026-11-10 확인)

수집기는 2026-11-04 20:18 KST부터 `dev` 모드로 계속 돌고 있다. 아래는 2026-11-10 오전에 R2, D1, Cloudflare 지표, `wrangler tail`로 확인한 내용이다.

### 완료 기준 (설계 9장)

| # | 기준 | 결과 |
|---|---|---|
| 1 | 새 Worker에서 로그인과 푸시 | **API로만 확인.** 시험 계정으로 가입 → 로그인 → `get-session` → `/rpc/privateData` 모두 200, 세션 없이는 401(D1에서 better-auth 동작). 시험 계정 행은 지웠다. 푸시는 11-04에 알림 수신을 확인했다. 앱에서의 로그인은 확인하지 못했다: `apps/native/.env`의 `EXPO_PUBLIC_SERVER_URL`이 `http://localhost:3000`이고 운영 D1의 `user`가 0행이라, 앱은 새 Worker에 붙은 적이 없다. |
| 2 | 현재 배치가 D1에 있고 수집기가 그것으로 정규화 | 통과. 원격 D1 현재 배치 `station_crosswalk` 8, `track` 5, `timetable` 9, `bus_route` 2, `timetable_trip` 19,745행(로컬과 같음). 수집기 로그 `references loaded subway[station_crosswalk=8,track=5,timetable=9] bus[bus_route=2]`. |
| 3 | 하루 운행 보고서에 멈춤 구간이 없고 호출 수가 한도 안 | 통과. `reports/2026-11-05.json`: `ok: true`, 지하철 899건, 버스 899건, `stalledIntervals` 없음. 11-06~09도 모두 `ok: true`, 소스별 899~900건. |
| 4 | 상태 페이지 지표와 멈춤 알림 | 11-04에 확인한 그대로다(Task 13 진행 기록). 11-10에는 Access 로그인이 필요해 터미널에서 다시 열지 못했고, 비로그인 요청이 Access로 302 되는 것만 확인했다. |
| 5 | 원본·관측이 R2에 시간 단위로 쌓이고 키가 남지 않음 | **부분 통과.** 11-05에 5개 스트림 모두 운행 20시간에 파일이 있다. 키는 표본 30개(11-05~10, 1,450줄)와 `wrangler tail` 5분 치에서 원문·URL 인코딩 모두 0건. 그러나 이력 일부가 R2에 쓰이지 않았다(아래). |

### 이력 누락 (발견, 수정 배포함)

일일 보고서는 정상인데 R2의 `raw/` 조각 수가 호출 수보다 적다. `dev`에서는 호출 한 번이 조각 하나다.

| 운행일 | 보고서 | 지하철 호출 / 조각 (누락) | 버스 호출 / 조각 (누락) |
|---|---|---|---|
| 11-05 | ok | 899 / 881 (2.0%) | 899 / 886 (1.4%) |
| 11-06 | ok | 899 / 861 (4.2%) | 900 / 861 (4.3%) |
| 11-07 | ok | 900 / 899 (0.1%) | 900 / 899 (0.1%) |
| 11-08 | ok | 900 / 899 (0.1%) | 899 / 899 (0%) |
| 11-09 | ok | 900 / 707 (21.4%) | 900 / 670 (25.6%) |

- 가장 큰 구간은 11-09 20:02~23:03 KST다. 버스는 20:02부터 다음 날 00:15까지 조각이 없고, 지하철은 3시간 동안 7개뿐이다. `events/`도 같은 주기에 함께 빠졌다.
- **원인**: 이력 버퍼는 메모리에 있고, 다음 alarm까지 60초 이상 남을 때만 미리 R2에 쓰게 되어 있었다(`DEFAULT_IDLE_FLUSH_MS = 60_000`, "쉬는 DO는 70~140초 뒤 내려간다"는 가정). 실제로는 요청·alarm 없이 10초가 지나면 DO가 잠들고 메모리가 비워진다. 지하철과 버스의 호출 시각이 10~60초 어긋나 있는 동안에는 어느 tick도 버퍼를 쓰지 않은 채 잠들어 그 주기의 원본과 이벤트가 사라졌다. 예산·지표·최신 상태는 tick마다 저장되므로 보고서와 상태 페이지에는 드러나지 않았다.
- **근거**: `wrangler tail` 5분 동안 10초 이상 쉰 뒤의 alarm 4건은 모두 `collector core mode=…` 로그로 시작했고(새로 만들어짐), 10초 미만으로 이어진 5건은 그렇지 않았다. 누락 구간에도 alarm은 시간당 90건으로 정상이었고 R2 쓰기만 180건에서 4~8건으로 줄었다. 실패한 R2 쓰기는 없다.
- **수정**: `DEFAULT_IDLE_FLUSH_MS`를 5,000으로 낮췄다(커밋 `89bb57b`). 재현 테스트는 호출 시각을 40초 어긋나게 두고 10초 이상 쉴 때마다 `CollectorCore`를 새로 만든다. 수정 전 호출 15건 중 원본 0줄, 수정 후 15줄.
- 배포 전(11-10 오전)에는 두 tick이 5초 간격으로 붙어 있어 누락이 없는 상태였다. 호출 시각은 재시도나 지연으로 조금씩 밀리므로 수정이 없으면 다시 어긋날 수 있었다. 배포 직후 11:06:47, 11:08:08, 11:09:27 KST에 조각이 80초 간격으로 이어서 쓰였다.

### 매칭률 (일일 보고서)

- 7호선: 11-05 1.0, 11-06 1.0, 11-07 0.999, 11-08 1.0, 11-09 1.0.
- 11-05 기준: 1~9호선 0.986~1.0, 경의중앙 0.970, 공항철도 0.991, 서해 0.985, 경강 1.0, 신림 0.990, 우이신설 0.952, 수인분당 0.860, 경춘 0.806. 신분당과 GTX-A는 `null`(시간표 매칭 대상 아님).
- 주말(11-07, 11-08)에는 경춘 0.70, 수인분당 0.82, 신림 0.90으로 내려간다.

### 용량과 사용량 (`dev`, 11-05~09)

- R2: 2026-11-10 10:45 기준 객체 18,053개, 910MB. 운행일 하루에 `raw/` 162~169MB, `events/` 10~12MB. 보관 기간이 다 차면 `raw/` 약 5.0GB(30일), `events/` 약 4.2GB(365일)로 무료 10GB에 가깝다.
- `raw/`가 설계 추정("절반은 해시만 남는다")보다 큰 이유: DO가 tick마다 잠들고, 다시 깨어나면 스트림의 첫 줄은 본문을 그대로 남기게 되어 있어서 `dev`에서는 본문 중복 제거가 사실상 동작하지 않는다.
- Worker 요청 하루 292~2,193건(cron 288건 포함), DO 요청 약 2,100건, DO 실행 시간 약 4.0~4.3시간(약 1,900 GB-s), DO SQLite 쓰기 약 12,400행, R2 쓰기 2,831~3,597건. Worker 오류 0건.
- DO alarm의 `clientDisconnected` 20~36건/일은 원인을 확인하지 않았다. 같은 날 보고서의 호출 수와 멈춤 구간에는 영향이 없다.

### 남은 일

- [x] 수정(`89bb57b`) 배포: 2026-11-10 11:06 KST, 버전 `07c25acd`. 바로 앞 배포는 11-04의 `4fb449e4`였고 그 사이 코드 변경은 이 수정뿐이다. secret 5개는 그대로다.
- [ ] 배포 뒤 운행일 하나에서 `raw/` 조각 수가 보고서 호출 수와 같은지 확인한다(2026-11-11 운행일을 11-12에).
- 앱에서의 로그인 확인(Task 3 Step 7)은 대상이 없어졌다. `develop`의 앱은 MVP 작업에서 로그인 화면과 인증 클라이언트를 뺐다(`apps/native`에 better-auth 사용처 없음). 서버의 인증은 위 API 확인으로 갈음한다.
- [ ] 후속 후보: 일일 보고서에 이력 누락을 넣는다(버퍼에 넣은 줄 수와 R2에 쓴 줄 수를 세어 차이가 나면 `ok: false`).
- [x] `develop` PR: #12 (2026-11-10). `develop`을 브랜치에 병합하고 `bun.lock`을 다시 만들었다. 병합 뒤 `bun test` 568개 통과.

## Global Constraints

- 커밋 메시지·PR 본문에 AI 서명·출처 표기(`Co-Authored-By`, 세션 URL 등)를 넣지 않는다. 브랜치는 `feat/phase4-realtime-collector`(develop 기준), PR은 develop으로.
- 커밋 전 `bunx ultracite fix`, 테스트는 루트에서 `bun test`. 테스트는 소스 옆 `*.test.ts`.
- **키(`SEOUL_OPEN_API_KEY`, `DATA_GO_KR_API_KEY`, `BETTER_AUTH_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `ALERT_FCM_TOKEN`)는 Worker secret과 로컬 `.dev.vars`(gitignore)에만 둔다.** 로그, R2 원본·이벤트·보고서, 상태 페이지, 응답 본문, 오류 메시지에 키 원문과 `encodeURIComponent(key)`가 나오면 안 된다. 상류 URL을 남길 때는 `redactKeys`를 거친다.
- 상류는 HTTP만(`http://swopenAPI.seoul.go.kr`, `http://ws.bus.go.kr`). 요청 타임아웃 10초. 요청 헤더에 개인정보를 넣지 않는다.
- 시각은 내부 UTC epoch ms, 원본 KST 문자열(`recptnDt`, `dataTm`)도 보존. 거리는 m, 좌표 WGS84 `[lng, lat]`.
- 운행 시간 KST 05:00~01:00(설정 `OPERATING_START_KST="05:00"`, `OPERATING_END_KST="01:00"`). 하루 예산 소스별 900건(`DAILY_BUDGET_SUBWAY=900`, `DAILY_BUDGET_BUS=900`), KST 00:00 초기화. 재시도도 1건으로 센다.
- `dev` 버스 시험 노선: `100100290`(6411), `100100029`(150).
- 주소: API `https://betro.cmu02-studio.com`, 상태 페이지 `https://betro-status.cmu02-studio.com`. `workers_dev = false`. 기존 DNS 레코드(루트, `www`, `cleanbreath`, Google TXT)는 건드리지 않는다.
- Cloudflare 이름: Worker `betro-server`, D1 `betro`(바인딩 `DB`), R2 `betro-data`(바인딩 `DATA`), DO 클래스 `Collector`(바인딩 `COLLECTOR`, 이름 `collector-v1`, `locationHint: "apac"`). `compatibility_date = "2025-11-01"`, `compatibility_flags = ["nodejs_compat"]`.
- 로컬 개발·테스트는 상류를 부르지 않는다(`UPSTREAM_MODE=fixture` 기본). 실제 호출은 `UPSTREAM_MODE=live`일 때만. 하루 시험 운행 중에는 수집기 밖에서 실시간 오퍼레이션을 부르지 않는다.
- 품질 문제는 버리지 않고 `qualityFlags`로 남긴다.
- 기존 EC2(CleanBreath, PickTrip)는 건드리지 않는다. `apps/web`은 이번에 맞추지 않는다(깨져도 됨).

## Review Focus

1. **자정과 운행 시간 경계**: KST 00:00에 예산이 초기화되지만 운행은 01:00까지 이어지고, 00:30의 열차는 전날 서비스일 시간표에 속한다. 기대: 00:00~01:00에도 폴링이 계속되고(새 날 예산 사용), 열차 매칭은 전날 `serviceDay`로 한다. Task 6(`serviceDayAt`)과 Task 9(`planTick` 23:59→00:01) 테스트로 고정.
2. **DO 재시작**: 배포나 축출로 DO가 다시 깨어나도 그날 호출 수가 이어지고, 직전 상태가 복원되어 같은 응답에서 전이 이벤트가 쏟아지지 않는다. Task 12 테스트(같은 저장소로 만든 두 번째 `CollectorCore`가 카운터를 이어 쓰고, 같은 응답에 이벤트 0건)로 고정.
3. **오류 경로의 키 노출**: fetch가 URL을 담은 오류를 던지거나 상류가 키를 되돌려 보내도 로그·R2·상태에 키가 없다. Task 5(`redactKeys` 원문·인코딩) + Task 12(키가 든 메시지를 던지는 가짜 fetch → 기록된 모든 문자열에 키 없음)로 고정.
4. **원천이 잠깐 비거나 일부만 옴**: 운행 중 INFO-200이나 버스 headerCd 4가 한 번 오면 최신 상태가 통째로 비면 안 된다. 기대: 사라진 차량은 TTL(지하철 5분, 버스 5분) 동안 유지 후 빠지고, 스냅샷에 `staleSince`가 붙는다. Task 8 테스트로 고정.
5. **시각이 거꾸로이거나 미래인 원천**: 신분당선 ALL `recptnDt` 미래(최대 5분), 버스 `dataTm` 1~2초 역행. 기대: 미래 시각은 `sourceAt=null` + `future-source-time`, 역행은 `time-backwards`, 둘 다 버리지 않음. Task 6, 7 테스트로 고정.

## 실행 방식과 모델 배정

| Task | 내용 | 구현 모델 | 이유 |
|---|---|---|---|
| 1 | 이 Mac에서 1~2단계 재적재 | Opus 5.5 | 실데이터 판단 |
| 2 | `packages/db` D1 지원과 D1 마이그레이션 | Sonnet 5.5 | 정해진 드라이버 교체 |
| 3 | API 서버 Hono/Workers 이전과 배포 | Opus 5.5 | 인증·배포 연동 |
| 4 | `publish:d1` 명령 | Opus 5.5 | 배치 버전·SQL 한도 |
| 5 | `packages/realtime` 기초(시간, URL, 키 가리기, 상류 파서) | Sonnet 5.5 | 정해진 봉투 파싱 |
| 6 | 지하철 정규화(ALL 축약, 매칭, 플래그) | Opus 5.5 | 규칙 해석 |
| 7 | 버스 정규화 | Sonnet 5.5 | 정해진 공식 |
| 8 | 최신 상태·변화 감지·스냅샷 | Opus 5.5 | 상태 기계 |
| 9 | 스케줄과 예산 | Opus 5.5 | 경계 시각 |
| 10 | 이력 버퍼(R2 gzip NDJSON) | Sonnet 5.5 | 정해진 형식 |
| 11 | 지표·상태·일일 보고서·알림 판단·FCM | Opus 5.5 | 집계와 JWT 서명 |
| 12 | `CollectorCore`, DO, Worker 라우트, cron 감시 | Opus 5.5 | 전체 연결 |
| 13 | 배포, 하루 운행, 완료 판정, 문서 | Opus 5.5 | 운영 판단 |

## 파일 구조

```
packages/db/
  src/index.ts                     (수정) createDb(libsql) 유지 + createD1Db(d1), Database 공통 타입
  scripts/build-d1-migrations.ts   drizzle 폴더 → d1-migrations/NNNN_<name>.sql
  d1-migrations/                   (생성물, 커밋) wrangler d1 migrations apply 입력
packages/transit-static/
  src/db/export-sql.ts             현재 배치 → INSERT 문 묶음 (D1 한도 지킴)
  src/jobs/publish-d1.ts           local.db → SQL 파일 → wrangler d1 execute
  src/cli.ts                       (수정) publish:d1
packages/realtime/                 (새 패키지 @Betro/realtime, 순수 TS)
  src/time.ts                      KST 변환, 운행 시간, 서비스일
  src/holidays.ts                  KOREAN_PUBLIC_HOLIDAYS
  src/upstream/urls.ts             상류 URL, redactKeys
  src/upstream/subway-arrival.ts   ALL 파서
  src/upstream/bus-position.ts     getBusPosByRtid 파서
  src/upstream/classify.ts         7.5절 오류 분류
  src/reference.ts                 SubwayReference, BusReference 타입과 색인
  src/observation.ts               SubwayObservation, BusObservation
  src/subway/reduce-arrivals.ts    ALL 행 → 열차별 대표 상태
  src/subway/normalize.ts          관측 생성(매칭, 플래그)
  src/bus/normalize.ts             관측 생성(구간 거리, 투영, 플래그)
  src/state.ts                     LatestState, 전이 감지, TTL, 스냅샷
  src/schedule.ts                  planTick, 다음 alarm 시각
  src/budget.ts                    KST 일 단위 예산
  src/history.ts                   HistoryBuffer (NDJSON + gzip, 해시 중복 제거)
  src/metrics.ts                   5분 지표, 수집 상태, 일일 보고서
  src/alerts.ts                    알림 판단, FCM 메시지·JWT
  src/__fixtures__/                ALL 축약 표본, 위치 API 표본, 버스 6411·150 표본
apps/server/
  wrangler.jsonc                   Worker, DO, D1, R2, 커스텀 도메인 2개, cron
  src/index.ts                     (교체) Worker 진입점: fetch, scheduled, Collector export
  src/app.ts                       createApp(deps): Hono 라우트
  src/status-page.ts               renderStatusPage(status)
  src/collector/ports.ts           포트 인터페이스
  src/collector/core.ts            CollectorCore
  src/collector/durable-object.ts  Collector (DO 껍데기)
  src/collector/cf-ports.ts        DO SQLite·R2·D1·fetch 구현
  (삭제) src/context.ts, src/services.ts, src/env.ts, src/env.server.ts, .env.schema
(삭제) packages/infra/
package.json                       (수정) deploy:server, dev:server, postinstall/env:generate에서 apps/server 경로 제거
apps/native/.env                   (사용자 로컬) EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com
```

---

### Task 1: 이 Mac에서 1~2단계 재적재

**Files:** 코드 변경 없음. 보고서는 `data/reports/`(gitignore).

- [x] **Step 1: 마이그레이션** — Run: `cd packages/db && DATABASE_URL=file:/Users/choehyeonjun/Project/Betro/local.db bun run db:migrate` / Expected: 오류 없이 끝남(이미 적용된 것은 건너뜀).
- [x] **Step 2: 대응표** — Run: `bun transit build:crosswalk --dry-run` → 보고서 확인 → `bun transit build:crosswalk` / Expected: exit 0, 보고서 `ok: true`. 원본이 없다는 안내가 나오면 안내된 fetch 명령만 실행한다(`fetch:station-master`, `fetch:station-search`는 일반 API라 실시간 한도와 무관).
- [x] **Step 3: 선로** — Run: `bun transit build:tracks --dry-run` → `bun transit build:tracks` / Expected: exit 0, stitch 실패·미커버 역 0.
- [x] **Step 4: 시간표** — Run: `bun transit build:timetable --dry-run` → `bun transit build:timetable` / Expected: exit 0, `ok: true`. trip 수가 19,745에서 ±5% 밖이면 멈추고 보고서의 노선별 차이를 사용자에게 보인다.
- [ ] **Step 5: 확인** — Run: `sqlite3 local.db "select kind, id, is_current from reference_batch order by id"` / Expected: `station_crosswalk`, `track`, `timetable`, `bus_route`가 각각 현재 배치 1개.
- [ ] **Step 6: 기록** — 계획 문서의 "계획 중 확인한 사실"에 배치 ID와 행 수를 적고 커밋: `docs(plan): record phase 1-2 reload on mac`

---

### Task 2: `packages/db` D1 지원과 D1 마이그레이션

**Files:**
- Modify: `packages/db/src/index.ts`, `packages/db/package.json`
- Create: `packages/db/scripts/build-d1-migrations.ts`, `packages/db/scripts/build-d1-migrations.test.ts`, `packages/db/d1-migrations/*.sql`

**Interfaces:**
- Produces:
  - `createDb(env: DatabaseConfig): LibsqlDatabase` (지금과 같음, transit-static과 테스트용)
  - `createD1Db(d1: D1Database): D1DrizzleDatabase` (`drizzle-orm/d1`, 같은 `relations`)
  - `type Database = LibsqlDatabase | D1DrizzleDatabase` — `packages/api`, `packages/auth`가 받는 타입. 두 드라이버의 쿼리 빌더 API가 같아 라우터·인증 코드는 바뀌지 않는다. `db.transaction`은 D1에서 쓰지 않는다(transit-static은 libsql만).
  - `buildD1Migrations(srcDir: string, outDir: string): Promise<string[]>` — 폴더를 이름순으로 정렬해 `0001_<폴더명>.sql`… 로 복사, 만든 파일 이름 목록을 돌려준다. 내용은 그대로(`--> statement-breakpoint` 주석 포함).
  - 스크립트: `"db:d1-migrations": "bun run scripts/build-d1-migrations.ts"`

- [ ] **Step 1: 실패하는 테스트** — `build-d1-migrations.test.ts`
  - `numbers migrations in folder order`: 임시 폴더에 `20261101_b/migration.sql`, `20261031_a/migration.sql` → `["0001_20261031_a.sql", "0002_20261101_b.sql"]`, 내용 동일.
  - `is idempotent`: 두 번 실행해도 같은 파일 목록과 내용, 남는 파일 없음(이전 생성물은 지우고 다시 씀).
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/db/scripts/build-d1-migrations.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `createD1Db`, `Database` 타입, 스크립트. `bun run db:d1-migrations`로 `d1-migrations/` 생성.
- [ ] **Step 4: 통과 확인** — Run: `bun test packages/db && bun run check-types` / Expected: PASS
- [ ] **Step 5: D1 만들기** — Run: `cd apps/server && bunx wrangler d1 create betro` / Expected: database_id 출력(Task 3 `wrangler.jsonc`에 넣는다).
- [ ] **Step 6: 커밋** — `feat(db): add D1 driver and generated D1 migrations`

---

### Task 3: API 서버 Hono/Workers 이전과 배포

**Files:**
- Create: `apps/server/wrangler.jsonc`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `apps/server/.dev.vars.example`
- Modify: `apps/server/src/index.ts`(교체), `apps/server/package.json`, `apps/server/tsconfig.json`, `packages/auth/src/index.ts`, 루트 `package.json`, `.gitignore`(`.dev.vars`, `.wrangler/`)
- Delete: `apps/server/src/context.ts`, `services.ts`, `env.ts`, `env.server.ts`, `apps/server/.env.schema`, `packages/infra/`

**Interfaces:**
- Consumes: Task 2 `createD1Db`, `Database`
- Produces:
  - `interface AppDeps { db: Database; auth: Auth; corsOrigins: string[]; apiHost: string; statusHost: string; collector?: CollectorClient }` (`CollectorClient`는 Task 12가 채운다. 이 Task에서는 없으면 해당 라우트 503)
  - `createApp(deps: AppDeps): Hono` — 라우트: `GET /` → `"OK"`, `ALL /api/auth/*` → `auth.handler(c.req.raw)`, `ALL /rpc/*` → oRPC `RPCHandler`(`@orpc/server/fetch`, prefix `/rpc`), `ALL /api-reference/*` → `OpenAPIHandler`(`@orpc/openapi/fetch`). 컨텍스트는 요청마다 `{ db, session: await auth.api.getSession({ headers }) }`. CORS는 `hono/cors`로 기존 값(methods, allowedHeaders, credentials true, maxAge 86400).
  - 호스트 분리: `statusHost`로 온 요청은 `/`, `/status.json`(Task 12)만, 그 외는 404. `apiHost`로 온 요청에서 상태 경로는 404.
  - `type Auth = ReturnType<typeof createAuth>`; `createAuth(env, db, extraOrigins)`의 `trustedOrigins`에서 `env.CORS_ORIGIN`은 쉼표로 나눈 목록을 받는다(값: 로컬 개발 `http://localhost:8081`). 나머지 기존 항목(`Betro://`, `exp://`)은 유지.
  - Worker 진입점: `export default { fetch(req, env, ctx), scheduled(event, env, ctx) }` — `env`에서 `createD1Db(env.DB)`, `createAuth`를 isolate당 한 번 만들어 재사용.
  - `wrangler.jsonc`: `name: "betro-server"`, `main: "src/index.ts"`, Global Constraints의 날짜·플래그, `workers_dev: false`, `routes: [{ pattern: "betro.cmu02-studio.com", custom_domain: true }, { pattern: "betro-status.cmu02-studio.com", custom_domain: true }]`, `d1_databases: [{ binding: "DB", database_name: "betro", database_id, migrations_dir: "../../packages/db/d1-migrations" }]`, `vars: { BETTER_AUTH_URL: "https://betro.cmu02-studio.com", CORS_ORIGIN: "http://localhost:8081", API_HOST: "betro.cmu02-studio.com", STATUS_HOST: "betro-status.cmu02-studio.com" }`. (R2, DO, cron은 Task 12에서 추가.)
  - 루트 `package.json`: `deploy:server` = `bun run --cwd apps/server deploy`(`wrangler deploy`), `dev:server` = `bun run --cwd apps/server dev`(`wrangler dev`), `destroy` 제거, `postinstall`/`env:generate`에서 `--path ./apps/server/` 제거.

- [ ] **Step 1: 실패하는 테스트** — `app.test.ts`(Hono `app.request`, 의존성은 `createTestDb()` libsql + 실제 `createAuth`)
  - `serves health on api host`: `GET https://betro.cmu02-studio.com/` → 200 `"OK"`.
  - `rpc healthCheck works`: oRPC 클라이언트(`@orpc/client` fetch 링크, `fetch`를 `app.request`로)로 `healthCheck()` → `"OK"`.
  - `privateData requires a session`: 쿠키 없이 → UNAUTHORIZED. 이메일 가입(`/api/auth/sign-up/email`) 후 받은 쿠키로 → `user.email` 일치.
  - `status paths are not served on api host`: `GET https://betro.cmu02-studio.com/status.json` → 404. `GET https://betro-status.cmu02-studio.com/rpc/healthCheck` → 404.
  - `cors allows configured origin only`: `Origin: http://localhost:8081` 프리플라이트 → `Access-Control-Allow-Origin` 일치, 다른 Origin → 헤더 없음.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server` / Expected: FAIL
- [ ] **Step 3: 구현** — 위 Interfaces대로. Fastify, `@fastify/cors`, varlock, `libsql` 의존성을 `apps/server`에서 뺀다. better-auth가 D1에서 트랜잭션 오류를 내면 drizzle adapter에 `transaction: false`를 준다(Step 7에서 확인).
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/server && bun run check-types` / Expected: PASS
- [ ] **Step 5: 로컬 D1** — Run: `cd apps/server && bunx wrangler d1 migrations apply betro --local && bunx wrangler dev` 후 `curl -H 'Host: betro.cmu02-studio.com' localhost:8787/` / Expected: `OK`.
- [ ] **Step 6: zone 권한과 원격 배포** — `bunx wrangler whoami`의 권한에 zone이 없으면 사용자에게 `wrangler login`을 다시 요청한다. Run: `bunx wrangler d1 migrations apply betro --remote`, secret `BETTER_AUTH_SECRET` 설정(값은 화면에 찍지 않고 표준입력으로), `bunx wrangler deploy` / Expected: 두 커스텀 도메인 연결, `curl https://betro.cmu02-studio.com/` → `OK`. 기존 DNS 레코드가 그대로인지 `dig +short www.cmu02-studio.com`, `cleanbreath.cmu02-studio.com`로 확인.
- [ ] **Step 7: 앱 확인(사용자)** — 사용자에게 `apps/native/.env`의 `EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com`으로 바꾸고 dev 빌드에서 가입·로그인을 해 달라고 요청한다. Expected: 로그인 성공, `privateData` 응답.
- [ ] **Step 8: 커밋** — `feat(server): move the API to Cloudflare Workers with Hono and D1`

---

### Task 4: `publish:d1` 명령

**Files:**
- Create: `packages/transit-static/src/db/export-sql.ts`, `export-sql.test.ts`, `src/jobs/publish-d1.ts`, `publish-d1.test.ts`
- Modify: `packages/transit-static/src/cli.ts`, `README.md`(D1 절)

**Interfaces:**
- Consumes: `local.db`의 `reference_batch`와 자식 테이블(1~3단계 스키마), Task 2 D1 마이그레이션(같은 스키마)
- Produces:
  - 상수 `D1_MAX_STATEMENT_BYTES = 90_000`(D1 문장 한도 100KB 안), `D1_PUBLISH_KINDS: ReferenceBatchKind[] = ["station_crosswalk", "track", "timetable", "bus_route"]`
  - `exportBatchSql(db: Database, batchIds: number[]): Promise<string[]>` — 주어진 배치의 `reference_batch` 행과 자식 행(`station_crosswalk`, `track_shape`→`track_station`, `timetable_trip`→`timetable_stop_time`, `bus_route`→`bus_route_shape`/`bus_route_stop`/`bus_route_segment`)을 **로컬 id 그대로** 넣는 `INSERT INTO ... VALUES (...),(...);` 문 목록. 부모가 자식보다 먼저. 문 하나는 `D1_MAX_STATEMENT_BYTES` 이하. 바인딩 변수를 쓰지 않고 SQL 리터럴로 쓴다(문자열 `'` 이스케이프, JSON 컬럼은 JSON 문자열, boolean 0/1, timestamp_ms 정수, null은 NULL).
  - `currentFlipSql(currentIds: Record<ReferenceBatchKind, number>): string[]` — 종류별 `UPDATE reference_batch SET is_current = (id = <id>) WHERE kind = '<kind>';`
  - `publishD1(options: { db: Database; target: "local" | "remote"; dryRun: boolean; run: (args: string[]) => Promise<string>; outDir: string }): Promise<{ published: number[]; skipped: number[]; sqlPath?: string }>` — `run`은 wrangler 실행 함수(테스트에서 가짜). 순서: ① D1의 `select id, kind, source_manifest from reference_batch`(`wrangler d1 execute betro --json --command ...`) ② 로컬 현재 배치 중 D1에 같은 id가 없는 것만 내보냄(같은 id가 있는데 manifest가 다르면 오류로 멈춤) ③ SQL 파일 `<outDir>/<UTC 시각>.sql` = INSERT들 + flip ④ `dryRun`이 아니면 `wrangler d1 execute betro --file <path> --<target>` ⑤ 결과 요약.
  - CLI: `bun transit publish:d1 [--remote] [--dry-run]`(기본 local). `wrangler`는 `--config ../../apps/server/wrangler.jsonc`로 부른다. 키가 필요 없다.

- [ ] **Step 1: 실패하는 테스트**
  - `export round-trips into an empty database`: `createTestDb()`에 작은 배치(대응표 2행, 선로 1모양 2역, trip 1개 정차 2개, 버스 노선 1개 정류소 2개 구간 1개)를 넣고 → `exportBatchSql` 결과를 다른 빈 `createTestDb()`에 실행 → 모든 테이블 행이 컬럼 값까지 같음(JSON 컬럼, `'`가 든 역명 포함).
  - `splits statements under the byte limit`: 행 5,000개 → 모든 문이 `D1_MAX_STATEMENT_BYTES` 이하, 행 수 합 5,000.
  - `skips batches already in D1`: 가짜 `run`이 D1에 id 2(bus_route, 같은 manifest)를 돌려줌 → `skipped: [2]`, SQL에 id 2 INSERT 없음, flip은 포함.
  - `refuses a conflicting batch id`: 같은 id, 다른 manifest → 던짐, `run`에 `--file` 호출 없음.
  - `dry run writes sql but does not execute`: `--file` 호출 없음, `sqlPath` 존재.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/db/export-sql.test.ts packages/transit-static/src/jobs/publish-d1.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 실제 업로드** — Run: `bun transit publish:d1 --dry-run` → 파일 크기 확인 → `bun transit publish:d1` (local) → `bun transit publish:d1 --remote` / Expected: 원격 D1에서 `select kind, count(*) from reference_batch where is_current=1 group by kind` → 4종 각 1, `select count(*) from timetable_trip`가 로컬과 같음.
- [ ] **Step 6: 커밋** — `feat(transit-static): publish current reference batches to D1`

---

### Task 5: `packages/realtime` 기초 — 시간, URL, 키 가리기, 상류 파서

**Files:**
- Create: `packages/realtime/package.json`(`@Betro/realtime`, exports `"./*": "./src/*.ts"`, deps `zod`, `@Betro/transit-static`), `tsconfig.json`, `src/time.ts`, `src/holidays.ts`, `src/upstream/urls.ts`, `src/upstream/subway-arrival.ts`, `src/upstream/bus-position.ts`, `src/upstream/classify.ts`, 각 `*.test.ts`, `src/__fixtures__/*`

**Interfaces:**
- Produces:
  - `time.ts`: `kstToEpochMs(s: string): number`(`"2026-11-03 12:41:21"`와 `"20261103130329"` 둘 다), `kstParts(epochMs: number): { date: string; hour: number; minute: number; dayOfWeek: number }`(date `YYYY-MM-DD`), `isOperatingTime(epochMs: number, start: string, end: string): boolean`(끝이 시작보다 이르면 자정을 넘김), `nextOperatingStart(epochMs: number, start: string): number`, `kstDayStart(epochMs: number): number`, `serviceDayAt(epochMs: number): { date: string; serviceDay: ServiceDay }` — KST 03:00 이전은 전날 날짜, 그 날짜가 `KOREAN_PUBLIC_HOLIDAYS`에 있거나 일요일이면 `holiday`, 토요일이면 `saturday`, 아니면 `weekday`.
  - `holidays.ts`: `KOREAN_PUBLIC_HOLIDAYS: ReadonlySet<string>` — 2026-11-01 ~ 2027-12-31 관공서 공휴일(대체공휴일 포함). 구현자가 한국천문연구원 특일 정보나 정부 공식 달력에서 확인해 넣고 주석에 출처와 확인일을 적는다.
  - `urls.ts`: `subwayArrivalAllUrl(key)` = `http://swopenAPI.seoul.go.kr/api/subway/${key}/json/realtimeStationArrival/ALL`, `subwayPositionUrl(key, lineNameKo)` = `.../json/realtimePosition/0/999/${encodeURIComponent(lineNameKo)}`, `busPositionUrl(key, busRouteId)` = `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${encodeURIComponent(key)}&busRouteId=${id}&resultType=json`, `redactKeys(text: string, keys: readonly string[]): string`(원문과 `encodeURIComponent` 형태를 모두 `<key>`로, 빈 키는 무시).
  - `subway-arrival.ts`: `interface ArrivalRow { subwayId; statnId; statnFid; statnTid; statnNm; btrainNo; arvlCd: "0"|"1"|"2"|"3"|"4"|"5"|"99"; recptnDt; updnLine; bstatnId; btrainSttus; lstcarAt; ordkey }`(모두 string), `parseStationArrivalAll(json: unknown): { ok: true; rows: ArrivalRow[]; total: number; dropped: number } | { ok: false; code: string; message: string }` — 봉투는 위치 API와 같음(`errorMessage.code === "INFO-000"`, 목록 키 `realtimeArrivalList`). 행 스키마 위반은 그 행만 `dropped`.
  - `bus-position.ts`: `interface BusPositionRow { vehId; plainNo; sectOrd: number; sectDistM: number; fullSectDistM: number; sectionId; lastStnId; stopFlag: boolean; dataTm: string; gpsX: number; gpsY: number; busType: string; congetion: string; islastyn: boolean; isrunyn: boolean }` — `sectDist`, `fullSectDist`(km 문자열)를 ×1000 해 m로. `parseBusPositions(json: unknown): { ok: true; headerCd: string; rows: BusPositionRow[] } | { ok: false; code: string; message: string }`(`itemList`가 null이면 빈 배열).
  - `classify.ts`: `type UpstreamOutcome = "ok" | "no-data" | "service-ended" | "temporary" | "rate-limited" | "quota-exhausted" | "auth" | "request-error" | "network"`, `classifySubway(status: number | null, parsed): UpstreamOutcome`(INFO-000 → ok, INFO-200 → no-data, ERROR-3xx → request-error, 401 → auth, null → network), `classifyBus(status, parsed)`(headerCd 0 → ok, 4 → no-data, 8 → service-ended, 6 → temporary, 7 → auth, 401 → auth, 429 또는 본문 `returnReasonCode` 22 → quota-exhausted, 23 → rate-limited, 5xx·null → network). 수집 설계 7.5절 표와 같은 뜻.
  - 표본: `__fixtures__/arrival-all-sample.json`(2026-11-03 ALL 응답에서 2호선·7호선·신분당선 행만 남긴 것, 봉투 유지), `position-line2.json`, `position-line7.json`(같은 시각), `bus-6411.json`, `bus-150.json`. 응답에는 키가 없지만 커밋 전 `grep`으로 두 키 원문이 없는지 확인한다. 저장된 측정 응답이 없으면 실제 호출 각 1회로 새로 받는다(합계 지하철 3건, 버스 2건).

- [ ] **Step 1: 실패하는 테스트**
  - `parses both KST formats`: `kstToEpochMs("2026-11-03 12:41:21") === Date.UTC(2026,10,3,3,41,21)`, `"20261103130329"` → `Date.UTC(2026,10,3,4,3,29)`.
  - `operating window crosses midnight`: 00:30 → true, 01:00 → false, 04:59 → false, 05:00 → true, 23:59 → true.
  - `service day before 3am belongs to the previous date`: 2026-11-07(토) 00:30 KST → `{ date: "2026-11-06", serviceDay: "weekday" }`, 2026-11-07 10:00 → saturday, 2026-11-08 10:00 → holiday, 2026-12-25(금) 10:00 → holiday.
  - `redacts raw and encoded keys`: 키 `a/b+c=`가 든 URL·오류 문자열 → 원문과 `a%2Fb%2Bc%3D` 모두 없음.
  - `parses the ALL sample`: `ok`, 행 수 = 표본 행 수, `arvlCd` 집합에 `"99"` 포함.
  - `converts bus km to m`: 6411 표본 첫 차 `sectDist "0.213"`, `fullSectDist "0.601"`인 행(테스트 픽스처를 이렇게 만든다) → `sectDistM 213`, `fullSectDistM 601`.
  - `classifies outcomes`: INFO-200 → no-data, 버스 headerCd 4 → no-data, 8 → service-ended, HTTP 401 → auth, fetch 실패(null) → network.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): add time, upstream urls and response parsers`

---

### Task 6: 지하철 정규화

**Files:**
- Create: `packages/realtime/src/reference.ts`, `src/observation.ts`, `src/subway/reduce-arrivals.ts`, `src/subway/normalize.ts`, 각 `*.test.ts`

**Interfaces:**
- Consumes: Task 5 `ArrivalRow`, `serviceDayAt`, `kstToEpochMs`; `@Betro/transit-static/realtime/position-parser`의 `RealtimeTrainRow`; `@Betro/transit-static/realtime/train-no-rules`의 `trainNoCandidates`, `timetableTrainNoKey`; `@Betro/transit-static/lines`
- Produces:
  - `reference.ts`:
    - `interface StationOnTrack { statnId: string; trackShapeId: number; lineKey: LineKey; direction: TrackDirection; branchKey: string; seq: number; distanceM: number }`
    - `interface TripKey { tripId: number; lineKey: LineKey; serviceDay: ServiceDay; direction: TrackDirection; trainNo: string; originStatnId?: string; destinationStatnId?: string; express: ExpressKind }`
    - `interface SubwayReference { batchIds: { crosswalk: number; track: number; timetable: number }; stationsByStatnId: Map<string, StationOnTrack[]>; tripsByLineDayNo: Map<string, TripKey[]> }` — 키 `${lineKey}|${serviceDay}|${timetableTrainNoKey(lineKey, trainNo)}`
    - `buildSubwayReference(rows: { crosswalk; trackStations; trips }): SubwayReference`
    - `interface BusSegmentRef { fromSeq: number; startM: number; endM: number }`, `interface BusRouteRef { routeId: string; lengthM: number; segmentsBySeq: Map<number, BusSegmentRef>; coords?: [number, number][] }`, `interface BusReference { batchId: number; routes: Map<string, BusRouteRef> }`
  - `observation.ts`: 수집 설계 8장 필드를 camelCase로.
    - `type SubwayStatus = "approach" | "arrive" | "depart" | "prev-depart"`; `type SourceAtKind = "state-change" | "snapshot" | "generated"`
    - `interface SubwayObservation { observedAt: number; sourceAt: number | null; sourceAtRaw: string; sourceAtKind: SourceAtKind; lineKey: LineKey; rawTrainNo: string; tripId: number | null; matchStatus: "matched" | "no-timetable" | "ambiguous"; statnId: string | null; status: SubwayStatus | null; direction: TrackDirection; destinationStatnId: string | null; trackShapeId: number | null; stationDistanceM: number | null; express: boolean; lastTrain: boolean; source: "position" | "arrival-all"; qualityFlags: string[] }`
    - `interface BusObservation { observedAt: number; sourceAt: number; sourceAtRaw: string; routeId: string; vehId: string; plainNo: string; busType: string; sectOrd: number; shapeDistanceM: number | null; gpsProjectedDistanceM: number | null; lat: number; lng: number; stopped: boolean; congestion: string; lastTrip: boolean; qualityFlags: string[] }`
  - `reduce-arrivals.ts`: `interface TrainCandidate { subwayId: string; btrainNo: string; statnId: string | null; status: SubwayStatus | null; row: ArrivalRow }`, `reduceArrivals(rows: readonly ArrivalRow[], ref: SubwayReference): { trains: TrainCandidate[]; flags: Map<string, string[]> }` — 4단계 설계 4.5의 규칙 1~4. 대표 선택의 "진행 방향으로 가장 앞선 것": 후보 역들의 `StationOnTrack.distanceM`을 같은 `direction`(updnLine → up/down; ALL은 "상행"/"내선" → up, "하행"/"외선" → down) 모양에서 비교해 진행 방향(거리가 커지는 쪽이 down인지 up인지는 모양의 역 seq 순서로 판단)으로 가장 먼 후보. 거리를 못 구하면 `ordkey`가 가장 작은 행. 후보 역끼리 같은 방향 모양에서 2역 넘게 떨어져 있으면 `conflicting-rows`.
  - `normalize.ts`:
    - `normalizeArrivals(trains: TrainCandidate[], ref: SubwayReference, observedAt: number): SubwayObservation[]`
    - `normalizePositions(rows: RealtimeTrainRow[], ref: SubwayReference, observedAt: number): SubwayObservation[]` (`prod`용, `trainSttus` 0~3 → approach/arrive/depart/prev-depart)
    - 공통 규칙: 시각 `sourceAt = kstToEpochMs(recptnDt)`; `sourceAt > observedAt + 5_000`이면 `sourceAt = null` + `future-source-time`; `observedAt - sourceAt > 180_000`이면 `stale-source`. `sourceAtKind`: ALL → `generated`, 위치 API의 신분당선 → `snapshot`, 나머지 → `state-change`. 매칭: `serviceDayAt(observedAt).serviceDay`와 `trainNoCandidates(lineKey, rawTrainNo, { express })`의 후보로 `tripsByLineDayNo`를 찾아, 1건이면 matched, 0건이면 no-timetable, 여러 건이면 방향이 같은 것 1건으로 좁히고 그래도 여럿이면 ambiguous(`tripId` null). 규칙이 없는 노선(`trainNoCandidates`가 null)은 no-timetable. 역이 참조에 없으면 `unknown-station`(statnId는 그대로 둠). 위치를 정하지 못한 열차(ALL 99만, ALL에만 있는 번호)는 `position-unknown`.

- [ ] **Step 1: 실패하는 테스트** (참조는 테스트 안에서 작은 가짜 `SubwayReference`를 만들고, 표본 테스트는 표본에 나오는 역을 넣은 참조를 픽스처로 둔다)
  - `maps arrival codes to station states`: 한 열차 행 `arvlCd 0`@A, `3`@B, `99`@C → 대표 (A, approach). `arvlCd 4`@B(`statnFid`=A) → (A, approach). `arvlCd 5`@B → (A, arrive).
  - `picks the most advanced candidate`: 같은 열차 `1`@A(seq 3), `0`@B(seq 4), 진행 방향 seq 증가 → (B, approach).
  - `flags conflicting rows`: 같은 열차 `1`@A(seq 3), `1`@D(seq 9) → 대표는 고르되 `conflicting-rows`.
  - `keeps unknown-position trains with a flag`: `99`만 있는 열차 → 관측 1건, `status: null`, `position-unknown`.
  - `nulls a future recptnDt`: 신분당선 행 `recptnDt`가 `observedAt` + 3분 → `sourceAt: null`, `future-source-time`, `sourceAtRaw` 보존.
  - `flags stale rows`: `observedAt - sourceAt = 200s` → `stale-source`.
  - `matches with the previous service day after midnight`: 2026-11-07 00:30 KST 관측, trip이 `weekday`에만 있음 → matched.
  - `line 7 arrival numbers are not joined to position numbers`: 표본 `arrival-all-sample.json`과 `position-line7.json`을 각각 정규화 → 두 결과의 `rawTrainNo` 집합이 서로 달라도 각자 매칭만 시도하고(교차 조인 없음), 각 결과에 열차 수만큼 관측이 있다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime/src/subway` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): normalize subway arrivals and positions`

---

### Task 7: 버스 정규화

**Files:**
- Create: `packages/realtime/src/bus/normalize.ts`, `normalize.test.ts`

**Interfaces:**
- Consumes: Task 5 `BusPositionRow`, `kstToEpochMs`; Task 6 `BusReference`, `BusObservation`
- Produces:
  - 상수 `BUS_DISTANCE_MISMATCH_M = 150`(구간 거리와 GPS 투영 거리 차이 경고), `BUS_GPS_PROJECTION = true`(dev에서는 모양 좌표가 있을 때만)
  - `normalizeBusPositions(routeId: string, rows: BusPositionRow[], ref: BusReference, prev: ReadonlyMap<string, { sourceAt: number; shapeDistanceM: number | null }>, observedAt: number): BusObservation[]`
  - 규칙: `shapeDistanceM = startM + (sectDistM / fullSectDistM) × (endM − startM)`(세그먼트 `fromSeq = sectOrd`). `fullSectDistM`이 0이면 `startM` + `zero-full-sect`. 세그먼트가 없으면 `null` + `unknown-segment`. `sectDistM > fullSectDistM`이면 비율을 1로 자르고 `sect-dist-over`. `coords`가 있으면 `gpsX/gpsY`를 모양에 투영(`@Betro/transit-static/track/project`의 `projectPoint` 재사용)해 `gpsProjectedDistanceM`, 두 거리 차이 > `BUS_DISTANCE_MISMATCH_M`이면 `distance-mismatch`. `prev` 대비 `shapeDistanceM`이 줄면 `backwards`, `sourceAt`이 줄면 `time-backwards`. 노선 참조가 없으면 모든 관측에 `unknown-route`.

- [ ] **Step 1: 실패하는 테스트**
  - `computes distance on the segment`: 세그먼트 seq 4 = [1000, 1601], `sectDistM 213`, `fullSectDistM 601` → `shapeDistanceM ≈ 1213`(±0.5).
  - `matches the 6411 sample to phase 3 segments`: `bus-6411.json` + 6411 참조 픽스처(로컬 `local.db`에서 6411 세그먼트를 뽑아 둔 JSON) → 모든 관측 `shapeDistanceM`이 null 아님, `unknown-segment` 0.
  - `flags backwards and time-backwards`: prev(1500m, t) → 현재 1400m, t−2s → 두 플래그 모두, 관측은 남김.
  - `flags distance mismatch`: 직선 모양에서 GPS가 구간 거리보다 300m 앞 → `distance-mismatch`.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime/src/bus` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): normalize bus positions onto route segments`

---

### Task 8: 최신 상태·변화 감지·스냅샷

**Files:**
- Create: `packages/realtime/src/state.ts`, `state.test.ts`

**Interfaces:**
- Consumes: Task 6·7 관측 타입
- Produces:
  - 상수 `SUBWAY_TTL_MS = 300_000`, `BUS_TTL_MS = 300_000`
  - `class LatestState` — `constructor(saved?: SavedState)`, `applySubway(obs: SubwayObservation[], observedAt: number): SubwayObservation[]`(직전과 (statnId, status)가 다른 열차의 관측만 "전이"로 돌려준다, 새 열차 포함), `applyBus(routeId: string, obs: BusObservation[], observedAt: number): BusObservation[]`(직전과 `sourceAt`이 다른 차량만), `markSourceEmpty(kind: "subway" | { busRouteId: string }, observedAt: number): void`(지우지 않고 `staleSince` 기록), `expire(now: number): void`(마지막으로 본 지 TTL 넘은 차량 제거), `snapshot(kind: "subway" | "bus", now: number): { generatedAt: number; staleSince: number | null; vehicles: unknown[] }`, `save(): SavedState`(JSON 직렬화 가능), `busPrev(routeId): ReadonlyMap<string, { sourceAt; shapeDistanceM }>`(Task 7 입력).
  - 열차 키 `${lineKey}|${rawTrainNo}`, 차량 키 `${routeId}|${vehId}`.

- [ ] **Step 1: 실패하는 테스트**
  - `emits transitions only on change`: 같은 관측 두 번 → 두 번째 전이 0건. status만 바뀌면 1건.
  - `restores from saved state without re-emitting`: `save()` → 새 `LatestState(saved)` → 같은 관측 → 전이 0건.
  - `keeps vehicles through a brief empty response`: 관측 후 `markSourceEmpty("subway", t+60s)` → 스냅샷에 열차 그대로, `staleSince = t+60s`. `expire(t+301s)` → 그 열차 사라짐.
  - `bus emits only new dataTm`: 같은 `sourceAt` 차량 → 0건.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime/src/state.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): track latest vehicle state and transitions`

---

### Task 9: 스케줄과 예산

**Files:**
- Create: `packages/realtime/src/budget.ts`, `src/schedule.ts`, 각 `*.test.ts`

**Interfaces:**
- Consumes: Task 5 `isOperatingTime`, `nextOperatingStart`, `kstDayStart`, `kstParts`
- Produces:
  - `interface CollectorConfig { mode: "dev" | "prod"; operatingStart: string; operatingEnd: string; dailyBudget: { subway: number; bus: number }; subwayMinIntervalMs: number; busMinIntervalMs: number; busRouteIds: string[]; subwayLines: string[] }` — `devConfig(env)`: subway 최소 간격 80_000, bus 노선당 최소 간격 160_000, `busRouteIds = ["100100290", "100100029"]`, `subwayLines` 미사용(ALL). `prodConfig(env, routeIds)`: subway 20_000(19개 노선 위치 API), bus 30_000, 초당 10건 토큰 버킷.
  - `interface BudgetState { kstDay: string; used: { subway: number; bus: number } }`, `consume(state: BudgetState, kind, now: number, count?: number): BudgetState`(날이 바뀌면 0부터), `remaining(state, kind, config, now): number`
  - `remainingOperatingMs(now: number, config): number` — 지금부터 그 KST 날의 남은 운행 시간(00:00~01:00, 05:00~24:00 구간 합).
  - `interval(kind, now, budget, config): number` = `max(최소 간격, remainingOperatingMs / max(1, remaining))`. dev 버스는 노선 수로 나눠 노선별 간격.
  - `interface ScheduleState { nextAt: Record<string, number> }`(키 `subway`, `bus:<routeId>`, prod는 `subway:<lineNameKo>`), `planTick(now: number, schedule: ScheduleState, budget: BudgetState, config): { due: CallPlan[]; nextAlarmAt: number }` — `CallPlan = { kind: "subway-all" } | { kind: "subway-position"; lineNameKo: string } | { kind: "bus"; routeId: string }`. 운행 시간 밖이면 `due: []`, `nextAlarmAt = nextOperatingStart`. 예산 0이면 그 소스 제외. `nextAlarmAt`은 due가 아닌 것들의 최소 `nextAt`(최소 5초 뒤).

- [ ] **Step 1: 실패하는 테스트**
  - `dev budget spreads over the operating day`: 05:00 KST, 사용 0 → 지하철 간격 80_000(72,000초/900 = 80초), 버스 노선별 160_000.
  - `stretches when budget runs short`: 12:00에 지하철 800건 사용 → 간격 = 남은 운행 시간/100.
  - `budget resets at kst midnight but polling continues until 1am`: 23:59(사용 900) → 지하철 due 없음, 00:01 → 사용 0으로 초기화, due에 `subway-all`.
  - `sleeps until 5am outside operating hours`: 01:30 → `due: []`, `nextAlarmAt` = 05:00 KST.
  - `alternates the two dev bus routes`: 05:00부터 시뮬레이션 1시간 → 두 노선 호출 수 차이 ≤ 1, 합 약 45(3600/80).
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime/src/budget.test.ts packages/realtime/src/schedule.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): schedule polling within the daily budget`

---

### Task 10: 이력 버퍼 (R2 gzip NDJSON)

**Files:**
- Create: `packages/realtime/src/history.ts`, `history.test.ts`

**Interfaces:**
- Consumes: Task 5 `kstParts`, `redactKeys`
- Produces:
  - 상수 `HISTORY_FLUSH_BYTES = 8 * 1024 * 1024`(압축 전), `HISTORY_FLUSH_MS = 300_000`
  - `interface RawRecord { source: string; request: string; fetchedAt: number; status: number | null; bodyHash: string; body?: string }`(`request`는 이미 키를 지운 URL)
  - `sha256Hex(text: string): Promise<string>`(WebCrypto)
  - `class HistoryBuffer` — `constructor(prefix: "raw" | "events", keys: readonly string[])`, `add(stream: string, at: number, record: object): void`(넣기 전에 직렬화한 줄에 `redactKeys`), `due(now: number): boolean`, `flush(now: number, nextPart: (hourKey: string) => number): Promise<{ key: string; body: Uint8Array }[]>` — 키 `${prefix}/${stream}/${YYYY}/${MM}/${DD}/${HH}-${part}.ndjson.gz`(KST, 레코드 시각 기준으로 시간별로 나눔), 본문은 `CompressionStream("gzip")`.
  - `dedupeRaw(prevHash: string | undefined, record: RawRecord): RawRecord` — 해시가 같으면 `body` 제거.

- [ ] **Step 1: 실패하는 테스트**
  - `writes hourly gzip ndjson`: 12:59와 13:01 KST 레코드 → 키 2개(`.../12-0.ndjson.gz`, `.../13-0...`), `DecompressionStream`으로 풀면 각 1줄 JSON.
  - `drops identical bodies`: 같은 해시 두 번째 → `body` 없음, `bodyHash` 있음.
  - `redacts keys before buffering`: 키가 든 레코드 → 풀어 본 내용에 키 원문·인코딩 없음.
  - `flushes on size or time`: 8MB 넘으면 `due`, 5분 지나면 `due`.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime/src/history.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): buffer raw and event history as hourly gzip ndjson`

---

### Task 11: 지표·상태·일일 보고서·알림 판단·FCM

**Files:**
- Create: `packages/realtime/src/metrics.ts`, `src/alerts.ts`, 각 `*.test.ts`

**Interfaces:**
- Consumes: Task 5 `UpstreamOutcome`, `isOperatingTime`; Task 6·7 관측
- Produces:
  - 상수 `DELAYED_AFTER_MS = 300_000`, `STALLED_AFTER_MS = 900_000`, `ALERT_REPEAT_MS = 1_800_000`, `METRICS_RETENTION_DAYS = 7`
  - `interface MetricsBucket { bucketStart: number; source: string; calls: number; errors: Partial<Record<UpstreamOutcome, number>>; maxFreshnessMs: number | null; vehicles: Record<string, number>; matched: Record<string, number>; observed: Record<string, number>; backwards: number; unknownStations: number }`(5분 단위, `source`는 `subway` | `bus`, 노선별 키는 lineKey 또는 routeId)
  - `recordCall(bucket: MetricsBucket | undefined, now: number, source, outcome: UpstreamOutcome, observations: readonly (SubwayObservation | BusObservation)[]): MetricsBucket`
  - `type CollectorHealth = "ok" | "delayed" | "stalled" | "off-hours"`; `sourceHealth(lastSuccessAt: number | null, now: number, config): CollectorHealth`
  - `interface CollectorStatus { generatedAt: number; mode; overall: CollectorHealth; sources: { name; health; lastSuccessAt; freshnessMs; usedToday; remainingToday; errorsToday: Partial<Record<UpstreamOutcome, number>> }[]; lines: { key; vehicles; baselineRatio: number | null; matchRate: number | null; unknownStations: number; backwards: number }[]; series: MetricsBucket[] }` — `buildStatus(...)`. `baselineRatio` = 지금 차량 수 / 지난 7일 같은 5분 시각 평균(데이터 없으면 null).
  - `buildDailyReport(operatingDate: string, buckets: MetricsBucket[], config): DailyReport` — 운행일 `operatingDate` 05:00 ~ 다음날 01:00. `{ operatingDate; stalledIntervals: { source; from; to }[]; calls; errors; lines: { key; avgVehicles; matchRate }[]; ok: boolean }`(`ok` = 소스별 `stalledIntervals` 없음 그리고 호출 수 ≤ 한도). 버킷이 없는 5분 칸이 15분(3칸) 이상 이어지면 그 구간을 stalled로 본다.
  - `alerts.ts`: `type AlertKind = "stalled" | "auth" | "recovered"`, `decideAlerts(prev: AlertState, status: CollectorStatus, authFailedAt: number | null, now): { send: { kind: AlertKind; title: string; body: string }[]; next: AlertState }` — 같은 종류 30분에 1번, stalled → ok가 되면 recovered 1번. 문구: stalled `"Betro 수집 멈춤"` / `"<소스> 수집이 15분 넘게 멈췄습니다."`, auth `"Betro 키 오류"` / `"<소스> API가 401을 돌려줬습니다."`, recovered `"Betro 수집 회복"` / `"<소스> 수집이 다시 정상입니다."`.
  - `fcmAccessTokenRequest(serviceAccountJson: string, now: number): Promise<Request>` — RS256 JWT(`iss` = client_email, `scope` = `https://www.googleapis.com/auth/firebase.messaging`, `aud` = `https://oauth2.googleapis.com/token`, `iat`, `exp` = iat+3600), WebCrypto `RSASSA-PKCS1-v1_5`/`SHA-256`으로 서명한 `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` POST.
  - `fcmSendRequest(projectId: "betro-a77a2", accessToken: string, deviceToken: string, title: string, body: string): Request` — `POST https://fcm.googleapis.com/v1/projects/betro-a77a2/messages:send`.

- [ ] **Step 1: 실패하는 테스트**
  - `health thresholds`: 운행 중 마지막 성공 4분 전 → ok, 6분 → delayed, 16분 → stalled. 02:00 → off-hours.
  - `daily report finds a stalled gap`: 05:00~01:00 버킷 중 10:00~10:20 지하철 버킷 없음 → `stalledIntervals` 1개, `ok: false`. 빈칸 없음 → `ok: true`.
  - `alerts are deduplicated and recover once`: stalled 상태 0분, 10분 → 알림 1번. 31분 → 1번 더. ok가 되면 recovered 1번, 그 뒤 없음.
  - `signs a verifiable fcm jwt`: 테스트에서 만든 RSA 키쌍의 서비스 계정 JSON → 요청 본문의 JWT를 공개키로 검증 성공, 클레임 값 일치.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/realtime/src/metrics.test.ts packages/realtime/src/alerts.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(realtime): compute collector health, daily reports and alerts`

---

### Task 12: `CollectorCore`, Durable Object, Worker 라우트, cron 감시

**Files:**
- Create: `apps/server/src/collector/ports.ts`, `core.ts`, `core.test.ts`, `durable-object.ts`, `cf-ports.ts`, `apps/server/src/status-page.ts`, `status-page.test.ts`
- Modify: `apps/server/src/app.ts`, `app.test.ts`, `apps/server/src/index.ts`, `apps/server/wrangler.jsonc`, `apps/server/package.json`(deps `@Betro/realtime`)

**Interfaces:**
- Consumes: Task 5~11 전부, Task 3 `createApp`
- Produces:
  - `ports.ts`:
    - `interface StateStore { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; putMetrics(bucket: MetricsBucket): Promise<void>; metricsSince(t: number): Promise<MetricsBucket[]>; pruneMetrics(before: number): Promise<void> }`
    - `interface BlobStore { put(key: string, body: Uint8Array, contentType: string): Promise<void> }`
    - `interface ReferenceSource { currentBatchIds(): Promise<Record<ReferenceBatchKind, number>>; loadSubway(): Promise<SubwayReference>; loadBus(routeIds: string[], withShapes: boolean): Promise<BusReference> }`
    - `interface Upstream { fetch(url: string): Promise<{ status: number | null; body: string; error?: string }> }`(타임아웃 10초, 던지지 않음)
    - `interface Notifier { send(title: string, body: string): Promise<void> }`
  - `core.ts`: `class CollectorCore` — `constructor(ports: { state; blobs; reference; upstream; notifier; clock: () => number; keys: { subway: string; bus: string }; config: CollectorConfig; log: (line: string) => void })`, `tick(): Promise<{ nextAlarmAt: number }>`(복원 → 참조 배치 확인·필요시 재로딩 → `planTick` → 호출(실패 시 1초·2초 백오프로 최대 2번 재시도, 각 시도를 예산에 셈) → 분류 → 정규화 → `LatestState` → 이력 버퍼 → 지표 → 저장 → 필요시 flush → 운행일이 끝났으면 일일 보고서 `reports/<YYYY-MM-DD>.json` → 알림 판단), `snapshot(kind)`: `{ etag: string; body: string }`(`etag` = 본문 sha256 앞 16자), `status(): Promise<CollectorStatus>`, `healthCheck(): Promise<void>`(cron용: 알림 판단만, 상태 저장). `auth` 결과가 나오면 그 소스는 그날 멈춘다(다음 KST 날 다시 시도). `service-ended`(버스 headerCd 8)면 그 노선의 `nextAt`을 10분 뒤로 미룬다(수집 설계 7.2의 "10분마다 확인". 다음 05:00까지 쉬면 일일 보고서가 그 구간을 멈춤으로 잡고 멈춤 알림이 계속 나가므로). 401로 그날 멈춘 소스는 멈춤 알림 판단에서 뺀다(키 오류 알림이 따로 나감). `no-data`면 `LatestState.markSourceEmpty`. 모든 로그 줄은 `redactKeys`를 거친다.
  - `durable-object.ts`: `export class Collector extends DurableObject<Env>` — `fetch`는 쓰지 않고 RPC 메서드 `start()`(alarm이 없으면 지금으로 설정), `snapshot(kind)`, `status()`, `healthCheck()`(alarm이 없으면 다시 건다); `alarm()`은 `core.tick()` 후 `setAlarm(nextAlarmAt)`. DO 안에서 `CollectorCore`는 한 번만 만든다.
  - `cf-ports.ts`: DO SQLite(`ctx.storage.sql`, 테이블 `kv(key TEXT PRIMARY KEY, value TEXT)`, `metrics_5m(bucket_start INTEGER, source TEXT, value TEXT, PRIMARY KEY(bucket_start, source))`), R2 `env.DATA.put`, D1 `createD1Db(env.DB)`에서 현재 배치 행 읽기, fetch(`AbortSignal.timeout(10_000)`), FCM Notifier(`fcmAccessTokenRequest` → 토큰을 50분 캐시 → `fcmSendRequest`). `UPSTREAM_MODE=fixture`면 `Upstream`이 `packages/realtime/src/__fixtures__` 표본을 돌려준다.
  - `CollectorClient`(Task 3 `AppDeps.collector`) = DO 스텁 `env.COLLECTOR.get(env.COLLECTOR.idFromName("collector-v1"), { locationHint: "apac" })`.
  - 라우트(Task 3 `createApp`에 추가): API 호스트 `GET /v1/snapshot/:kind`(`subway` | `bus`, 그 외 404) → `Cache-Control: public, max-age=10`, `ETag`, `If-None-Match` 같으면 304. 상태 호스트 `GET /` → `renderStatusPage(status)` HTML, `GET /status.json` → JSON(`Cache-Control: no-store`).
  - `status-page.ts`: `renderStatusPage(status: CollectorStatus): string` — 한 장짜리 HTML(맨 위 요약, 소스 표, 노선 표, 24시간 인라인 SVG 선 그래프 3개). 외부 스크립트 없음. 시각은 KST로 표시.
  - `index.ts`: `scheduled`는 5분마다(`crons: ["*/5 * * * *"]`) `collector.healthCheck()`. `fetch` 첫 요청에서 `collector.start()`를 부르지 않는다(시작은 Task 13에서 한 번 수동 호출 `POST /internal/collector/start`를 상태 호스트에만 둔다).
  - `wrangler.jsonc` 추가: `durable_objects.bindings: [{ name: "COLLECTOR", class_name: "Collector" }]`, `migrations: [{ tag: "v1", new_sqlite_classes: ["Collector"] }]`, `r2_buckets: [{ binding: "DATA", bucket_name: "betro-data" }]`, `triggers.crons: ["*/5 * * * *"]`, vars `COLLECTOR_MODE: "dev"`, `UPSTREAM_MODE: "live"`(로컬 `.dev.vars`는 `fixture`).

- [ ] **Step 1: 실패하는 테스트** — `core.test.ts`(모든 포트는 메모리 가짜, 시계는 수동)
  - `polls and stores within budget`: 05:00부터 시계를 80초씩 옮기며 `tick` 1시간 → 지하철 호출 45 이하, 버스 합 45 이하, R2에 `raw/subway-all/...`, `events/subway/...` 키 생김.
  - `survives a restart`: 30분 돌리고 같은 `StateStore`로 새 `CollectorCore` → 그날 사용량이 이어짐, 같은 표본 응답에 `events` 새 줄 0.
  - `never leaks keys`: 키가 `a/b+c=`이고 가짜 `Upstream`이 URL을 담은 오류 문자열과 키가 든 본문을 돌려줌 → `log`에 넘어간 모든 줄, R2에 쓴 모든 본문(풀어서), `status()` JSON에 키 원문·인코딩 없음.
  - `stops a source after 401 and alerts once`: 지하철 401 → 그날 지하철 호출 더 없음, Notifier 1회("Betro 키 오류").
  - `writes the daily report at the end of the operating day`: 01:00을 넘기는 `tick` → `reports/<운행일>.json` 1개.
  - `rests a bus route after service-ended`: 6411이 headerCd 8 → 6411은 10분마다만 호출, 150은 계속. 두 노선 모두 service-ended여도 멈춤 알림 없음.
  - `app.test.ts` 추가: `serves snapshot with etag and 304`(가짜 `CollectorClient`), `status page only on status host`.
  - `status-page.test.ts`: `renders summary and tables`(멈춤 상태 → "멈춤" 문구, 노선 행 수 = `lines` 수, `<script` 없음).
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server` / Expected: FAIL
- [ ] **Step 3: 구현** — `durable-object.ts`와 `cf-ports.ts`는 `cloudflare:workers`를 쓰므로 bun 테스트에서 import하지 않는다. 테스트는 `core.ts`, `app.ts`, `status-page.ts`만.
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 5: 로컬 확인(상류 호출 없음)** — Run: `cd apps/server && bun run dev`(= `wrangler dev --infer-origin-from-routes=false`, 이 플래그가 없으면 wrangler가 Host 헤더를 첫 route로 바꾼다)(`.dev.vars`에 `UPSTREAM_MODE=fixture`) → `curl -X POST -H 'Host: betro-status.cmu02-studio.com' localhost:8787/internal/collector/start` → 잠시 뒤 `curl -H 'Host: betro-status.cmu02-studio.com' localhost:8787/status.json` / Expected: 지하철·버스 `lastSuccessAt` 값 있음, 로컬 R2에 객체 생김.
- [ ] **Step 6: 커밋** — `feat(server): run the realtime collector in a Durable Object`

---

### Task 13: 배포, 하루 운행, 완료 판정, 문서

**Files:**
- Modify: `packages/realtime/README.md`(생성), `apps/server/README.md`(생성 또는 수정), `docs/superpowers/plans/2026-11-04-phase4-realtime-collector.md`(결과 기록)

- [x] **Step 1: R2와 수명 주기** — Run: `bunx wrangler r2 bucket create betro-data`, 수명 주기 규칙 `raw/` 30일 삭제, `events/` 365일 삭제(`wrangler r2 bucket lifecycle add`) / Expected: `wrangler r2 bucket lifecycle list betro-data`에 규칙 2개.
- [x] **Step 2: secret** — `SEOUL_OPEN_API_KEY`, `DATA_GO_KR_API_KEY`는 `packages/transit-static/.env`에서 표준입력으로 넣는다(화면 출력 없음). `FCM_SERVICE_ACCOUNT_JSON`(Firebase 콘솔 → 서비스 계정 → 새 비공개 키, 사용자가 받아 경로를 알려줌, 저장소 밖 보관), `ALERT_FCM_TOKEN`(사용자 기기 dev 빌드 로그의 `[push] FCM token`). Expected: `wrangler secret list`에 5개(`BETTER_AUTH_SECRET` 포함).
- [x] **Step 3: Cloudflare Access(사용자)** — 사용자에게 Zero Trust 대시보드에서 `betro-status.cmu02-studio.com` 자체 호스팅 앱을 만들고, 정책을 사용자 이메일 1개 허용으로 걸어 달라고 요청한다. Expected: 시크릿 창에서 상태 페이지가 로그인 화면으로 막힘, `https://betro.cmu02-studio.com/`은 그대로 `OK`.
- [x] **Step 4: 배포와 시작** — Run: `bunx wrangler deploy` → Access 로그인한 브라우저(또는 Access 서비스 토큰)로 `POST https://betro-status.cmu02-studio.com/internal/collector/start` / Expected: 5분 안에 상태 페이지 지하철·버스가 "정상", `wrangler tail`에 키가 없는 로그.
- [x] **Step 5: 알림 확인** — `wrangler secret put DATA_GO_KR_API_KEY`에 일부러 틀린 값을 넣어 401을 만들고 알림("Betro 키 오류")을 확인한 뒤 원래 값으로 되돌린다. 틀린 키 호출은 1~3건으로 끝난다. Expected: 휴대폰 알림 1회, 되돌린 뒤 다음 KST 날부터 버스 재개(그날은 멈춘 상태가 맞음 — 시험은 운행 끝 무렵에 한다).
- [x] **Step 6: 하루 운행** — 운행일 하나(05:00~01:00)를 그대로 둔다. 그동안 수집기 밖에서 실시간 오퍼레이션을 부르지 않는다. 다음날 `reports/<운행일>.json`을 R2에서 받는다. Expected: `ok: true`(멈춤 구간 없음, 호출 수 ≤ 1,000), 노선별 매칭률과 7호선 매칭률이 기록됨.
- [x] **Step 7: 확인 항목** — 완료 기준(4단계 설계 9장) 1~5를 하나씩 확인한다. 특히 R2에서 원본 몇 개를 받아 두 키 원문이 없는지 `grep`. 결과(일일 보고서 요약, 7호선 매칭률, R2 하루 용량, Workers 사용량)를 이 계획 문서 "계획 중 확인한 사실" 아래 "4단계 결과"로 적는다.
- [x] **Step 8: 문서** — `packages/realtime/README.md`(모듈 지도, 규칙, 플래그 목록), `apps/server/README.md`(로컬 개발 `.dev.vars`, `UPSTREAM_MODE`, 배포, secret, D1 마이그레이션, `publish:d1` 순서, 수집기 시작·중지, 상태 페이지, 비용 확인). 커밋: `docs: record phase 4 run and document the collector`

#### Task 13 진행 기록 (2026-11-04)

- Step 1: R2 `betro-data`(APAC), 수명 주기 `raw/` 30일·`events/` 365일.
- Step 2: secret 5개(`secret_text`)를 첫 `wrangler deploy --secrets-file`로 넣었다. `BETTER_AUTH_SECRET`은 운영용으로 새로 만들었다(`.dev.vars` 값 아님). FCM 키는 gcloud로 만든 `firebase-adminsdk-fbsvc` 키(저장소 밖 `~/Documents/Betro-APNs/`).
- Step 3: Access 앱 "Betro status"(팀 `wandering-recipe-46f0`), 정책 "Allow owner" = `hyeonjun1968@naver.com` 1개. 비로그인 요청은 Access 로그인으로 302, `https://betro.cmu02-studio.com/`은 `OK`, `www`·`cleanbreath` DNS 그대로. 터미널에서는 `cloudflared access curl`로 상태를 본다.
- Step 4: `betro-server` 첫 배포(버전 5cd12c54, Task 3에서는 원격 D1 마이그레이션까지만 했고 Worker는 이때 처음 올라갔다). 20:18 KST `POST /internal/collector/start`. 5분 뒤 지하철·버스 `ok`, 실행 12건 모두 `ok`, tail 로그에 두 키(원문·URL 인코딩) 0건. 지하철 19개 노선 차량 확인, 매칭률은 대부분 1.0, 수인분당 0.77·경춘 0.84, 신분당·GTX-A는 `null`.
- Step 5 (일부): 20:38 틀린 버스 키 → 20:39 `bus:100100290 auth status=401` 1건, `bus stopped for the day: auth`, `alert sent: Betro 키 오류`. 20:40 원래 키로 되돌림. 기기 수신은 확인하지 못했다(알림 대상 iOS 앱을 사용자가 지운 상태였음 → 다시 설치하고 토큰을 바꿔 확인). 20:55쯤 iOS dev 빌드를 다시 설치하고 새 토큰(`emmE_CWl…`)으로 `ALERT_FCM_TOKEN`을 바꾼 뒤, 같은 서비스 계정·`fcmSendRequest`로 시험 메시지를 보냄 → OAuth 200, send 200, 사용자 기기 수신 확인.
- R2 이력 (20:18~20:43, 약 25분): 객체 73개(`raw/subway-all` 20조각, `raw/bus-*` 17, `events/subway` 20, `events/bus` 16), raw 3.98 MB·events 0.30 MB(gzip). 풀어서 8,593줄 전부에 두 키 원문·URL 인코딩·시험용 틀린 키 0건. 요청 URL은 `serviceKey=<key>`로 남는다. 어림: raw 약 190 MB/운행일(30일 보관 ≈ 5.6 GB), events 약 14 MB/운행일(365일 ≈ 5 GB). 하루 운행 보고서로 다시 잰다.
- 알게 된 점: 상태 페이지는 401로 그날 멈춘 소스를 따로 표시하지 않는다. 신선도 기준으로 `ok → delayed → stalled`가 되고, 멈춤 알림만 막는다. 단서는 `errorsToday.auth`뿐(후속 개선 후보).

#### 이월 확인 항목 (시간이 지나야 확인 가능)

- [x] **2026-11-04 밤**: 다시 설치한 iOS dev 빌드의 새 FCM 토큰으로 `ALERT_FCM_TOKEN`을 바꾸고, 같은 서비스 계정으로 FCM 시험 메시지를 직접 보내 기기 수신을 확인한다(키를 다시 틀리게 넣지 않는다 — 11/5 하루 운행이 멈춘다).
- [x] **2026-11-05 05:00 이후**: 버스 수집 재개 확인(`cloudflared access curl …/status.json`에서 bus `usedToday` 증가, `errorsToday` 비어 있음). 되돌린 키가 맞는지도 이것으로 확인된다.
- [x] **2026-11-05 아침**: `reports/2026-11-04.json` 미리보기. 20:18부터의 반나절이고 버스가 401로 멈췄으므로 `ok: false`가 맞다. 형식, 노선별 매칭률, 호출 수 집계만 본다.
- [x] **2026-11-05 05:00 ~ 11-06 01:00**: Step 6 하루 운행. 그동안 수집기 밖에서 실시간 오퍼레이션을 부르지 않는다.
- [ ] **2026-11-06**: `reports/2026-11-05.json`으로 Step 6 판정(`ok: true`, 호출 수 ≤ 1,000), 이어서 Step 7·8과 `develop` PR.

2026-11-10에 한꺼번에 확인했다. 결과는 위 "4단계 결과"에 있다.

- 버스 재개: `reports/2026-11-05.json`에서 버스 899건, 오류 없음. 되돌린 키가 맞다.
- `reports/2026-11-04.json`: `ok: false`(20:18 시작 전 구간과 버스 401 뒤 구간이 멈춤으로 잡힘), 지하철 211건, 버스 62건, 버스 `auth` 1건. 예상한 그대로다.
- Step 6: `reports/2026-11-05.json` `ok: true`, 지하철 899건, 버스 899건, 멈춤 구간 없음. 판정 기준은 통과했지만 그날 이력의 1.4~2.0%가 R2에 쓰이지 않았다.
- Step 7·8: 완료 기준 확인과 README 2개는 끝났다. 이력 누락 수정은 배포했고 PR #12를 열었다. 배포 뒤 운행일 하나의 재확인이 남았다.
