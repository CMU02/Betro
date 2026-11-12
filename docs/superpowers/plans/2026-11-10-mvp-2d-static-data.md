# MVP 2-D: 정적 데이터 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 마을버스와 서울을 오가는 경기·인천 버스를 버스 참조 배치에 넣고, 앱의 경로 등록 화면이 노선과 정류장(역)을 고를 수 있는 조회 API를 만든다.

**Architecture:** 3단계 버스 파이프라인(`packages/transit-static`의 수집 → 조립 → 적재)을 그대로 쓰고 범위만 넓힌다. 마을버스(routeType 2)는 이미 받은 정류소 원본에 노선 모양만 더 받으면 된다. 경기·인천 노선(routeType 7·8)은 노선 엑셀에 없어서 `getBusRouteList` 검색으로 목록을 만든다. 조회 API는 D1의 현재 배치를 읽는 공개 GET 라우트이고, 노선·정류장 ID는 2-C와 같은 출처 구분 형식(`seoul-bus:…`, `seoul-subway:…`)으로 돌려준다.

**Tech Stack:** TypeScript 6, bun test, drizzle(libsql 로컬 / D1), Hono.

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` 3장 "버스 범위", 4.4(16 장소 설정의 수단 선택), 8장 2단계. 실험 결과: `docs/research/2026-11-06-mvp2-experiments.md` 1절.

## 계획 중 확인한 사실 (2026-11-10)

- 노선 엑셀(OA-1095)의 718개 노선은 정류소 원본(`getStaionByRoute`)을 이미 다 받았다. 마을버스(routeType 2)도 들어 있다. 노선 모양(`getRoutePath`)은 범위 안 427개만 받았다.
- 서울시 공표 수치는 마을버스 253개 노선, 서울을 오가는 경기·인천 면허 노선 645개다(`docs/research/2026-10-30-data-sources.md`).
- `getBusRouteList?strSrch=1`은 698개를 돌려준다(routeType 7: 17개, 8: 312개 포함, 220KB). 한 글자 검색이 되고, 응답이 잘리지 않았다.
- 경기 노선도 `getRoutePath`가 나온다(M5107 `234001243`: 841점). 그래서 정류소 투영과 구간 조립을 서울 노선과 같은 코드로 한다.
- 경기·인천 노선 이름에는 지역이 붙어 온다(`M5107광주`, `9003성남`, `M6450인천`). `getBusRouteList`의 `busRouteAbrv`가 지역을 뗀 이름(`M5107`)이다.
- 수집기의 `prod` 모드는 D1 현재 버스 배치의 전 노선을 위치 관측 대상으로 삼는다(`cf-ports.ts`의 `currentBusRouteIds`). 지금은 `dev` 모드라 두 노선만 부른다.
- 오퍼레이션별 하루 한도는 1,000건이고, 수집 명령은 한 번에 950건까지만 부른다.

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/mvp2-static`, 브랜치 `feat/mvp2-static-data`(develop에서 만듦). PR은 develop으로.
- 커밋 메시지와 PR 본문에 AI 서명이나 출처 표기를 넣지 않는다.
- 커밋 전 `bunx ultracite fix`. 각 Task 끝에 저장소 루트에서 `bun test`와 `bun run check-types`가 통과해야 한다.
- 키(`DATA_GO_KR_API_KEY`)와 키가 든 URL은 로그·오류·보고서·원본 파일에 남기지 않는다(3단계 규칙 그대로).
- **경기·인천 버스(routeType 7·8)는 등록과 출퇴근 세션에만 쓴다.** 지도용 상시 관측 대상에 들어가면 안 된다(스펙 3장). 일반 검색과 상세에도 내지 않는다(조회 API는 등록 화면 전용이다).
- TAGO와 GBIS에서 오는 노선(서울에 들어오지 않는 경기·인천 노선, 경기 마을버스)은 이 계획의 범위 밖이다. 출처 구분 ID가 `tago:…`, `gbis:…`로 더해질 수 있게만 해 둔다.
- 노선·정류장 ID 형식은 2-C `packages/commute/src/refs.ts`와 같아야 한다: 버스 노선 `seoul-bus:<busRouteId>`, 정류장 `seoul-bus:<stId>`, 지하철 노선 `seoul-subway:<lineKey>`, 역 `seoul-subway:<statnId>`.
- 하루 운행 중인 수집기(`betro-server`)의 호출 예산을 건드리지 않는다. 이 계획이 부르는 오퍼레이션은 `getBusRouteList`, `getStaionByRoute`, `getRoutePath`뿐이고, 수집기가 쓰는 `getBusPosByRtid`와 한도를 따로 센다.

## Review Focus

1. **이름이 같은 노선.** 서울 `1000`번과 경기 `1000`번, 지역만 다른 `9003성남`과 `9003`이 함께 검색된다. 기대: 결과마다 지역(`region`)과 지역을 뗀 이름(`shortName`)이 있어 화면이 구분해 보여 줄 수 있고, 정확히 같은 이름이 먼저 나온다. Task 4 테스트로 고정.
2. **수집기가 경기·인천 노선을 지도용으로 부르기 시작하는 경우.** 배치에 645개가 더해지면 `prod` 모드의 관측 대상이 두 배가 된다. 기대: `currentBusRouteIds`가 routeType 7·8을 뺀다. Task 2 테스트로 고정.
3. **2호선 순환과 지선.** 순환선에서 이음매를 넘는 구간(예: 시청 → 충정로)과, 본선과 지선에 걸친 구간(예: 신도림 → 까치산은 지선 안, 강남 → 까치산은 환승). 기대: 순환은 짧은 쪽 방향을 주고, 한 선로로 이어지지 않는 구간은 "직접 갈 수 없음"으로 답한다. Task 5 테스트로 고정.
4. **목록 검색이 빠뜨리는 노선.** 숫자가 없는 이름(예: 영문·한글만 있는 노선)은 숫자 검색에 걸리지 않는다. 기대: 숫자 10개와 함께 영문 `M`, `N`, `G`, 한글 "마을"·"순환" 등 보충 검색어를 돌리고, 보고서가 routeType별 개수를 공표 수치(253, 645)와 대조한다. Task 1 테스트와 Task 3 실행으로 고정.
5. **원천 품질이 낮은 경기·인천 노선이 서울 배치 적재를 막는 경우.** 기대: 적재 가능 비율은 서울 면허 노선(98%)과 경기·인천 노선(90%)을 따로 본다. 경기·인천 노선의 오류는 그 노선만 뺀다. Task 2 테스트로 고정.

---

### Task 1: 경기·인천 노선 목록 받기

**Files:**
- Create: `packages/transit-static/src/sources/seoul-bus-route-list.ts`, `packages/transit-static/src/jobs/fetch-bus-route-list.ts`
- Modify: `packages/transit-static/src/cli.ts`(`fetch:bus-route-list`), `packages/transit-static/src/sources/seoul-bus-api.ts`(`BusRouteOperation`에 `"getBusRouteList"` 추가)
- Test: `packages/transit-static/src/sources/seoul-bus-route-list.test.ts`, `src/jobs/fetch-bus-route-list.test.ts`

**Interfaces:**
- Produces:
  - `interface BusRouteListRow { busRouteId: string; name: string; routeType: string; shortName: string }`(`busRouteNm`, `busRouteAbrv`에서)
  - `parseBusRouteList(items: RawItem[]): BusRouteListRow[]`
  - `ROUTE_LIST_SEARCH_TERMS: readonly string[]` = `"0"`~`"9"`, `"M"`, `"N"`, `"G"`, `"A"`, `"마을"`, `"순환"`
  - `mergeRouteLists(pages: BusRouteListRow[][]): BusRouteListRow[]`(`busRouteId`로 합치고 ID 순)
  - `fetchBusRouteList(options): Promise<{ calls: number; routes: BusRouteListRow[]; stoppedBy: "none" | "quota-exceeded" | "rate-limited" | "unauthorized" }>`. 검색어마다 한 번 부르고, 원본은 `data/raw/bus-route-list/<UTC 날짜>/<검색어>.json`, 합친 결과는 `data/raw/bus-route-list/<UTC 날짜>/routes.json`에 쓴다. 7일 안에 받은 검색어는 다시 부르지 않는다.
  - `latestRouteList(dataDir: string): BusRouteListRow[] | null`(가장 최근 `routes.json`)

- [ ] **Step 1: 실패하는 테스트**
  - 파서: 표본 3줄(서울 간선, 경기 `M5107광주`/`M5107`/8, 인천 7)에서 필드가 그대로 나온다. `busRouteAbrv`가 비었으면 `shortName`은 `name`이다.
  - 합치기: 두 검색 결과에 같은 `busRouteId`가 있으면 한 번만 나온다.
  - 수집: 가짜 fetch로 검색어 16개를 부르고 `calls`가 16. 원본 파일과 오류 문구에 키가 없다. 401을 받으면 남은 검색어를 부르지 않고 `stoppedBy: "unauthorized"`. 6일 전에 받은 검색어는 건너뛰고 8일 전 것은 다시 부른다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/sources/seoul-bus-route-list.test.ts packages/transit-static/src/jobs/fetch-bus-route-list.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 호출·분류·키 가리기는 `fetchBusRouteOperation`을 그대로 쓴다.
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): list regional bus routes from getBusRouteList`

---

### Task 2: 범위 넓히기와 배치 형식

**Files:**
- Modify: `packages/transit-static/src/bus/scope.ts`, `bus/assemble.ts`, `bus/report.ts`, 버스 수집·적재 job(노선 ID 출처), `packages/db/src/schema/transit.ts`(`bus_route`에 `short_name` text NOT NULL, `region` text NOT NULL 추가) + 마이그레이션(`db:generate`, `db:d1-migrations`), `packages/transit-static/src/db/export-sql.ts`(새 열), `apps/server/src/collector/cf-ports.ts`(`currentBusRouteIds`)
- Test: `bus/scope.test.ts`, `bus/assemble.test.ts`, `bus/report.test.ts`, `db/export-sql.test.ts`, `apps/server/src/collector/` 쪽 테스트(추가)

**Interfaces:**
- Consumes: `latestRouteList`, `BusRouteListRow`(Task 1)
- Produces:
  - `scope.ts`
    - `OUT_OF_SCOPE_ROUTE_TYPES` = `["1", "9", "10", "14"]`(마을 2, 인천 7, 경기 8을 뺀다)
    - `REGIONAL_ROUTE_TYPES: readonly string[] = ["7", "8"]`
    - `type BusRegion = "seoul" | "gyeonggi" | "incheon"`, `regionOf(routeType: string): BusRegion`(7 → incheon, 8 → gyeonggi, 그 밖 → seoul)
    - `isMapObservedRouteType(routeType: string): boolean`(7·8이면 false)
    - `BUS_ROUTE_LOGIC_VERSION`을 4로 올린다.
  - 노선 ID 출처: 엑셀의 노선 ∪ 최근 노선 목록에서 routeType 7·8인 노선. 목록 파일이 없으면 수집 명령은 "먼저 `fetch:bus-route-list`를 돌리라"는 안내와 함께 exit 1.
  - `short_name`: 목록에 있으면 `shortName`, 없으면(서울 노선) `route_name`과 같다. `region`: `regionOf(routeType)`.
  - 보고서: 유형별·지역별 노선 수, 그리고 `seoul`과 `regional` 두 묶음의 적재 가능 비율.
  - `ok` 규칙: 원본 없는 노선 0개 **그리고** 서울 면허 노선의 적재 가능 비율 98% 이상 **그리고** 경기·인천 노선의 적재 가능 비율 90% 이상.
  - `D1ReferenceSource.currentBusRouteIds()`: `route_type NOT IN ('7', '8')`인 노선만 돌려준다.

- [ ] **Step 1: 실패하는 테스트**
  - `isInScopeRouteType`: `"2"`, `"7"`, `"8"`이 true, `"1"`, `"9"`, `"10"`, `"14"`가 false.
  - `regionOf("8")` → `"gyeonggi"`, `regionOf("7")` → `"incheon"`, `regionOf("4")`와 `regionOf("2")` → `"seoul"`.
  - 조립: 경기 노선 표본(정류소 + 모양)이 서울 노선과 같은 검증을 거쳐 `region: "gyeonggi"`, `shortName: "M5107"`로 나온다.
  - `ok`: 서울 100개 중 98개 적재 가능·경기 10개 중 9개 → true. 서울 97개 → false. 경기 8개 → false. 경기 노선이 0개면 서울 기준만 본다.
  - `export-sql`: `bus_route` INSERT에 새 두 열이 있다.
  - `currentBusRouteIds`: 유형 4, 2, 8, 7 노선이 든 배치에서 4와 2의 ID만 나온다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static apps/server packages/db` / Expected: FAIL
- [ ] **Step 3: 구현** — 새 열의 마이그레이션은 기존 행에 `short_name = route_name`, `region = 'seoul'`을 채운다(기존 배치에는 7·8이 없다).
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): bring village and regional bus routes into scope`

---

### Task 3: 실제 수집, 적재, D1 올리기

**Files:**
- Modify: `packages/transit-static/README.md`(버스 명령 순서, 범위 규칙, 실측), 이 계획 문서(결과 기록)

- [x] **Step 1: 노선 목록** — Run: `bun transit fetch:bus-route-list` / Expected: `stoppedBy: none`, 호출 16건. routeType 7·8 합계가 645 근처(±10%)다. 크게 모자라면 보충 검색어를 더하고 다시 돌린다. 유형별 개수를 기록한다.
- [x] **Step 2: 노선 원본** — Run: `bun transit fetch:bus-routes` / Expected: `getStaionByRoute`는 새 노선(경기·인천 약 645건)만, `getRoutePath`는 마을 약 253건 + 경기·인천 약 645건을 부른다. 950건에서 `stoppedBy: budget`으로 멈추면 다음 날(KST 00시 이후) 다시 돌려 `stoppedBy: none`이 될 때까지 반복한다.
- [x] **Step 3: 조립 확인** — Run: `bun transit build:bus-routes --dry-run` / Expected: 보고서 `ok: true`. 지역별 적재 가능 비율, 제외된 노선과 사유, 마을버스 수가 253 근처인지 본다. 경기·인천 비율이 90%에 못 미치면 멈추고 보고서의 오류 유형을 사용자에게 보인다.
- [x] **Step 4: 적재** — Run: `cd packages/db && DATABASE_URL=file:<저장소>/local.db bun run db:migrate`, `bun transit build:bus-routes` / Expected: 새 `bus_route` 배치가 현재 배치가 된다. `select region, count(*) from bus_route where batch_id = <새 배치> group by region`에 세 지역이 나온다.
- [x] **Step 5: D1** — Run: `cd apps/server && bunx wrangler d1 migrations apply betro --local`, `bun transit publish:d1 --dry-run`(SQL 크기 확인), `bun transit publish:d1`. 로컬에서 Task 4·5의 라우트를 확인한 뒤 `--remote`로 같은 순서를 돌린다. / Expected: 원격 D1의 현재 `bus_route` 배치 노선 수가 로컬과 같다. 수집기는 5분 안에 새 배치를 읽고 계속 돈다(`dev` 두 노선은 그대로 범위 안이다).
- [x] **Step 6: 기록과 커밋** — README와 이 문서에 실측(유형별 노선 수, 정류소·구간 수, 제외 노선, 호출 수, D1 SQL 크기)을 적는다. `docs(transit-static): record the village and regional bus load`

#### Task 3 결과 (2026-11-11)

- **노선 목록**(2026-11-10): 검색어 16개, 호출 16건, `stoppedBy: none`. 1,349개 노선(routeType 7: 38, 8: 590 → 경기·인천 628, 공표 645 대비 −2.6%).
- **노선 원본**: 2026-11-10에 950건에서 하루 한도로 멈췄고, 2026-11-11에 이어 받아 `stoppedBy: none`. 이날 호출 `getStaionByRoute` 396(950 건너뜀), `getRoutePath` 380(906 건너뜀). `outOfScope` 44, `notFound` 17, `failed` 0.
- **조립**(배치 10, `ok: true`): 노선 1,346 중 범위 안 1,302(적재 1,283, 제외 19), 범위 밖 44. seoul 674/674(100%), regional 609/628(97.0%, 기준 90%). 마을 247(공표 253). 정류소 84,944, 구간 83,661. 제외 19개는 모두 경기·인천: `route-not-found` 17(`getRoutePath` headerCd 4. 원본을 다시 받아도 같다고 보고 다시 부르지 않았다), `shape-too-short` 2(M6463인천, M6464인천). 목록은 README "검증 결과 코드".
- **적재**: `local.db`에 마이그레이션 후 배치 10이 현재 배치. 지역별 seoul 674, gyeonggi 574, incheon 35.
- **D1**
  - 로컬: `0006` 적용이 `duplicate column name: region`으로 실패했다. 이 워크트리의 로컬 D1에 이름을 바꾸기 전의 `0005_20261110062424_bus_route_region.sql`(커밋된 적 없음)이 이미 적용돼 있었다. 열 정의(`region` TEXT NOT NULL DEFAULT 'seoul', `short_name` TEXT NOT NULL DEFAULT '')가 `0006`과 같고 `bus_route`가 비어 있음을 확인한 뒤, 로컬 `d1_migrations`에만 `0006`을 적용됨으로 넣었다. 원격에는 옛 파일이 적용된 적이 없다.
  - `publish:d1 --dry-run` 76.9MB(로컬에 배치 5·8·9·10), 로컬 게시 후 원격: `0006` 적용(4 commands), `publish:d1 --remote`는 배치 10만 46.5MB(5·8·9는 이미 있음). 원격 현재 버스 배치 10, 지역별 노선 수가 로컬과 같다. 게시 직후 `/v1/snapshot/subway` 200.
  - 운영 중인 서버(develop 배포본)는 `currentBusRouteIds`에 routeType 7·8 필터가 없다. 수집기가 `dev` 모드(두 노선)라 지금은 영향이 없지만, Task 6 배포 전에는 `prod`로 바꾸지 않는다.
- **조회 API 로컬 확인**(Task 4·5 라우트, 로컬 D1): `q=6411` → `seoul-bus:100100290`, `q=M5107` → `M5107광주`(gyeonggi, shortName `M5107`)와 `M5107(예약)수원`(shortName `M5107예`, 원천 `busRouteAbrv` 그대로), `q=1000` → 고양·구리(gyeonggi), 인천(incheon) 순, `q=서초` → 마을버스 서초01~03. M5107 정류장 61개.

---

### Task 4: 버스 조회 API

**Files:**
- Create: `apps/server/src/ref/ids.ts`, `apps/server/src/ref/bus.ts`, `apps/server/src/ref/routes.ts`
- Modify: `apps/server/src/app.ts`(API 호스트에 `/v1/ref` 연결)
- Test: `apps/server/src/ref/bus.test.ts`, `apps/server/src/ref/routes.test.ts`

**Interfaces:**
- Produces:
  - `ids.ts`: `busLine(busRouteId: string): string`(`seoul-bus:<id>`), `busStop(stId: string): string`, `subwayLine(lineKey: string): string`, `subwayStation(statnId: string): string`
  - `GET /v1/ref/bus/routes?q=<검색어>&limit=<1~50, 기본 20>` → `{ batchId: number; routes: { line: string; name: string; region: "seoul" | "gyeonggi" | "incheon"; routeType: string; shortName: string }[] }`
    - `q`는 앞뒤 공백을 떼고 1~20자. `short_name`이나 `route_name`에 들어 있으면 맞는다(대소문자 무시).
    - 순서: `short_name`이 정확히 같은 것 → `short_name`이 검색어로 시작하는 것 → 그 밖. 같은 묶음 안에서는 서울 → 경기 → 인천, 그다음 이름 순.
  - `GET /v1/ref/bus/routes/:busRouteId/stops` → `{ line: string; name: string; region: string; shortName: string; stops: { arsId: string | null; directionName: string | null; name: string; seq: number; stop: string }[] }`. 순번 순. 없는 노선은 404.
  - 응답 헤더: `Cache-Control: public, max-age=3600`, `ETag: "bus-<batchId>"`. `If-None-Match`가 같으면 304.
  - 인증은 없다(공개된 교통 데이터다).

- [ ] **Step 1: 실패하는 테스트**(`createTestDb()`에 노선 5개를 넣는다: 서울 `1000`, 경기 `1000`, 경기 `M5107광주`/`M5107`, 서울 마을 `서초03`, 서울 `100`)
  - `ids`: `busLine("100100290")` → `"seoul-bus:100100290"`, `subwayStation("1002000222")` → `"seoul-subway:1002000222"`.
  - `q=1000`: 두 개가 나오고 서울이 먼저다. 각각 `region`이 다르다.
  - `q=100`: `100`(정확히 같음)이 먼저, 그다음 `1000` 둘.
  - `q=m5107`(소문자): `M5107광주`가 나오고 `shortName`이 `M5107`.
  - `q=서초`: 마을버스가 나온다.
  - `q`가 없거나 21자면 400. `limit=0`이나 51이면 400.
  - 정류장: 순번 순으로 나오고 `stop`이 `seoul-bus:<stId>`. 현재 배치가 아닌 옛 배치의 노선은 나오지 않는다. 없는 노선 404.
  - 같은 `ETag`로 다시 부르면 304.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server/src/ref` / Expected: FAIL
- [ ] **Step 3: 구현** — 검색은 현재 `bus_route` 배치 한 개만 본다. 정렬은 SQL에서 한다(검색어는 바인딩으로 넘긴다).
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(server): add bus route and stop lookup for commute registration`

---

### Task 5: 지하철 조회 API

**Files:**
- Create: `apps/server/src/ref/subway.ts`
- Modify: `apps/server/src/ref/routes.ts`
- Test: `apps/server/src/ref/subway.test.ts`

**Interfaces:**
- Produces:
  - `GET /v1/ref/subway/lines` → `{ lines: { line: string; name: string }[] }`. `@Betro/transit-static/lines`의 `LINES` 순서 그대로.
  - `GET /v1/ref/subway/lines/:lineKey/stations` → `{ batchId: number; branches: { branchKey: string; stations: { name: string; stop: string }[] }[] }`. 가지(`branch_key`)마다 `down` 방향 선로의 역 순서. 없는 노선은 404.
  - `GET /v1/ref/subway/direction?line=<lineKey>&from=<statnId>&to=<statnId>` → `{ direction: "up" | "down"; stops: number }`. 두 역이 한 선로 위에 있지 않으면 404 `{ "error": "not-direct" }`, 같은 역이면 400.
  - `directionBetween(shapes: { direction: "up" | "down"; isLoop: boolean; stations: string[] }[], from: string, to: string): { direction: "up" | "down"; stops: number } | null`(순수 함수)
    - 두 역이 모두 있고 `from`이 `to`보다 앞에 있는 선로를 찾는다. 여럿이면 `stops`가 가장 작은 것.
    - `isLoop`인 선로는 끝에서 처음으로 이어진다고 보고 이음매를 넘는 정거장 수도 계산한다.
    - `isLoop`는 그 선로의 첫 역과 마지막 역 사이 거리가 그 노선의 역 간 최대 거리보다 짧으면 true로 한다(2호선 본선). 실데이터에서 2호선 본선만 true인지 Step 5에서 확인한다.
  - 헤더는 Task 4와 같고 `ETag`는 `"subway-<track 배치 id>"`.

- [ ] **Step 1: 실패하는 테스트**
  - `directionBetween`, 직선: 역 A–B–C–D의 `down` 선로와 반대 순서의 `up` 선로 → A→C는 `{ direction: "down", stops: 2 }`, C→A는 `{ direction: "up", stops: 2 }`.
  - 순환: 역 6개 순환에서 끝 역 → 첫 역은 한 정거장이고, 반대 방향 선로의 다섯 정거장보다 짧은 쪽을 고른다.
  - 다른 가지: 본선에만 있는 역과 지선에만 있는 역 → null.
  - 라우트: 노선 목록이 `LINES`와 같은 수다. 역 목록이 가지별로 나오고 `stop`이 `seoul-subway:<statnId>`. 방향 조회가 순수 함수 결과와 같고, 이어지지 않으면 404, 같은 역이면 400, 모르는 노선이면 404.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server/src/ref/subway.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 방향 값은 수집기 관측의 `direction`과 같은 뜻이어야 한다(2-C가 도착판을 방향으로 거른다). `track_shape.direction`이 그 값이다.
- [ ] **Step 4: 통과 확인** — Run: `bun test && bun run check-types` / Expected: PASS
- [x] **Step 5: 실데이터 확인** — (2026-11-11, 로컬 D1: 강남 → 교대 `up` 1, 시청 → 충정로 `down` 1, 강남 → 까치산 404 `not-direct`, 신도림 → 까치산 `up` 4, 가산디지털단지 → 고속터미널 `up` 12, 2호선 가지 main 43·seongsu 5·sinjeong 5. 기대와 같다.) 로컬 D1(`bun run dev`)에서 다음을 부른다. Expected: 2호선 강남 → 교대가 `up`(수집기 이벤트에서 내선이 `up`이다), 시청 → 충정로가 한 정거장, 강남 → 까치산이 404, 7호선 가산디지털단지 → 고속터미널이 한 방향으로 나온다. 2호선 본선만 순환으로 잡힌다. 결과가 다르면 `isLoop` 기준을 고치고 테스트에 그 사례를 더한다.
- [ ] **Step 6: 커밋** — `feat(server): add subway line, station and direction lookup`

---

### Task 6: 배포와 문서

**Files:**
- Modify: `apps/server/README.md`(조회 API 절), 이 계획 문서(결과)

- [x] **Step 1: 배포** — Task 3 Step 5의 원격 D1이 끝난 뒤 `cd apps/server && bun run deploy`. Expected: `curl 'https://betro.cmu02-studio.com/v1/ref/bus/routes?q=6411'`이 `seoul-bus:100100290`을 돌려주고, `q=M5107`이 경기 노선을 돌려준다. `/v1/snapshot/subway`는 그대로 200.
- [x] **Step 2: 수집기 확인** — 배포 10분 뒤 R2에 `raw/bus-100100290/…` 조각이 계속 쌓이는지 본다(4단계 README "이력과 일일 보고서"). Expected: 80초 간격 그대로.
- [x] **Step 3: 문서와 커밋** — README에 라우트와 응답 예를 적는다. `docs(server): document the registration lookup API`

#### Task 6 결과 (2026-11-11)

- **배포**: `feat/mvp2-static-data`(86934e5)에서 `bun run deploy`, `betro-server` version `7a5a7e31`(이전 `5be6ea6c`는 2-C 코드에 secret만 바꾼 판. 되돌릴 때 쓴다). 이 브랜치에는 #16(2-F)이 합쳐져 있지 않지만, #16은 `apps/server`와 `packages`를 바꾸지 않아 운영 서버에서 빠지는 변경은 없다. 배포 전 `bun test` 942 pass / 7 skip / 0 fail, `bun run check-types` 통과.
- **운영 확인**: `q=6411` → `seoul-bus:100100290`(배치 10), `q=M5107` → `M5107광주`(gyeonggi), `/v1/ref/subway/lines` 19개 노선, 6411 정류장 117개, `ETag: "bus-10"`로 다시 부르면 304, `/v1/snapshot/subway` 200.
- **수집기**: 배포(13:54 UTC) 10분 뒤 R2 `raw/bus-100100290/2026/11/11/`에 조각이 배포 전과 같은 약 160초 간격으로 계속 쌓였다(13:55, 13:57, 14:00, 14:03). `COLLECTOR_MODE`는 `dev` 그대로다.

