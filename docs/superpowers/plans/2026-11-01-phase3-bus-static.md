# 3단계: 버스 노선·정류소·노선 모양 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서울 시내버스 노선마다 정류소 목록과 노선 모양을 받아, 정류소를 모양 위에 순서대로 투영해 정류소 구간(시작·끝 seq, 모양 위 거리 범위)을 만들고 참조 DB에 버전을 매겨 적재한다.

**Architecture:** 1·2단계의 `packages/transit-static`에 `sources/bus-route-xlsx.ts`(OA-1095 노선 엑셀), `sources/seoul-bus-api.ts`(ws.bus.go.kr 노선정보 클라이언트와 응답 파서), `bus/`(정류소 전진 투영, 노선별 조립·검증, 보고서), `jobs/fetch-bus-route-xlsx.ts`·`jobs/fetch-bus-routes.ts`(이어받기 가능한 원본 수집)·`jobs/build-bus-routes.ts`(조립 → 보고서 → 적재)를 더한다. 노선 목록은 OA-1095 엑셀에서 얻고, 정류소와 모양은 노선마다 `getStaionByRoute`, `getRoutePath` 원본 JSON을 그대로 보관한다. 적재는 1·2단계와 같은 `reference_batch` 버전 체계(kind=`bus_route`)와 manifest 해시(원본 + 로직 버전)를 쓴다.

**Tech Stack:** Bun 1.4, TypeScript, Drizzle ORM + libsql(SQLite), zod, `read-excel-file`(1단계와 같음). 테스트는 `bun test`. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-30-data-collection-design.md` §4.1(호출량), §4.2(단위·순번 조인), §6.5, §7.3(키·헤더), §7.5(오류 분류), §9.2, §13 3단계. 조사 보고서 `docs/research/2026-10-30-data-sources.md` 2장(버스 API).

## 계획 중 실측한 사실 (2026-11-01, 이 계획의 근거)

- OA-1095 최신 파일은 `서울시버스노선별정류소정보(20260902).xlsx`, 다운로드 seq **58**. URL은 OA-12764와 같은 형식: `https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-1095&seqNo=&seq=58&infSeq=2` (`infSeq=1`은 183바이트 HTML 오류 페이지). 시트 헤더는 `ROUTE_ID, 노선명, 순번, NODE_ID, ARS_ID, 정류소명, X좌표, Y좌표`, 41,689행, **노선 718개**(396개 시내버스보다 많다. 다른 유형이 섞여 있음).
- 노선 ID 앞자리로는 유형을 알 수 없다. `124000006`(6200)은 routeType `1`, `116000006`(703)은 `3`, `111000016`(N75)은 가이드에 없는 `15`. **유형은 `getStaionByRoute` 응답의 `routeType`으로만 판단한다.**
- `getStaionByRoute`(6411, `100100290`): 117개 정류소. 필드 `seq, station, arsId, stationNm, gpsX, gpsY, fullSectDist, direction, routeType, section, trnstnid, …`, 모두 문자열. `fullSectDist`는 이전 정류소부터의 거리(m, 정수 문자열, seq 1은 `"0"`). 왕복이 한 순번 열(1~117)로 오고, 시작·끝이 같은 이름(정랑고개.양천벤처타운)이지만 `station` ID는 다르다. `direction`은 그 정류소에서 향하는 방면 이름.
- `getRoutePath`(6411): 1,978점, 필드 `no, gpsX, gpsY, posX, posY`. 첫 점은 첫 정류소에서 모양을 따라 약 619m 앞(차고지 진입로로 보임).
- 6411에서 **전역 최근접 투영은 순서가 3번 뒤로 간다**(같은 도로를 왕복). 직전 정류소 이후 창 `[cursor, cursor + 2×fullSectDist + 1000m]` 안에서만 찾으면 단조 증가하고, 오프셋 중앙값 6.5m·최대 24.5m, 구간 길이/`fullSectDist` 중앙값 1.001(0.41~1.51).
- 응답 봉투: `{ comMsgHeader, msgHeader: { headerCd, headerMsg, itemCount }, msgBody: { itemList } }`, `resultType=json`. 잘못된 키는 HTTP 401 + JSON(조사 보고서 2장).
- 6411 응답은 `packages/transit-static/src/sources/__fixtures__/bus-stations-6411.json`, `bus-path-6411.json`으로 이 계획과 함께 커밋한다(키 없음 확인, Biome으로 포맷만 바꿈. 내용은 원본과 같다).

## Global Constraints

- 1·2단계 Global Constraints를 이어받는다: 좌표 WGS84 `[lng, lat]`, 거리 미터, 원본 보관과 SHA-256 재적재 방지, Ultracite/Biome(`bunx ultracite fix`), 테스트는 소스 옆 `*.test.ts`, attribution 트레일러 금지, 키는 환경 변수로만.
- 키: `DATA_GO_KR_API_KEY`(data.go.kr 서비스키, `packages/transit-static/.env`에서 Bun이 읽음). **키와 키가 든 URL은 로그·오류 메시지·보고서·원본 파일 어디에도 쓰지 않는다.** 오류 메시지에는 `maskKey(url, key)`로 가린 URL만 넣는다(키 원문과 `encodeURIComponent(key)` 둘 다 `<key>`로).
- `ws.bus.go.kr`은 HTTP만 된다(HTTPS 시간 초과, 조사 보고서 2장). URL은 상수로 두고 주석에 이유를 적는다. `datafile.seoul.go.kr`는 HTTPS.
- 요청에 개인정보 헤더를 넣지 않는다(§7.3). 요청 간격 100ms(`BUS_REQUEST_DELAY_MS`), 요청 타임아웃 10초.
- 개발계정 한도: 오퍼레이션별 하루 1,000건, KST 00시 초기화(조사 보고서 2장 FAQ). 수집 잡은 한 번 실행에 오퍼레이션별 최대 950건(`BUS_CALLS_PER_OPERATION_PER_RUN`)만 부르고, 이미 받은 원본은 다시 부르지 않아 다음 실행에서 이어받는다.
- 정류소는 **seq(순번)로만** 잇는다. 순환·왕복 노선은 같은 정류소가 두 번 나올 수 있으므로 `station` ID로 조인하지 않는다(§4.2).
- `getStaionByRoute.fullSectDist`는 m. (`getBusPosByRtid`의 km와 다르다. 이 단계는 위치 API를 쓰지 않는다.)
- 범위: routeType `2`(마을), `7`(인천), `8`(경기), `9`(폐지)는 제외(`OUT_OF_SCOPE_ROUTE_TYPES`). 그 밖의 값(가이드에 없는 `15` 포함)은 포함하고 보고서에 유형별 개수를 낸다. 포함 노선 수의 기대치는 396(서울시 2026-01 현황). Task 8에서 실제 분포를 보고 이 목록을 확정한다.
- 경고 기준값(§6.5, §14에 따라 실데이터로 조정 가능): 정류소-모양 오프셋 80m(`BUS_STOP_WARN_OFFSET_M`), 구간 길이와 `fullSectDist`의 비율이 0.5 미만 또는 2 초과이면서 차이가 100m 넘으면 경고.
- 모양 출처는 공공데이터(getRoutePath)다. OSM이 아니므로 ODbL 표기를 붙이지 않는다. 출처 문자열은 `서울특별시 버스노선정보(공공데이터포털)`.

## Review Focus

1. **같은 도로를 왕복하는 노선**: 전역 최근접 투영은 오는 길 정류소를 가는 길에 붙여 순서가 뒤로 간다. 전진 창 투영은 seq 순으로 단조 증가해야 한다. Task 5에 6411 픽스처 테스트(단조 증가, 최대 오프셋 30m 미만, 같은 입력의 전역 최근접은 3번 뒤로 감)로 고정.
2. **순환 노선의 첫·마지막 정류소가 같은 좌표**: 마지막 정류소가 거리 0(시작점)에 붙으면 마지막 구간 길이가 음수가 된다. Task 5에 닫힌 사각형 합성 모양 테스트로 고정(마지막 정류소 거리 ≈ 모양 길이).
3. **키 노출**: 실패한 요청의 오류 메시지, 보고서, 저장 원본에 서비스키가 들어가면 안 된다. Task 2 `maskKey`와 Task 4 오류 경로 테스트(던진 오류 메시지에 키 원문·인코딩 키가 없음)로 고정.
4. **한도 소진으로 수집이 중간에 멈춤**: 한도 응답을 받으면 그 오퍼레이션을 즉시 멈추고, 이미 저장한 파일은 남기고, 다시 실행하면 남은 노선부터 받는다. 한도 응답 형식이 확인되지 않았으므로(조사 보고서 2장) HTTP 429, 본문의 `returnReasonCode` 22·23, `LIMITED_NUMBER_OF_SERVICE_REQUESTS`, `headerCd` 7·8을 모두 한도/키 정지로 본다. Task 2·4 테스트로 고정.
5. **모양이 첫 정류소보다 앞에서 시작**: 6411은 첫 정류소가 모양 위 약 619m 지점이다. 첫 정류소는 `[0, 3000m]` 창에서 찾고, 첫 구간은 seq 1에서 시작한다(거리 0 구간을 만들지 않음). Task 5 6411 테스트에 첫 정류소 거리 500~750m로 고정.

## 실행 방식과 모델 배정

1·2단계와 같은 subagent-driven-development. 구현자는 순차, 리뷰는 Opus 5.5.

| Task | 내용 | 구현 모델 | 이유 |
|---|---|---|---|
| 1 | DB 스키마(bus 테이블 4개, kind 추가, 마이그레이션) | Sonnet 5.5 | 기존 스키마 패턴 |
| 2 | 버스 API 클라이언트와 응답 파서, 키 가리기 | Sonnet 5.5 | 정해진 봉투 파싱 |
| 3 | OA-1095 엑셀 파서와 다운로드 잡 | Sonnet 5.5 | 1단계 xlsx와 같은 패턴 |
| 4 | 이어받기 가능한 노선 원본 수집 잡 | Opus 5.5 | 한도·재시도·범위 판정 흐름 |
| 5 | 정류소 전진 투영과 구간 생성 | Opus 5.5 | 알고리즘 |
| 6 | 노선별 조립·검증과 보고서 | Opus 5.5 | 검증 규칙과 집계 |
| 7 | `build:bus-routes` 잡, 적재, CLI | Sonnet 5.5 | 2단계 잡과 같은 흐름 |
| 8 | 실데이터 수집·적재, 범위 확정, README | Opus 5.5 | 실데이터 판단 |

## 파일 구조

```
packages/db/src/schema/transit.ts              (수정: ReferenceBatchKind에 "bus_route", 테이블 4개)
packages/db/src/migrations/<new>/              (생성: drizzle-kit generate)
packages/transit-static/
  src/sources/seoul-bus-api.ts                 URL, maskKey, parseBusEnvelope, parseRouteStations, parseRoutePath, fetchBusRouteOperation
  src/sources/bus-route-xlsx.ts                busRouteXlsxUrl, parseBusRouteRows
  src/bus/scope.ts                             OUT_OF_SCOPE_ROUTE_TYPES, isInScopeRouteType
  src/bus/project-stops.ts                     projectStopsForward, buildSegments
  src/bus/assemble.ts                          assembleBusRoute, assembleBusRoutes, BUS_ROUTE_LOGIC_VERSION
  src/bus/report.ts                            renderBusRouteReport
  src/jobs/fetch-bus-route-xlsx.ts             OA-1095 다운로드
  src/jobs/fetch-bus-routes.ts                 노선별 getStaionByRoute → (범위 안이면) getRoutePath
  src/jobs/build-bus-routes.ts                 원본 읽기 → 조립 → 보고서 → 적재
  src/db/load.ts                               (수정: loadBusRoutes)
  src/cli.ts                                   (수정: 명령 3개)
  README.md                                    (수정: 버스 절)
data/raw/oa-1095-bus-route-xlsx/routes-seq<N>.xlsx
data/raw/bus-route-stations/<busRouteId>.json  (getStaionByRoute 원본 그대로)
data/raw/bus-route-path/<busRouteId>.json      (getRoutePath 원본 그대로)
```

---

### Task 1: 버스 DB 스키마

**Files:**
- Modify: `packages/db/src/schema/transit.ts`
- Create: `packages/db/src/migrations/<generated>/` (`bun run db:generate` in `packages/db`)
- Test: `packages/db/src/schema/transit.test.ts` (기존 파일에 추가)

**Interfaces:**
- Produces:
  - `ReferenceBatchKind = "station_crosswalk" | "track" | "timetable" | "bus_route"`
  - `busRoute` 테이블 `bus_route`: `id` pk, `batchId` fk(cascade), `routeId` text(busRouteId), `routeName` text, `routeType` text(원본 코드 문자열), `qualityFlags` json string[]. unique(`batchId`, `routeId`).
  - 이름 주의: 아래 세 테이블의 `busRouteId`(`bus_route_id`)는 `bus_route.id` 정수 외래키다. API의 문자열 `busRouteId`(예: `"100100290"`)는 `bus_route.routeId`에 담는다.
  - `busRouteShape` 테이블 `bus_route_shape`: `id` pk, `busRouteId` integer fk→`bus_route.id`(cascade), `coords` json `[number, number][]`, `lengthM` real, `attribution` text. unique(`busRouteId`).
  - `busRouteStop` 테이블 `bus_route_stop`: `id` pk, `busRouteId` fk(cascade), `seq` integer, `stationId` text, `arsId` text nullable, `name` text, `lat` real, `lng` real, `apiSectDistM` integer(원본 `fullSectDist`), `directionName` text nullable(원본 `direction`), `distanceM` real(모양 위 거리), `offsetM` real, `qualityFlags` json string[]. unique(`busRouteId`, `seq`), index(`stationId`).
  - `busRouteSegment` 테이블 `bus_route_segment`: `id` pk, `busRouteId` fk(cascade), `fromSeq` integer, `toSeq` integer, `startM` real, `endM` real, `apiSectDistM` integer(`toSeq` 정류소의 `fullSectDist`), `qualityFlags` json string[]. unique(`busRouteId`, `fromSeq`).

- [ ] **Step 1: 실패하는 테스트** — `bus route rows round-trip and cascade`: `createTestDb()`로 `kind: "bus_route"` 배치, 노선 1개, 모양 1개, 정류소 2개, 구간 1개를 넣고 다시 읽어 `coords`·`qualityFlags`가 배열로 돌아오는지, 배치를 지우면 네 테이블 행이 모두 0이 되는지 확인한다. 같은 (`busRouteId`, `seq`) 정류소 두 번 삽입은 reject.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/db/src/schema/transit.test.ts` / Expected: FAIL(`busRoute` is not exported)
- [ ] **Step 3: 테이블 4개와 kind 추가, `bun run db:generate`로 마이그레이션 생성**. 열 이름은 snake_case, 기존 테이블과 같은 정렬(키 알파벳순, Biome 규칙).
- [ ] **Step 4: 통과 확인** — Run: `bun test packages/db` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(db): add bus route reference tables`

---

### Task 2: 버스 노선정보 API 클라이언트와 응답 파서

**Files:**
- Create: `packages/transit-static/src/sources/seoul-bus-api.ts`
- Test: `packages/transit-static/src/sources/seoul-bus-api.test.ts`
- Fixtures(이미 있음): `src/sources/__fixtures__/bus-stations-6411.json`, `bus-path-6411.json`

**Interfaces:**
- Produces:
  - `type BusRouteOperation = "getStaionByRoute" | "getRoutePath"`
  - `busRouteInfoUrl(operation: BusRouteOperation, key: string, busRouteId: string): string` → `http://ws.bus.go.kr/api/rest/busRouteInfo/<operation>?serviceKey=<encodeURIComponent(key)>&busRouteId=<id>&resultType=json`
  - `maskKey(text: string, key: string): string`
  - `type BusEnvelope = { kind: "ok"; items: Record<string, unknown>[] } | { kind: "route-not-found" } | { kind: "quota-exceeded"; detail: string } | { kind: "rate-limited"; detail: string } | { kind: "unauthorized"; detail: string } | { kind: "retryable"; detail: string } | { kind: "error"; detail: string }`
  - `parseBusEnvelope(status: number, bodyText: string): BusEnvelope`
  - `interface BusRouteStationRow { seq: number; stationId: string; arsId: string | null; name: string; lng: number; lat: number; apiSectDistM: number; directionName: string | null; routeType: string; routeName: string }`
  - `parseRouteStations(items: Record<string, unknown>[]): { rows: BusRouteStationRow[]; errors: string[] }`
  - `parseRoutePath(items: Record<string, unknown>[]): { coords: [number, number][]; errors: string[] }` (`no` 오름차순 정렬 후 `[gpsX, gpsY]`)
  - `fetchBusRouteOperation(options: { operation: BusRouteOperation; key: string; busRouteId: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ envelope: BusEnvelope; bodyText: string }>` — 네트워크 예외와 타임아웃은 `{ kind: "retryable" }`로 돌려준다. 예외 메시지에 URL이 들어가면 `maskKey`를 거친다.

`parseBusEnvelope` 판정 순서(본문을 JSON으로 읽기 전에 텍스트로 먼저 본다):

| 조건 | kind |
|---|---|
| status 401, 또는 `headerCd` `"7"` | `unauthorized` |
| status 429, 본문에 `returnReasonCode>22<`·`"returnReasonCode":"22"`, 또는 `LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS` | `quota-exceeded` |
| 본문에 `returnReasonCode` 23, 또는 `headerCd` `"8"`(api.bus.go.kr errGuide: 요청 제한 초과) | `rate-limited` |
| status 5xx, `headerCd` `"1"`, `"6"` | `retryable` |
| `headerCd` `"4"`(노선 없음) | `route-not-found` |
| `headerCd` `"0"` | `ok` (itemList가 없거나 null이면 빈 배열) |
| 그 밖(JSON 아님, 다른 코드) | `error` (detail에 headerCd·headerMsg 또는 본문 앞 200자) |

- [ ] **Step 1: 실패하는 테스트**
  - `parseRouteStations on 6411 fixture`: 117행, `rows[0]`이 `{ seq: 1, stationId: "114000124", arsId: "15227", apiSectDistM: 0, routeType: "4", routeName: "6411", directionName: "선릉역" }`를 포함, `rows[116].apiSectDistM === 386`, `errors` 빈 배열, seq는 1..117 연속.
  - `parseRoutePath on 6411 fixture`: 1,978개 좌표, 첫 좌표 `[126.843903, 37.50944]`, `no`를 섞은 입력도 `no` 순으로 정렬.
  - `parseRouteStations reports bad numbers`: `gpsX: "abc"`인 행은 `errors`에 `seq 3: invalid gpsX`처럼 들어가고 `rows`에서 빠진다.
  - `parseBusEnvelope` 표의 각 행마다 1개씩(401, 429, `<returnReasonCode>22</returnReasonCode>` XML, 23, headerCd 8, 6, 4, 0, HTML 본문).
  - `maskKey hides raw and encoded key`: 키 `"a/b+c=="`로 만든 URL을 가리면 결과에 `a/b+c==`도 `a%2Fb%2Bc%3D%3D`도 없다.
  - `fetchBusRouteOperation masks key in network errors`: `fetchImpl`이 URL을 메시지에 담아 throw하면 결과 `envelope.detail`에 키가 없다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/sources/seoul-bus-api.test.ts` / Expected: FAIL(module not found)
- [ ] **Step 3: 구현** — URL 상수 위에 "ws.bus.go.kr은 HTTP만 응답, HTTPS는 시간 초과(조사 보고서 2장)" 주석. 타임아웃은 `AbortSignal.timeout(timeoutMs ?? 10_000)`.
- [ ] **Step 4: 통과 확인** — 같은 명령 / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): parse Seoul bus route info responses`

---

### Task 3: OA-1095 노선 엑셀 파서와 다운로드

**Files:**
- Create: `packages/transit-static/src/sources/bus-route-xlsx.ts`, `packages/transit-static/src/jobs/fetch-bus-route-xlsx.ts`
- Test: `packages/transit-static/src/sources/bus-route-xlsx.test.ts`

**Interfaces:**
- Produces:
  - `BUS_ROUTE_XLSX_SOURCE = "oa-1095-bus-route-xlsx"`, `DEFAULT_BUS_ROUTE_XLSX_SEQ = 58`
  - `busRouteXlsxUrl(seq: number): string` (`infId=OA-1095`, `infSeq=2`)
  - `interface BusRouteListEntry { routeId: string; routeName: string; stopCount: number }`
  - `parseBusRouteRows(rows: unknown[][]): { routes: BusRouteListEntry[]; errors: string[] }` — 헤더 `ROUTE_ID`, `노선명`, `순번`을 이름으로 찾는다. `ROUTE_ID`는 숫자 셀이어도 문자열로. 노선별 `stopCount`는 행 수. 결과는 `routeId` 오름차순.
  - `fetchBusRouteXlsx(options: { dataDir: string; seq: number; fetchImpl?: typeof fetch }): Promise<{ path: string; sha256: string; unchanged: boolean }>` → `data/raw/oa-1095-bus-route-xlsx/routes-seq<seq>.xlsx`. ZIP 시그니처가 아니면 throw(1단계 `fetchStationXlsx`와 같음. ZIP 검사 함수는 그 파일에서 export해서 같이 쓴다).
  - `latestBusRouteXlsx(dataDir: string): Promise<{ fileName: string; seq: number }>` — 가장 큰 seq. 없으면 `fetch:bus-route-xlsx`를 먼저 돌리라는 오류.

- [ ] **Step 1: 실패하는 테스트** — `parseBusRouteRows groups rows by route`: 헤더 + `[100100026, "147", 1, …]`, `[100100026, "147", 2, …]`, `[100100290, "6411", 1, …]` → `[{ routeId: "100100026", routeName: "147", stopCount: 2 }, { routeId: "100100290", routeName: "6411", stopCount: 1 }]`. `missing ROUTE_ID header`이면 `errors`에 헤더 오류, `routes` 빈 배열. `busRouteXlsxUrl(58)`이 위 "실측한 사실"의 URL과 같다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/sources/bus-route-xlsx.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): read the OA-1095 bus route list`

---

### Task 4: 노선 원본 수집 잡

**Files:**
- Create: `packages/transit-static/src/bus/scope.ts`, `packages/transit-static/src/jobs/fetch-bus-routes.ts`
- Test: `packages/transit-static/src/bus/scope.test.ts`, `packages/transit-static/src/jobs/fetch-bus-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 `fetchBusRouteOperation`, `parseRouteStations`; Task 3 `latestBusRouteXlsx`, `parseBusRouteRows`; `saveRaw`, `readRaw`.
- Produces:
  - `OUT_OF_SCOPE_ROUTE_TYPES: readonly string[] = ["2", "7", "8", "9"]`, `isInScopeRouteType(routeType: string): boolean`
  - `BUS_STATIONS_SOURCE = "bus-route-stations"`, `BUS_PATH_SOURCE = "bus-route-path"`, 파일 이름 `<busRouteId>.json`
  - `fetchBusRoutes(options: { dataDir: string; key: string; routes?: BusRouteListEntry[]; fetchImpl?: typeof fetch; delayMs?: number; maxAgeDays?: number; callsPerOperation?: number; now?: () => Date }): Promise<FetchBusRoutesResult>` (`routes`가 없으면 `latestBusRouteXlsx`로 엑셀을 읽는다)
  - `interface FetchBusRoutesResult { routes: number; fetched: Record<BusRouteOperation, number>; skippedFresh: Record<BusRouteOperation, number>; outOfScope: number; notFound: string[]; failed: { routeId: string; operation: BusRouteOperation; kind: string; detail: string }[]; stoppedBy: "quota-exceeded" | "unauthorized" | "budget" | null }`

흐름:
1. 최신 OA-1095 엑셀의 노선 목록을 `routeId` 순으로 돈다.
2. 노선마다 `getStaionByRoute` 원본이 있고 파일 수정 시각이 `maxAgeDays`(기본 7) 이내면 다시 부르지 않는다(§6.5 호출량). 아니면 부르고 `ok`일 때만 **응답 본문 그대로** 저장한다.
3. 저장된(또는 방금 받은) 정류소 원본의 첫 행 `routeType`이 범위 밖이면 `getRoutePath`를 부르지 않고 `outOfScope`에 센다. 범위 안이면 같은 신선도 규칙으로 `getRoutePath`를 받는다.
4. `retryable`·`rate-limited`는 1초, 2초, 4초 백오프로 최대 3번 다시 시도하고, 그래도 안 되면 `failed`에 남기고 다음 노선으로 간다.
5. `route-not-found`는 `notFound`에 넣고 계속. `error`는 `failed`에 넣고 계속.
6. `quota-exceeded`면 **그 오퍼레이션만** 멈춘다(`stoppedBy`). `unauthorized`면 즉시 전체를 멈춘다. 이미 저장한 파일은 그대로 둔다.
7. 한 번 실행에 오퍼레이션별 호출 수가 `callsPerOperation`(기본 950)에 닿으면 그 오퍼레이션을 멈추고 `stoppedBy: "budget"`.
8. 끝에 `routes`, 오퍼레이션별 fetched/skipped, outOfScope, notFound 수, failed 수, stoppedBy를 출력한다. 키는 출력하지 않는다.

- [ ] **Step 1: 실패하는 테스트** (임시 dataDir, 가짜 `fetchImpl`, `delayMs: 0`, 엑셀 대신 `routes` 옵션)
  - `isInScopeRouteType`: `"3"`, `"4"`, `"15"`는 true, `"2"`, `"8"`은 false.
  - `fetches stations then path for in-scope routes and saves raw bodies`: 노선 2개(routeType 4, 2) → 호출은 stations 2번, path 1번. 저장된 파일 내용이 가짜 응답 본문과 바이트 단위로 같다.
  - `skips fresh files and resumes after quota stop`: 1회차에 두 번째 stations 호출이 `<returnReasonCode>22</returnReasonCode>`를 돌려주면 `stoppedBy: "quota-exceeded"`, 첫 노선 파일만 남는다. 2회차(정상 응답)는 첫 노선 stations를 부르지 않고 나머지만 부른다.
  - `retries retryable responses then records failure`: headerCd 6만 4번 오면 호출 4번, `failed[0].kind === "retryable"`.
  - `stops everything on unauthorized and never leaks the key`: 401이면 `stoppedBy: "unauthorized"`, 그 뒤 호출 없음. 콘솔 출력과 결과 JSON 문자열에 키 원문·인코딩 키가 없다.
  - `respects per-operation budget`: `callsPerOperation: 1`이면 stations 1번 후 `stoppedBy: "budget"`.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/jobs/fetch-bus-routes.test.ts packages/transit-static/src/bus/scope.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — 요청은 순차(한도 때문), `biome-ignore lint/performance/noAwaitInLoops`에 이유를 적는다. 파일 나이는 `fs.stat().mtimeMs`와 `now()`로 계산.
- [ ] **Step 4: 통과 확인** / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): fetch bus route stations and shapes with resume and quota stop`

---

### Task 5: 정류소 전진 투영과 구간 생성

**Files:**
- Create: `packages/transit-static/src/bus/project-stops.ts`
- Test: `packages/transit-static/src/bus/project-stops.test.ts`

**Interfaces:**
- Consumes: Task 2 `BusRouteStationRow`, `parseRouteStations`, `parseRoutePath`(픽스처 테스트용)
- Produces:
  - 상수: `FIRST_STOP_WINDOW_M = 3000`, `WINDOW_SLACK_M = 1000`, `BUS_STOP_WARN_OFFSET_M = 80`
  - `interface ProjectedStop { seq: number; distanceM: number; offsetM: number; flags: string[] }`
  - `projectStopsForward(coords: [number, number][], stops: readonly BusRouteStationRow[]): { lengthM: number; stops: ProjectedStop[] }` (입력 `stops`는 seq 오름차순이라고 가정, 결과도 같은 순서)
  - `interface BusSegment { fromSeq: number; toSeq: number; startM: number; endM: number; apiSectDistM: number; flags: string[] }`
  - `buildSegments(stops: readonly BusRouteStationRow[], projected: readonly ProjectedStop[]): BusSegment[]` (인접한 두 정류소마다 1개, `apiSectDistM`은 뒤 정류소의 값)

알고리즘(시그니처와 테스트로 정해지지 않는 부분):
- 거리는 노선의 첫 좌표 위도를 기준으로 한 등장방형 평면 근사(경도 × cos(lat0))로 잰다. 지구 반지름 6,371,008.8m. 누적 거리 배열을 한 번 만들고 `lengthM`은 그 마지막 값이다. 서울 규모에서 측지 거리와의 차이는 0.1% 미만이고, 한 노선 안에서 일관되기만 하면 된다.
- 첫 정류소: 창 `[0, FIRST_STOP_WINDOW_M]`. 다음 정류소: 창 `[cursor, cursor + 2 × apiSectDistM + WINDOW_SLACK_M]`. 창과 겹치는 선분마다 점의 투영을 구해 창 범위로 자르고, 오프셋이 가장 작은 것을 고른다. `cursor`는 고른 거리로 옮긴다(감소하지 않음).
- 창 안에서 못 찾았거나 고른 오프셋이 `BUS_STOP_WARN_OFFSET_M`을 넘으면 `[cursor, lengthM]` 전체에서 다시 찾는다. 더 가까우면 그 결과를 쓰고 `window-miss` 플래그를 단다. 최종 오프셋이 80m를 넘으면 `stop-off-shape`.
- **[Task 5 리뷰 반영(2차), 위 두 규칙(창·재탐색)을 대신함]** 탐욕 전진 창 대신 단조 DP로 고른다. 정류소마다 모양이 80m(`BUS_STOP_WARN_OFFSET_M`) 안을 지나는 연속 선분 묶음마다 최근접 위치 1개를 후보로 둔다(왕복 도로면 보통 가는 길·오는 길 2개). 각 정류소는 후보 하나를 고르거나 건너뛰고(모양에서 먼 정류소), 고른 거리는 seq 순으로 감소하지 않는다. 비용 = `오프셋 / 20m` + 앞 정상 정류소와의 간격이 그 사이 `apiSectDistM` 합과 다른 정도(`|차이| / 200m`, 2000m에서 상한 10) + 건너뛴 정류소마다 12. 앞 정상 정류소 없이 첫 창 `min(FIRST_STOP_WINDOW_M, lengthM / 2)` 밖에 붙으면 상한 비용 10을 더한다(짧은 순환 노선의 닫히는 변 제외). 건너뛴 정류소는 `[앞 정류소 거리, 다음 정상 정류소 거리]`(다음이 없으면 `lengthM`까지)에서 최근접에 두고, 그 오프셋이 80m를 넘으면 `stop-off-shape`. 고른 위치가 옛 창 밖이면 `window-miss`: 창 끝은 마지막 정상 정류소 거리 + 2 × 그 뒤 `apiSectDistM` 합(건너뛴 정류소 포함) + `WINDOW_SLACK_M`이고, 정상 정류소가 아직 없으면 `min(FIRST_STOP_WINDOW_M, lengthM / 2)` + (첫 정류소가 아니면 2 × 그 앞 `apiSectDistM` 합 + `WINDOW_SLACK_M`). 이유: 탐욕 창은 좌표가 100~500m 틀린 정류소 하나가 오는 길·옆 도로에 80m 이하로 붙으면 cursor가 뛰어 뒤 정류소 수십~백여 개를 끌고 갔고(6411에서 seq 1 북 100m → 115개, seq 9 북 150m → 100개), 재탐색 범위를 줄이고 창 너비에 상한을 둬도 4방향 퍼즈에서 최대 8개가 끌려갔다. `apiSectDistM` 하나가 20km면 창이 오는 길에 닿았다. DP에서는 6411의 모든 seq를 100/150/300/500m × 4방향으로 옮겨도 다른 정류소가 5m 넘게 움직인 경우가 0이고, 원본 6411 투영은 탐욕 결과와 같다. 회귀 테스트(퍼즈, `apiSectDistM` 20km, 모양에서 먼 회차 정류소 뒤 왕복)로 고정.
- 구간 플래그: `endM - startM === 0`이면 `zero-length-segment`. 구간 길이와 `apiSectDistM`의 비율이 0.5 미만 또는 2 초과이면서 차이가 100m 넘으면 `sect-dist-mismatch`.

- [ ] **Step 1: 실패하는 테스트**
  - `projects 6411 stops monotonically`: 픽스처 117개 → `distanceM`이 단조 비감소, 최대 `offsetM` < 30, 첫 정류소 `distanceM`이 500~750, `stop-off-shape` 플래그 0개.
  - `global nearest goes backwards on 6411`: 같은 입력을 테스트 안에서 전역 최근접(`track/project.ts`의 `projectPoint`)으로 투영하면 감소하는 단계가 1개 이상(전진 창이 필요한 이유를 고정).
  - `6411 segments match fullSectDist`: 116개 구간, 구간 길이/`apiSectDistM`의 중앙값이 0.95~1.05.
  - `closed loop keeps last stop at the end`: 한 변 1km 닫힌 사각형(시작점 = 끝점), 정류소 5개(seq 1은 시작점, seq 5도 시작점과 같은 좌표, 나머지는 각 변 중간, `apiSectDistM`은 실제 간격) → seq 5의 `distanceM`이 `lengthM - 1` 이상.
  - `flags a stop far from the shape`: 직선 모양에서 300m 떨어진 정류소 → `stop-off-shape`.
  - `flags zero-length and mismatched segments`: 같은 좌표의 연속 정류소 → `zero-length-segment`, 실제 간격 500m인데 `apiSectDistM` 2000 → `sect-dist-mismatch`.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/bus/project-stops.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): project bus stops forward along route shapes`

---

### Task 6: 노선별 조립·검증과 보고서

**Files:**
- Create: `packages/transit-static/src/bus/assemble.ts`, `packages/transit-static/src/bus/report.ts`
- Test: `packages/transit-static/src/bus/assemble.test.ts`, `packages/transit-static/src/bus/report.test.ts`

**Interfaces:**
- Consumes: Task 2 파서, Task 4 `isInScopeRouteType`, Task 5 `projectStopsForward`, `buildSegments`, Task 3 `BusRouteListEntry`
- Produces:
  - `BUS_ROUTE_LOGIC_VERSION = 1` (조립 결과가 바뀌는 코드 변경마다 올린다. manifest에 들어간다.)
  - `BUS_SHAPE_ATTRIBUTION = "서울특별시 버스노선정보(공공데이터포털)"`
  - `interface BusRouteRaw { entry: BusRouteListEntry; stationsBody?: string; pathBody?: string }`
  - `interface BusIssue { level: "error" | "warning"; code: string; detail: string }`
  - `interface AssembledBusRoute { routeId: string; routeName: string; routeType: string; coords: [number, number][]; lengthM: number; stops: (BusRouteStationRow & ProjectedStop)[]; segments: BusSegment[]; qualityFlags: string[]; issues: BusIssue[] }`
  - `assembleBusRoute(raw: BusRouteRaw): { route?: AssembledBusRoute; outOfScope: boolean; issues: BusIssue[] }`
  - `MIN_VALID_ROUTE_RATIO = 0.98`
  - `assembleBusRoutes(raws: readonly BusRouteRaw[]): BusAssembleResult`
  - `interface BusAssembleResult { ok: boolean; routes: AssembledBusRoute[]; excluded: { routeId: string; routeName: string; issues: BusIssue[] }[]; missingRaw: string[]; outOfScope: number; routeTypeCounts: Record<string, number>; markdown: string }`
  - `renderBusRouteReport(result: Omit<BusAssembleResult, "markdown">): string`

규칙:
- error(그 노선을 적재에서 뺀다): `missing-stations`(정류소 원본 없음), `missing-path`(범위 안인데 모양 원본 없음), `bad-envelope`(원본이 `ok`가 아님), `no-stops`, `seq-not-contiguous`(1..n이 아님, 중복 포함), `shape-too-short`(좌표 2개 미만 또는 길이 100m 미만). `missing-stations`·`missing-path` 노선은 `excluded`가 아니라 `missingRaw`에 넣는다.
- warning(적재하되 플래그와 보고서에 남김): Task 5 플래그(`window-miss`, `stop-off-shape`, `zero-length-segment`, `sect-dist-mismatch`), `xlsx-stop-count-mismatch`(엑셀 행 수와 API 정류소 수가 다름), `mixed-route-type`(정류소 행마다 routeType이 다름, 첫 행 값을 씀).
- 노선의 `qualityFlags`는 그 노선 warning 코드의 중복 없는 목록.
- `ok`: `missingRaw`가 비어 있고(수집이 끝남), 범위 안 노선 중 적재 가능한 비율이 `MIN_VALID_ROUTE_RATIO` 이상. 출처 일부 결함으로 전체를 막지 않되(2단계와 같은 원칙), 수집이 덜 된 배치가 현재 배치를 덮어쓰지 않게 한다.
- 보고서 Markdown: 요약(엑셀 노선 수, 범위 안/밖, 적재/제외, `ok`), routeType별 개수 표, 제외 노선 표(노선명, ID, error 코드), warning 코드별 개수, 오프셋 상위 20개 정류소, `sect-dist-mismatch` 상위 20개 구간.

- [ ] **Step 1: 실패하는 테스트**
  - `assembles the 6411 fixture`: 픽스처 본문 + `{ routeId: "100100290", routeName: "6411", stopCount: 117 }` → `route.stops.length === 117`, `segments.length === 116`, `issues`에 error 없음.
  - `marks route type 2 as out of scope without requiring a path`: 정류소 본문만 있고 routeType `"2"` → `outOfScope: true`, error 없음.
  - `rejects non-contiguous seq`: seq 1, 2, 4 → error `seq-not-contiguous`, `route` undefined.
  - `warns on xlsx stop count mismatch`: `stopCount: 116` → warning `xlsx-stop-count-mismatch`, `route` 있음, `qualityFlags`에 포함.
  - `assembleBusRoutes ok rule`: 범위 안 100개 중 2개 제외 → `ok: true`. 3개 제외 → `ok: false`. 모양 원본 없는 노선 1개 → `missingRaw` 1개, `ok: false`.
  - `report lists route type counts and excluded routes`: Markdown에 `| 4 |` 행과 제외 노선 이름이 있다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/bus/` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): assemble and validate bus routes`

---

### Task 7: `build:bus-routes` 잡, 적재, CLI

**Files:**
- Create: `packages/transit-static/src/jobs/build-bus-routes.ts`
- Modify: `packages/transit-static/src/db/load.ts`, `packages/transit-static/src/cli.ts`
- Test: `packages/transit-static/src/jobs/build-bus-routes.test.ts`, `packages/transit-static/src/db/load.test.ts`(추가)

**Interfaces:**
- Consumes: Task 1 테이블, Task 3 `latestBusRouteXlsx`·`parseBusRouteRows`, Task 4 소스 이름, Task 6 `assembleBusRoutes`·`BUS_ROUTE_LOGIC_VERSION`·`BUS_SHAPE_ATTRIBUTION`, `withLogicVersion`, `isCurrentManifest`, `writeReport`
- Produces:
  - `loadBusRoutes(db: Database, routes: readonly AssembledBusRoute[], manifest: SourceManifest): Promise<{ batchId: number }>` — 한 트랜잭션, 노선마다 `bus_route` → `bus_route_shape` → 정류소(500행씩) → 구간(500행씩), 끝에 `makeCurrent("bus_route")`.
  - `busRouteManifest(xlsx: { fileName: string; sha256: string }, raws: readonly { routeId: string; stationsSha?: string; pathSha?: string }[]): SourceManifest` — 항목 3개: `routeList`(엑셀), `routeRaw`(fileName `bus-route-stations+path (<n> routes)`, sha256은 `routeId:stationsSha:pathSha`를 routeId 순으로 이은 문자열의 SHA-256), 로직 버전(`withLogicVersion(…, "busRouteLogicVersion", "bus route logic", BUS_ROUTE_LOGIC_VERSION)`).
  - `buildBusRoutes(options: { dataDir: string; db?: Database; dryRun: boolean; routes?: BusRouteListEntry[] }): Promise<{ ok: boolean; batchId?: number; jsonPath: string; mdPath: string }>` — `routes`가 있으면 엑셀을 읽지 않고, manifest의 `routeList` 항목은 fileName `routes option (<n>)`, sha256은 `routes` JSON의 SHA-256으로 만든다. 흐름은 `build-tracks.ts`와 같다: 원본 읽기 → 조립 → `writeReport(dataDir, "build-bus-routes", …)` → `ok`가 아니면 적재 안 함 → dry-run이면 적재 안 함 → manifest가 현재 배치와 같으면 적재 안 함 → `loadBusRoutes`.
  - CLI: `fetch:bus-route-xlsx [--seq 58]`(키 불필요), `fetch:bus-routes [--max-age-days 7]`(`DATA_GO_KR_API_KEY` 필요, 없으면 "DATA_GO_KR_API_KEY가 없습니다. 공공데이터포털에서 서울특별시_노선정보조회 서비스(15000193) 활용신청 후 받은 서비스키를 설정하세요." 출력 후 exit 1), `build:bus-routes [--dry-run]`. `stoppedBy`가 `quota-exceeded`·`unauthorized`면 exitCode 1.

- [ ] **Step 1: 실패하는 테스트**
  - `loadBusRoutes writes all four tables and switches current batch`: 6411 조립 결과로 적재 → 정류소 117, 구간 116, 모양 1. 두 번째 적재 후 첫 배치 `isCurrent` false.
  - `busRouteManifest changes when any route raw changes`: 한 노선의 `pathSha`만 바꿔도 `routeRaw.sha256`이 달라진다. 순서를 섞은 입력은 같은 결과.
  - `buildBusRoutes skips reload for the same manifest`: 임시 dataDir에 6411 원본 두 개를 `bus-route-stations/100100290.json`, `bus-route-path/100100290.json`으로 두고 `routes` 옵션으로 실행. 1회차 `batchId` 있음, 2회차 `batchId` undefined, 보고서 파일 2개.
  - `buildBusRoutes does not load when ok is false`: 모양 원본을 지우면 `ok: false`, `reference_batch` 행 0.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/transit-static/src/jobs/build-bus-routes.test.ts packages/transit-static/src/db/load.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `bun test` (저장소 루트) / Expected: 전체 PASS
- [ ] **Step 5: 커밋** — `feat(transit-static): build and load bus route reference batches`

---

### Task 8: 실데이터 수집·적재, 범위 확정, README

**Files:**
- Modify: `packages/transit-static/src/bus/scope.ts`(필요하면), `packages/transit-static/README.md`
- Create(필요하면): `packages/transit-static/src/bus/assemble.integration.test.ts`

이 작업은 실데이터를 보고 판단한다. 호출량: `getStaionByRoute` 약 718건, `getRoutePath` 범위 안 노선 수(약 400건). 계획 단계에서 이미 오늘 몇 건을 썼으므로 한 번에 끝나지 않으면 다음 날 다시 실행해 이어받는다.

- [ ] **Step 1: 원본 수집** — `packages/db`에서 `bun run db:migrate`, 저장소 루트에서 `bun transit fetch:bus-route-xlsx`, `bun transit fetch:bus-routes`. 출력의 `stoppedBy`가 `null`이 될 때까지(필요하면 다음 날) 다시 실행한다. `failed`가 남으면 원인을 보고서에 적는다.
- [ ] **Step 2: 범위 확정** — `bun transit build:bus-routes --dry-run` 보고서의 routeType별 개수로 범위 안 노선 수를 396과 비교한다. 380~420 밖이면 어떤 유형 코드가 차이를 만드는지 찾아 `OUT_OF_SCOPE_ROUTE_TYPES`를 고치고, 바꾼 코드와 근거(유형별 노선 예시)를 `scope.ts` 주석에 적는다. 바꾸면 `BUS_ROUTE_LOGIC_VERSION`을 올린다.
- [ ] **Step 3: 경고 검토** — 제외 노선과 `stop-off-shape`·`window-miss`·`sect-dist-mismatch` 상위 항목을 몇 개 직접 열어 원인을 분류한다(원본 결함, 기준값 문제, 알고리즘 문제). 알고리즘 문제면 Task 5에 실패하는 테스트를 먼저 더하고 고친다. 기준값만 바꿀 때는 근거를 상수 주석에 적는다.
- [ ] **Step 4: 실데이터 회귀 테스트** — `data/raw/bus-route-path/`가 있을 때만 도는 `describe.skipIf`(1단계 `assemble.integration.test.ts`와 같은 방식) 테스트: 6411과 순환 노선 1개(routeType 5)가 error 없이 조립되고 정류소 거리가 단조 증가.
- [ ] **Step 5: 적재** — `bun transit build:bus-routes`. 출력의 `batchId`, 노선·정류소·구간 수를 확인. 다시 실행하면 "원본 해시가 현재 배치와 같아 다시 적재하지 않습니다".
- [ ] **Step 6: README** — "버스 노선 명령 순서" 절: 키(`DATA_GO_KR_API_KEY`, 15000193 활용신청), 명령 3개, 한도와 이어받기, 범위 규칙, 경고 코드 뜻, 출처 표기.
- [ ] **Step 7: 검증과 커밋** — 저장소 루트 `bun test`, 바뀐 파일 `bunx ultracite fix`. 커밋 `feat(transit-static): load Seoul bus routes and document the bus pipeline`.
