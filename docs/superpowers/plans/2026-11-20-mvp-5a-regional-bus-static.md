# MVP 5-A 경기·인천 버스 정적 데이터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울에 들어오지 않는 경기·인천 노선과 경기 마을버스를 정적 데이터로 적재합니다. 그래서 경로 등록(16)에서 고를 수 있고, 지도에는 선과 정류장이 나오며 "실시간 정보 없음"으로 표시됩니다. 출퇴근 세션은 배차간격으로 추정합니다.

**Architecture:**
- 경기는 GBIS, 인천은 TAGO에서 노선, 경유 정류장, 첫차·막차, 배차간격을 받습니다.
- 받은 데이터는 기존 `bus_route*` 테이블에 `source` 열을 더해 함께 담습니다. 노선·정류장 ID는 출처 접두사(`gbis:`, `tago:`)로 구분합니다.
- 실시간 연결(수집기와 세션 실행기의 GBIS·TAGO 어댑터)은 5-B에서 합니다.

**Tech Stack:** Bun, TypeScript, Drizzle(libsql, D1), Hono, Expo(React Native), bun:test.

**Spec:**
- `docs/superpowers/specs/2026-11-05-mvp-design.md`: 3장 "버스 범위", 5.10, 6장
- `docs/superpowers/specs/2026-11-20-mvp4-map-design.md`: 2.7, 8장 순서 2
- `docs/research/2026-11-06-mvp2-experiments.md`: 1절. 아래에서 "실험 1절"로 부릅니다.
- 지도 설계 8장에 따라 별도 설계 문서는 쓰지 않습니다.

**Branch:** `feat/regional-bus-static`. 지금은 `feat/mvp4-map` 위에서 시작하고, PR #24가 develop에 머지되면 develop 위로 rebase합니다.

## 사용자 결정 (2026-11-20)

- **출처 배분:** 경기 노선은 마을버스를 포함해 GBIS, 인천 노선은 TAGO에서 받습니다. 서울에 들어오는 경기·인천 노선(routeType 7·8)은 지금처럼 서울 API로 받습니다(MVP 설계 3장).
- **계획 분할:** 이 계획은 정적 데이터, 참조 API, 경로 등록, 지도의 "실시간 정보 없음"까지입니다. 실시간 어댑터는 5-B입니다.

## 설계 판단 (이 계획에서 정함)

1. **ID 형식.** 서울 노선과 섞이지 않게 출처를 접두사로 붙입니다. 2-D 계획 30행과 transit-static README 276행에서 이미 예약해 둔 형식입니다.

   | 출처 | 노선 ID | 정류장 ID |
   |---|---|---|
   | GBIS | `gbis:<routeId>` | `gbis:<stationId>` |
   | TAGO | `tago:<routeid>` (예: `ICB165000012`) | `tago:<nodeid>` |

   GBIS의 ID는 서울 ID와 같은 값이지만 접두사로 출처를 나눕니다.
2. **중복 제거.** 서울 노선 목록에 있는 노선(서울에 들어오는 7·8)은 서울 쪽이 이깁니다. 지금 저장된 장소의 `seoul-bus:` 참조가 그대로 살아야 하기 때문입니다.
   - GBIS 노선은 `routeId`가 서울 `bus_route.route_id`에 있으면 버립니다.
   - TAGO 노선은 Task 1에서 정한 규칙으로 버립니다. 규칙은 `ICB` 변환으로 같은 정류장 열이 되는지 보는 것입니다.
3. **노선 모양.** 두 출처 모두 모양 API가 없으므로 경유 정류장 좌표를 순서대로 이은 선을 씁니다(실험 1절). 정류장 거리는 이 선 위의 누적 거리이고, `offset_m`과 `api_sect_dist_m`은 0입니다. 출처 표기는 GBIS가 `경기도 버스정보(GBIS)`, TAGO가 `국토교통부 TAGO`입니다.
4. **범위.** GBIS 노선 유형 중 시외·고속·공항(41, 42, 43, 51, 52, 53)은 뺍니다. 서울 쪽에서 공항버스를 빼는 것과 같은 기준입니다. 코드표는 Task 1에서 확인합니다.
5. **지역 이름.** `bus_route.area_name`을 더합니다. GBIS는 `regionName`의 첫 시·군, TAGO는 `인천`입니다. 같은 번호가 시·군마다 있기 때문입니다(`11`번 마을버스가 다섯 곳에 있음).
6. **수집기 상시 관측.** `source = 'seoul'`인 노선만 대상입니다. 지도 설계 2.7에 따라 GBIS·TAGO 노선은 보는 동안만 관측하며, 그 연결은 5-B입니다.
7. **호출 한도.** fetch job은 오퍼레이션마다 실행 한 번에 950건까지만 부릅니다. 원본 캐시에서 이어 받으므로, 여러 날에 나눠 받을 수 있습니다.

## Global Constraints

- 커밋 메시지와 PR 본문에 AI 서명·출처 표기(`Co-Authored-By`, `Claude-Session:`, 세션 URL)를 넣지 않습니다.
- 비밀값은 화면, 로그, 원본 파일 이름, 보고서에 남기지 않습니다(`DATA_GO_KR_API_KEY` 등). URL을 로그에 쓸 때는 `maskKey`를 씁니다.
- lint 게이트는 `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`입니다. 루트 `bunx ultracite fix/check`는 돌리지 않습니다.
- 앱 화면 문구는 `lib/i18n/messages-ko.ts` 키로만 씁니다(no-hardcoded-copy 테스트). 확정 표현("놓쳐요", "늦어요")은 쓰지 않습니다.
- 앱 코드에 `toSorted`, `toReversed`, `toSpliced`, `findLast`, `findLastIndex`를 쓰지 않습니다(`apps/native/lib/hermes-compat.test.ts`).
- `session/*`에는 출처 이름(`seoul-`, `gbis`, `tago`) 문자열을 넣지 않습니다. 출처 이름은 `packages/commute/src/sources/`와 `refs.ts`에만 둡니다(2-C 규칙).
- 원격 D1, `publish:d1 --remote`, `wrangler deploy`, push, PR 머지는 사용자 확인 뒤에만 합니다.

## Review Focus

1. **같은 번호, 다른 시·군**(예: 마을버스 `11`): 검색 결과에 시·군별로 따로 나오고, 지역 이름으로 구분됩니다. 테스트는 Task 6, Task 8에 있습니다.
2. **서울에 들어오는 경기 노선이 GBIS에도 있을 때**(예: M5107 `234001243`): `seoul-bus:` 행 하나만 남고, 이미 저장된 장소의 참조가 그대로 풀립니다. 테스트는 Task 5에 있습니다.
3. **한도 소진·인증 실패로 fetch가 중간에 멈출 때:** 받은 원본은 남습니다. 다음 실행은 받은 것을 다시 부르지 않습니다. build는 받은 만큼만 적재하지 않고 비율 기준으로 막습니다. 테스트는 Task 3, Task 5에 있습니다.
4. **GBIS·TAGO 구간이 있는 출퇴근 세션:** tick이 예외 없이 돌고, 서울 도착 예산을 쓰지 않으며, 배차간격으로 "시간표 추정"을 냅니다. 테스트는 Task 7에 있습니다.
5. **GBIS·TAGO 구간을 지도에서 열 때:** 선과 승차·하차는 그려지고, 차량 없이 "실시간 정보 없음"이 뜹니다. 관측 요청(heartbeat)도 보내지 않습니다. 테스트는 Task 8에 있습니다.

## 사전 조건

- **API 키:** 공공데이터포털 개발 계정 키로 진행합니다. 운영 계정은 MVP 작업을 마친 뒤 신청합니다. **[사용자 결정, 2026-11-20]**
  - 2026-11-20 23:55 KST에 로컬 `packages/transit-static/.env`의 `DATA_GO_KR_API_KEY`로 호출해 보았습니다.
  - GBIS `getBusRouteListv2`, TAGO `getRouteNoList`(cityCode 23), 서울 `getBusPosByRtid`가 모두 200으로 응답했습니다.
- **하루 한도(개발 계정):** GBIS는 오퍼레이션마다 1,000건으로 봅니다. 서울 API와 같은 값입니다. **[사용자 확인, 2026-11-20]** TAGO는 10,000건입니다(실험 1절).
  - GBIS 노선은 약 2,200개입니다. 노선 정보와 경유 정류장을 각각 받아야 해서, 실행 한 번에 950건씩이면 사흘쯤 걸립니다.
  - Task 9 Step 1은 여러 날에 나눠 이어 받습니다.

---

### Task 1: API 확인과 테스트 자료 기록

GBIS와 TAGO는 저장소에 코드도 원본도 없습니다. 실제 응답을 한 번 받아 테스트 자료로 남기고, 남은 규칙 세 가지를 정합니다.

**Files:**
- Create: `packages/transit-static/scripts/probe-regional-bus.ts`
  - 일회성 스크립트입니다. 키는 `.env`에서 읽고 출력에는 `maskKey`를 씁니다.
- Create: `packages/transit-static/src/sources/__fixtures__/` 아래 아홉 파일
  - `gbis-route-list-11.json`
  - `gbis-route-info-241308701.json`
  - `gbis-route-stations-241308701.json`
  - `gbis-route-stations-234001243.json` (M5107, 중복 제거 확인용)
  - `tago-route-list-23.json`
  - `tago-route-info.json`
  - `tago-route-stations.json`
  - `gbis-error-quota.json`
  - `tago-error-auth.json`
  - 응답 원문을 그대로 두되, 키 값이 들어간 필드가 있으면 지웁니다.
- Modify: `docs/research/2026-11-06-mvp2-experiments.md`. 1절 끝에 "5-A 확인(2026-11-2x)" 단락을 더합니다.

- [ ] **Step 1: 스크립트로 아래 호출을 한 번씩 하고 응답을 테스트 자료로 저장합니다.**
  - GBIS `busrouteservice/v2/getBusRouteListv2?keyword=11`
  - GBIS `getBusRouteInfoItemv2?routeId=241308701`
  - GBIS `getBusRouteStationListv2?routeId=241308701`
  - GBIS `getBusRouteStationListv2?routeId=234001243`
  - TAGO `BusRouteInfoInqireService/getRouteNoList?cityCode=23&numOfRows=3000`
  - TAGO `getRouteInfoIem`, `getRouteAcctoThrghSttnList`: 목록의 첫 노선, `cityCode=23`
  - 실제 오퍼레이션 이름이 위와 다르면 실제 이름을 씁니다.
- [ ] **Step 2: 확인한 내용을 실험 문서 단락에 적습니다.**
  - 실제 오퍼레이션 이름과 필드 이름
  - GBIS 노선유형 코드표, 특히 시외·고속·공항 코드
  - GBIS `regionName`의 형식(여러 시·군일 때 구분자)
  - 배차간격·첫차·막차 필드(평일 기준)
  - 에러 봉투의 형태(한도 초과, 인증 실패)
  - TAGO 인천 노선 중 서울에 들어오는 것을 가려내는 규칙. 규칙은 "경유 정류장 `nodeid`를 `ICB` 역변환한 열이 서울 노선 하나의 `stId` 열과 같으면 서울 노선"으로 시작하고, 실제 응답으로 맞는지 봅니다.
  - GBIS 노선 목록을 다 받을 검색어 집합: `0`–`9`, `M`, `G`, `N`, `P`로 시작해 결과 합계를 적습니다.
- [ ] **Step 3: Commit**

```bash
git add packages/transit-static/scripts/probe-regional-bus.ts packages/transit-static/src/sources/__fixtures__/gbis-*.json packages/transit-static/src/sources/__fixtures__/tago-*.json docs/research/2026-11-06-mvp2-experiments.md
git commit -m "docs(research): record GBIS and TAGO route responses for the regional bus load"
```

### Task 2: GBIS·TAGO 응답 파서

**Files:**
- Create: `packages/transit-static/src/sources/gbis-api.ts`, `gbis-api.test.ts`
- Create: `packages/transit-static/src/sources/tago-api.ts`, `tago-api.test.ts`

**Interfaces:**
- Consumes: Task 1의 테스트 자료와 확인한 필드 이름.
- Produces:
  - 공통 행 타입:

    ```ts
    export interface RegionalRouteRow { routeId: string; name: string; routeTypeCode: string; areaName: string | null; cityCode: string | null }
    export interface RegionalRouteInfo { firstBusMinute: number | null; lastBusMinute: number | null; headwayMin: number | null }
    export interface RegionalStopRow { stationId: string; seq: number; name: string; lat: number; lng: number; arsId: string | null; turnSeq: number | null }
    export type RegionalEnvelope<T> = { ok: true; items: T[] } | { ok: false; reason: "no-data" | "quota" | "auth" | "temporary" | "malformed" }
    ```

  - GBIS 함수(`gbis-api.ts`):

    ```ts
    gbisUrl(operation: GbisOperation, params: Record<string, string>, key: string): string
    parseGbisRouteList(json: unknown): RegionalEnvelope<RegionalRouteRow>
    parseGbisRouteInfo(json: unknown): RegionalEnvelope<RegionalRouteInfo>
    parseGbisRouteStations(json: unknown): RegionalEnvelope<RegionalStopRow>
    ```

  - TAGO 함수(`tago-api.ts`): `tagoUrl`, `parseTagoRouteList`, `parseTagoRouteInfo`, `parseTagoRouteStations`. 모양은 GBIS와 같고 `cityCode`를 받습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다.** 테스트 자료로 아래를 확인합니다.
  - `parseGbisRouteStations(stations-241308701)`가 정류장 40개를 `seq` 1..40 순서로 내고, `lat`/`lng`가 숫자입니다.
  - `parseGbisRouteInfo`가 `headwayMin === 10`을 냅니다(`peekAlloc`, 실험 1절).
  - TAGO의 `gpslong`이 문자열로 와도 숫자로 읽습니다(실험 1절).
  - 에러 자료는 각각 `{ ok: false, reason: "quota" }`, `{ ok: false, reason: "auth" }`가 됩니다.
  - 빈 목록은 `no-data`입니다.
  - `gbisUrl` 결과를 `maskKey`로 가리면 키가 남지 않습니다.
- [ ] **Step 2:** `bun test packages/transit-static/src/sources/gbis-api.test.ts packages/transit-static/src/sources/tago-api.test.ts`를 돌립니다. Expected: 모듈이 없어 FAIL.
- [ ] **Step 3: 구현합니다.**
  - 시각 `HHmm`, `HH:mm`은 0시부터의 분으로 바꿉니다. 비었거나 0이면 null입니다.
  - 배열이 아닌 단일 항목 응답도 배열 하나로 감쌉니다.
- [ ] **Step 4:** 같은 명령을 돌립니다. Expected: PASS.
- [ ] **Step 5: Commit** `feat(static): parse GBIS and TAGO route responses`

### Task 3: 노선·정류장 받기 job

**Files:**
- Create: `packages/transit-static/src/jobs/fetch-regional-bus.ts`, `fetch-regional-bus.test.ts`
- Modify: `packages/transit-static/src/cli.ts`. `fetch:gbis-routes`, `fetch:tago-routes` 명령을 더합니다.

**Interfaces:**
- Consumes: Task 2의 URL·파서. 기존 `saveRaw`, `readRaw`, `rawPath`(`src/raw-store.ts`). 기존 상수 `BUS_REQUEST_DELAY_MS`, `BUS_CALLS_PER_OPERATION_PER_RUN`(`fetch-bus-routes.ts`, 100ms·950).
- Produces:
  - 함수:

    ```ts
    fetchRegionalRoutes(options: { source: "gbis" | "tago"; dataDir: string; key: string; fetchImpl?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void> }): Promise<FetchRegionalResult>
    ```

  - 결과 타입:

    ```ts
    export interface FetchRegionalResult { ok: boolean; routes: number; fetched: { list: number; info: number; stations: number }; stoppedBy: "quota" | "auth" | "budget" | null }
    ```

  - 원본 저장 경로:
    - `data/raw/gbis-route-list/<date>/<term>.json`, `gbis-route-info/<routeId>.json`, `gbis-route-stations/<routeId>.json`
    - `tago-route-list/<date>/23.json`, `tago-route-info/<routeid>.json`, `tago-route-stations/<routeid>.json`
    - 합친 목록은 `data/raw/<source>-route-list/<date>/routes.json`입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다.** 가짜 `fetchImpl`로 아래를 확인합니다.
  - 검색어별 목록을 합쳐 `routeId`로 중복을 지웁니다.
  - 이미 원본이 있는 노선은 다시 부르지 않습니다. `fetched.info === 0`인 두 번째 실행으로 확인합니다.
  - 한 오퍼레이션이 950건에 이르면 `stoppedBy: "budget"`으로 멈춥니다.
  - `quota` 응답이 오면 바로 `stoppedBy: "quota"`로 멈추고, 그때까지 받은 원본은 남깁니다.
  - 시외·고속·공항 유형은 경유 정류장을 받지 않습니다.
- [ ] **Step 2:** `bun test packages/transit-static/src/jobs/fetch-regional-bus.test.ts`를 돌립니다. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
  - 검색어는 Task 1에서 정한 집합입니다. TAGO는 `cityCode=23` 하나입니다.
  - 요청 사이에 `sleep(100)`을 둡니다.
- [ ] **Step 4:** 같은 명령을 돌립니다. Expected: PASS.
- [ ] **Step 5: Commit** `feat(static): fetch GBIS and TAGO routes and stops with resumable raw caching`

### Task 4: 스키마에 출처와 지역 이름 더하기

**Files:**
- Modify: `packages/db/src/schema/transit.ts`
  - `busRoute`에 아래 열을 더합니다.
    - `source: text("source").$type<BusSource>().notNull().default("seoul")`
    - `areaName: text("area_name")`
    - `sourceCity: text("source_city")`
  - 고유 인덱스를 `(batchId, source, routeId)`로 바꿉니다.
  - `export type BusSource = "seoul" | "gbis" | "tago"`를 더합니다.
- Create: `bun run --cwd packages/db db:generate`와 `db:d1-migrations`로 마이그레이션을 만듭니다. 이름은 `bus_route_source`입니다.
  - D1 쪽은 `packages/db/d1-migrations/0008_<ts>_bus_route_source.sql`입니다.
  - 기존 행은 `source = 'seoul'`입니다.
- Modify: `packages/transit-static/src/db/load.ts`, `src/db/export-sql.ts`. 새 열을 넣고 내보냅니다.
- Test: `packages/transit-static/src/db/load.test.ts`, `export-sql.test.ts`

- [ ] **Step 1: 실패하는 테스트를 씁니다.**
  - 같은 배치에서 `route_id`가 같고 `source`가 다른 두 노선이 함께 들어갑니다.
  - 내보낸 SQL에 `source`, `area_name`, `source_city`가 있습니다.
- [ ] **Step 2:** `bun test packages/transit-static/src/db/`를 돌립니다. Expected: FAIL.
- [ ] **Step 3:** 스키마를 바꾸고, 마이그레이션을 만들고, `load.ts`와 `export-sql.ts`를 고칩니다.
- [ ] **Step 4:** 같은 명령과 `bun run --cwd apps/server d1:migrate:local`을 돌립니다. Expected: PASS, 로컬 적용 성공.
- [ ] **Step 5: Commit** `feat(db): add source, area name and source city to bus routes`

### Task 5: 적재 조립과 중복 제거

**Files:**
- Create: `packages/transit-static/src/bus/regional.ts`, `regional.test.ts`
- Modify: `packages/transit-static/src/bus/assemble.ts`. `BUS_ROUTE_LOGIC_VERSION`을 6으로 올리고 버전 이력에 한 줄을 더합니다.
- Modify: `packages/transit-static/src/jobs/build-bus-routes.ts`
  - 서울 결과에 GBIS·TAGO 결과를 붙입니다.
  - manifest에 `gbisRouteList`, `tagoRouteList` 해시를 넣습니다.
- Modify: `packages/transit-static/src/bus/report.ts`. 출처별 적재·제외 수를 셉니다.
- Modify: `packages/transit-static/README.md`. 버전과 출처를 갱신합니다(README 258행의 "현재 4"도 고칩니다).

**Interfaces:**
- Consumes: Task 2의 행 타입, Task 3의 원본 경로, Task 4의 열. 기존 `AssembledBusRoute`(`assemble.ts:92`)의 모양.
- Produces:

  ```ts
  assembleRegionalRoute(input: { source: "gbis" | "tago"; route: RegionalRouteRow; info: RegionalRouteInfo | null; stops: RegionalStopRow[] }): { ok: true; route: AssembledBusRoute } | { ok: false; issue: BusIssue }
  dropSeoulDuplicates(regional: AssembledBusRoute[], seoul: { routeIds: ReadonlySet<string>; stopSequences: ReadonlyMap<string, string> }): { kept: AssembledBusRoute[]; dropped: number }
  regionalMinLoadableRatio = 0.9
  ```

  - `AssembledBusRoute`에 `source`, `areaName`, `sourceCity`를 더합니다.
  - 정류장 ID는 원본 그대로 둡니다. 접두사는 참조 API에서 붙입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다.**
  - **모양:** `assembleRegionalRoute`(GBIS, stations-241308701)의 모양 점이 정류장 40개 좌표와 같습니다. 정류장 `distanceM`이 단조 증가하고, 첫 값은 0입니다. `lengthM`은 마지막 정류장 거리와 같습니다.
  - **지역:** GBIS는 `region === "gyeonggi"`, TAGO는 `"incheon"`입니다.
  - **지역 이름:** `areaName`은 `regionName`의 첫 시·군입니다.
  - **불량 노선:** 정류장이 2개 미만이거나 좌표가 0인 정류장이 있으면 `ok: false`입니다.
  - **중복 제거:** stations-234001243(M5107)는 서울 `routeIds`에 `234001243`이 있으면 `dropped === 1`입니다.
  - **TAGO 중복 제거:** Task 1의 규칙대로 서울 정류장 열과 같은 노선이 빠집니다.
  - **적재 비율:** 출처별로 적재 가능한 노선이 90% 미만이면 build 결과가 `ok: false`이고 적재하지 않습니다.
- [ ] **Step 2:** `bun test packages/transit-static/src/bus/regional.test.ts packages/transit-static/src/jobs/build-bus-routes.test.ts`를 돌립니다. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
  - 거리는 `@turf/length`로 잽니다.
  - `qualityFlags`에 `shape-from-stops`를 넣습니다.
- [ ] **Step 4:** 같은 명령을 돌립니다. Expected: PASS.
- [ ] **Step 5: Commit** `feat(static): load GBIS and TAGO routes alongside Seoul routes`

### Task 6: 참조 API와 수집기의 출처 구분

**Files:**
- Modify: `apps/server/src/ref/ids.ts`

  ```ts
  busLine(source: BusSource, routeId: string): string
  busStop(source: BusSource, stationId: string): string
  parseBusRef(value: string): { source: BusSource; id: string }
  ```

  - `seoul`이면 `seoul-bus:`를 씁니다. 접두사가 없는 값은 `seoul`로 봅니다(기존 호출 호환).
- Modify: `apps/server/src/ref/bus.ts`, `apps/server/src/ref/routes.ts`, `apps/server/src/ref/map.ts`
  - 찾기는 `(source, route_id)`로 합니다.
  - 검색 결과와 정류장 응답에 `areaName: string | null`을 더합니다.
- Modify: `apps/server/src/collector/cf-ports.ts:324` `currentBusRouteIds`. 조건은 `source = 'seoul' AND route_type NOT IN ('7','8')`입니다.
- Modify: `apps/server/src/collector/cf-ports.ts` `loadBus`. 찾기를 `source = 'seoul'`로 좁힙니다. GBIS ID가 서울 ID와 겹치면 안 되기 때문입니다.
- Test: `apps/server/src/ref/bus.test.ts`, `map.test.ts`, `apps/server/src/collector/cf-ports.test.ts`(없으면 만듭니다)

- [ ] **Step 1: 실패하는 테스트를 씁니다.**
  - 검색어 `11`이 GBIS 마을버스 두 개(시·군이 다름)와 서울 노선을 함께 냅니다. GBIS 행의 `line`은 `gbis:<id>`, `areaName`은 각 시·군입니다.
  - `/v1/ref/bus/routes/gbis:<id>/stops`의 `stop`이 `gbis:<stationId>`입니다.
  - `/v1/ref/map/bus/gbis:<id>`는 모양과 정류장을 냅니다. `/v1/ref/map/bus/<id>`는 계속 서울 노선을 냅니다.
  - `currentBusRouteIds`에 GBIS·TAGO 노선이 들어가지 않습니다.
- [ ] **Step 2:** `bun test apps/server/src/ref apps/server/src/collector`를 돌립니다. Expected: FAIL.
- [ ] **Step 3:** 구현합니다. 테스트 시드(`ref/test-seed.ts`)에 GBIS 노선 둘을 더합니다.
- [ ] **Step 4:** 같은 명령과 `bun run --cwd apps/server check-types`를 돌립니다. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): serve GBIS and TAGO routes with source-prefixed ids`

### Task 7: 출퇴근이 GBIS·TAGO 구간을 받아들이게

**Files:**
- Modify: `packages/commute/src/refs.ts`. `SOURCE_IDS`에 `"gbis"`, `"tago"`를 더합니다.
- Modify: `packages/commute/src/refs.test.ts`. 21행의 `parseRef("tago:GGB1")`가 예외를 던진다는 테스트를, 통과한다는 테스트로 바꿉니다.
- Modify: `packages/commute/src/plan.ts:52`. `REF_PATTERN`을 `SOURCE_IDS`에서 만듭니다. 버스 구간은 `seoul-bus`, `gbis`, `tago`를 허용합니다.
- Modify: `packages/commute/src/sources/assemble.ts`
  - `adapterOf`가 `gbis`·`tago` 버스 구간에는 `{ kind: "scheduled-bus", leg }`를 돌려줍니다.
  - 이 어댑터는 `board`·`progress`가 null입니다.
  - `scheduledHeadwayMs`는 `raw.busSchedules[leg.line]`을 씁니다.
- Modify: `apps/server/src/commute/runner-core.ts`
  - `#rawBoards`와 `#routeView`는 `seoul-bus` 구간만 `#collectBus`를 부릅니다.
  - `#collectBusSchedules`는 키를 전체 노선 ID(`leg.line`)로 바꿉니다.
- Modify: `apps/server/src/commute/cf-ports.ts` `readBusSchedules`. `(source, route_id)`로 읽고 전체 노선 ID로 돌려줍니다.
- Test: `packages/commute/src/sources/assemble.test.ts`, `packages/commute/src/plan.test.ts`, `apps/server/src/commute/runner-core.test.ts`

**Interfaces:**
- Consumes: Task 4의 `source` 열, Task 6의 `parseBusRef`.
- Produces: `RawBoards.busSchedules`의 키가 전체 노선 ID입니다(`Record<LineRef, BusSchedule>`). 5-B는 `scheduled-bus` 자리에 실시간 어댑터를 넣습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다.**
  - `parsePlan`이 `gbis:` 구간을 받습니다. 노선과 정류장의 출처가 다르면 막습니다.
  - `gbis:` 구간 하나로 된 세션에서 `RunnerCore.tick`이 예외 없이 돕니다. 서울 도착 호출 수가 0이고 `budget:<day>`가 그대로입니다.
  - 배차간격 10분이면 승차 ETA가 "시간표 추정"(`method: "headway"`, 5분 뒤)입니다.
  - `routeView`도 같은 값을 냅니다.
  - `session/*`에 출처 문자열이 없다는 기존 검사가 계속 통과합니다.
- [ ] **Step 2:** `bun test packages/commute apps/server/src/commute`를 돌립니다. Expected: FAIL.
- [ ] **Step 3:** 구현합니다.
- [ ] **Step 4:** 같은 명령과 루트 `bun run check-types`를 돌립니다. Expected: PASS.
- [ ] **Step 5: Commit** `feat(commute): accept GBIS and TAGO legs and estimate them from the scheduled headway`

### Task 8: 앱의 등록 화면과 지도

**Files:**
- Modify: `apps/native/lib/ref/ref-client.ts`. 응답에 `areaName: z.string().nullable().default(null)`을 더합니다.
- Modify: `apps/native/lib/places/leg-picker-model.ts`
  - `gbis`·`tago` 노선의 부제는 `{areaName} {유형}`입니다(예: "고양 마을버스").
  - GBIS 유형 코드 → 문구 키는 Task 1의 코드표를 따릅니다(`legPicker.routeType.gbis.*`).
- Modify: `apps/native/lib/i18n/messages-ko.ts`. 유형 문구 키와 `map.noRealtime`("실시간 정보 없음")을 더합니다.
- Modify: `apps/native/lib/map/use-map-data.ts`
  - `loadRefMap`은 전체 노선 ID로 `/v1/ref/map/bus/<line>`을 부릅니다.
  - `gbis`·`tago` 구간은 `showVehicles: false`, `realtime: false`입니다.
  - heartbeat는 지금처럼 `seoul-bus:`만 보냅니다.
- Modify: `apps/native/lib/map/map-client.ts`. `fetchBusMap(client, line, etag)`가 전체 노선 ID를 받습니다.
- Modify: `apps/native/app/(tabs)/index.tsx`. 실시간이 없는 구간이 있으면 경로 알약 아래에 `map.noRealtime`을 띄웁니다.
- Modify: `apps/native/lib/transit/line-badge-model.ts`. GBIS·TAGO 배지 색은 `region`과 유형으로 정합니다. 마을버스는 기존 마을버스 색입니다.
- Test:
  - `apps/native/lib/places/leg-picker-model.test.ts`
  - `apps/native/lib/map/use-map-data` 관련 순수 함수 테스트(`map-labels.test.ts` 또는 새 `regional-legs.test.ts`)
  - `apps/native/lib/transit/line-badge-model.test.ts`

- [ ] **Step 1: 실패하는 테스트를 씁니다.**
  - 같은 `11`번 두 노선의 행 부제가 "고양 마을버스", "화성 마을버스"로 다릅니다.
  - 저장되는 구간의 `line`과 정류장이 `gbis:`로 시작합니다.
  - `gbis:` 구간의 지도 구간이 `showVehicles: false`이고, 안내 키가 `map.noRealtime`입니다.
  - heartbeat 대상에 `gbis:` 노선이 없습니다.
  - 지도 참조 요청 경로가 `/v1/ref/map/bus/gbis%3A<id>`입니다.
- [ ] **Step 2:** `bun test apps/native/lib`를 돌립니다. Expected: FAIL.
- [ ] **Step 3:** 구현합니다.
- [ ] **Step 4:** 같은 명령, `bun run --cwd apps/native check-types`, lint 게이트를 돌립니다. Expected: PASS.
- [ ] **Step 5: Commit** `feat(native): register GBIS and TAGO buses and mark them as without live data on the map`

### Task 9: 데이터 적재, 게시, 실기기 확인

**Files:** 코드 변경은 없습니다. 결과는 PR 본문과 실험 문서에 적습니다.

- [ ] **Step 1: 원본 받기.**
  - `bun run --cwd packages/transit-static cli fetch:gbis-routes`
  - `bun run --cwd packages/transit-static cli fetch:tago-routes`
  - 한도에 걸리면 다음 날 같은 명령으로 이어 받습니다.
  - 서울 노선 목록도 다시 받습니다(`fetch:bus-route-list`). 2026-11-10 `routes.json`에는 배차간격이 없기 때문입니다.
- [ ] **Step 2: 적재.**
  - `build:bus-routes --dry-run`을 먼저 돌립니다. Expected: 출처별 적재 비율 90% 이상, 서울 노선 수 변화 없음(674 ± 기존 제외).
  - 그다음 실제 적재를 합니다.
- [ ] **Step 3: 게시.** 사용자 확인을 받고 아래를 합니다.
  - 원격 D1 마이그레이션 0008
  - `publish:d1 --remote`
  - `wrangler deploy`
- [ ] **Step 4: 실기기 확인(S20, iPhone).**
  - 경로 등록에서 경기 마을버스(예: 고양 `011`)를 시·군 이름으로 고를 수 있습니다.
  - 지도에 선과 승차 점이 그려지고 "실시간 정보 없음"이 뜹니다.
  - 출퇴근 카드가 "시간표 추정"으로 나옵니다.
  - 확인이 끝나면 테스트 장소를 지웁니다.
