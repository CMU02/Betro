# MVP 찾기와 상세 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MVP 설계 8장 5단계 "찾기와 상세"를 만듭니다. 앱용 참조 데이터 묶음, 05 검색, 06 열차 상세, 07 버스 상세, 08 역 상세(와 정류장 상세), 09 즐겨찾기, 지도 홈의 검색창입니다.

**Architecture:** 세 갈래입니다.
- **참조 묶음.** 검색은 기기에서 합니다. 서버는 서울 지하철역·서울 버스 노선·서울 정류장을 담은 검색 색인을 배치 ETag로 내려 주고, 앱은 지도 참조처럼 kv에 두고 ETag가 바뀔 때만 다시 받습니다(지도 설계 4.2).
- **실시간.** 새 상류 호출은 만들지 않습니다.
  - 역 도착판은 수집기가 이미 부르는 `subway-all` 행과 D1 시간표로 Worker가 만듭니다.
  - 버스 노선 도착은 실행기의 노선별 도착 캐시를 지도 몫(`map`)으로 씁니다.
  - 정류장 상세와 즐겨찾기의 버스는 정적 배차간격만 씁니다.
- **기기 저장.** 즐겨찾기와 최근 검색은 `expo-sqlite/kv-store`에 둡니다. 서버에는 아무것도 올리지 않습니다.

**Tech Stack:** TypeScript, Bun test, Hono on Cloudflare Workers + Durable Objects, D1(drizzle), Expo(React Native, Hermes), expo-router, TanStack Query, zod.

**Spec:**
- `docs/superpowers/specs/2026-11-05-mvp-design.md` 4.1(05~09), 5.7, 5.8, 5.10, 7.2, 8장 5단계
- `docs/superpowers/specs/2026-11-20-mvp4-map-design.md` 2.4, 4.1~4.3, 6장
- 앞 단계 계획: `docs/superpowers/plans/2026-11-20-mvp-4b-map-app.md`, `docs/superpowers/plans/2026-11-23-mvp-5b-regional-bus-realtime.md`
- 다음 계획: `docs/superpowers/plans/2026-11-24-mvp-release-readiness.md`. 이 계획이 끝난 뒤에 합니다. 두 계획 모두 `messages-ko.ts`와 설정 화면을 고치므로 순서를 지킵니다.

## 설계 결정

[설계 판단]으로 표시한 것은 이 계획이 정한 것입니다. 사용자가 검토 때 바꿀 수 있습니다.

1. **검색은 기기에서 합니다. [설계 판단]** 스펙 5.7이 묶음의 방식을 구현자에게 맡겼습니다. 글자마다 서버를 부르지 않으려고 색인을 한 번 받아 둡니다.
   - 색인은 Worker가 D1 현재 배치에서 만들고, ETag는 `"search-<crosswalk 배치>-<bus 배치>"`입니다. 배치가 같으면 isolate 메모리에 캐시합니다.
   - R2 사본과 새 적재 단계는 만들지 않습니다. 배포 절차가 늘지 않게 하려는 것입니다.
   - 서울 정류장은 약 1.1만 개이고, 색인은 gzip 전 약 1MB입니다. 앱은 지도 참조 캐시(`createMapRefCache`)에 그대로 둡니다.
2. **검색 범위는 서울입니다. [사용자 결정, 스펙 2장 L70]**
   - 지하철역, 서울 시내버스(간선·지선·순환·광역·공항), 서울 마을버스(`routeType "2"`)만 넣습니다.
   - 경기·인천 노선과 그 정류장은 색인, 정류장 노선 목록, 즐겨찾기에 들어가지 않습니다.
   - 기존 `/v1/ref/bus/routes`(구간 등록용)는 바꾸지 않습니다.
3. **역 묶기. [설계 판단]** `station_crosswalk`는 노선마다 행이 따로 있습니다.
   - `nameCanonical`이 같고 묶음의 첫 역에서 700m 안이면 한 역으로 봅니다.
   - 묶음 키는 구성 역 `StopRef`를 정렬해 `,`로 이은 값입니다.
   - 이름이 같아도 멀면 따로입니다(5호선 양평과 경의중앙선 양평).
4. **찾기 규칙. [설계 판단]** 스펙이 정하지 않았습니다.
   - 정규화: NFC, 소문자, 공백 제거. 역은 질의와 이름 끝의 "역"을 떼고 비교합니다.
   - 순위: 같음(0) > 앞부분(1) > 포함(2). 같은 순위 안에서는 짧은 이름, 그다음 이름 순입니다.
   - 버스 노선은 `shortName`을, 정류장은 이름과 `arsId`(앞부분)를 봅니다.
   - "전체"는 구역마다 3개까지, 범위 칩을 고르면 50개까지 보입니다. 초성 검색은 하지 않습니다.
5. **최근 검색은 고른 결과입니다. [설계 판단]** Figma 칩은 이름(역삼역, 146)만 보입니다. 그래서 질의 글자가 아니라 고른 대상(종류, 키, 이름)을 8개까지 둡니다. 칩을 누르면 그 상세로 바로 갑니다.
6. **역 상세 도착판은 Worker가 만듭니다. [설계 판단]**
   - 실행기 큐(`#exclusive`)는 출퇴근 tick과 같이 씁니다. 그래서 역 상세는 실행기를 거치지 않습니다.
   - `POST /v1/map/station-view`가 수집기 `watchStations`(5분)와 `stationRows`를 부릅니다. 출퇴근 카드와 같은 `stationBoard`와 `fillFromTimetable`로 도착판을 만듭니다.
   - `watchStations`는 더 늦은 `until`을 남기므로 세션의 감시를 줄이지 않습니다(`collector-state.ts:186`).
   - 행이 없으면(첫 조회, `prod`, 한도 초과) 시간표만으로 다음 3대를 냅니다. 태그는 "시간표 추정"이고, 빈 도착판은 보이지 않습니다.
   - 상류 추가 호출은 0건입니다.
7. **버스 노선 상세의 도착. [설계 판단]**
   - `POST /v1/map/bus-route-view`가 실행기의 `#collectBus(…, "map")`를 씁니다. 서울 노선 하나에 60초마다 최대 1건이고, 출퇴근 세션과 캐시를 함께 씁니다.
   - 지도 몫(`dailyBudgetBusArrival − busArrivalSessionReserve`, 기본 600)에 닿거나 출처가 멈추면 부르지 않습니다. 그때 화면은 "배차 약 N분 · 시간표 추정"입니다.
   - 경기·인천 노선은 07이 없으므로 400입니다.
8. **정류장 상세와 즐겨찾기 카드의 버스는 배차간격만 보입니다. [설계 판단]**
   - 노선 N개가 서는 정류장은 1분에 N건이 듭니다. 지도 몫 600건으로는 받칠 수 없습니다.
   - 그래서 정류장 상세는 노선마다 "배차 약 N분 · 시간표 추정"을 보입니다. 행을 누르면 그 노선의 07로 가고, 07에서 실시간을 봅니다.
   - 정류장 단위 오퍼레이션(서울 `getStationByUid`)은 열린 질문입니다. 기본값은 "이번에는 쓰지 않음"입니다.
9. **버스 관측 요청은 한 곳에서 보냅니다. [설계 판단]**
   - `POST /v1/map/watch`는 설치의 감시 목록을 통째로 바꿉니다. 그래서 지도와 07이 따로 보내면 서로 지웁니다.
   - `lib/map/watch-registry.ts`가 화면별 요청을 모아 합집합을 보냅니다. 최대 6개이고, 앞에 보이는 화면이 우선입니다.
10. **열차 상세.**
    - 스냅샷 열차(`lineKey`, `rawTrainNo`)로 위치를 보고, `tripId`가 있으면 `GET /v1/ref/subway/trips/:tripId`로 정차 시각을 봅니다.
    - `tripId`가 없거나 열차가 스냅샷에서 빠지면, 노선 지도 참조의 역 목록만 보이고 "시간표 정보 없음"을 띄웁니다.
    - 역 도착판의 `trainNo`(`btrainNo`)는 ALL 출처 스냅샷의 `rawTrainNo`와 같은 값입니다(`normalize.ts:255`). 위치 출처 열차와 이어지지 않는 경우는 위의 물러섬으로 갑니다.
11. **시각은 서버가 시간대와 함께 줍니다. [스펙 5.10 원칙 2]**
    - 정차 시각과 첫차·막차는 epoch ms로 받고, 응답의 `timezone`으로 그립니다.
    - 버스 첫차·막차는 분으로 받아 `scheduledHeadwayMs(schedule, now, timezone)`(`@Betro/commute/sources/bus-schedule`)로 계산합니다.
    - 새 코드에 `Asia/Seoul`, `+09:00`을 쓰지 않습니다.
12. **즐겨찾기 대상은 역 묶음, 정류장, 버스 노선입니다. [설계 판단]** Figma 09의 칩(역·정류장·노선)을 따릅니다. 열차는 지나가는 것이라 넣지 않습니다. 개수 제한은 두지 않습니다(스펙 11.1의 취지).

## Figma 노드

파일: `Betro App UI`(`MiS0r5xYKVht3Pc7YXMXpP`). Android 프레임은 iOS를 따르고, 차이는 `SystemNav`와 상단 여백입니다.

| 화면 | iOS | iOS 라이트 | Android |
|---|---|---|---|
| 04 지도 홈 / 장소 칩(검색창 위치 기준) | `164:20202` | `168:54982` | `168:20459` |
| 05 검색 | `15:6386` | Task 1 | `15:14703` |
| 06 열차 상세 | `15:6635` | `17:22321` | `15:14882` |
| 07 버스 상세 | `15:8285` | Task 1 | `15:16488` |
| 08 역 상세 | `16:9607` | `17:22365` | `16:19515` |
| 09 즐겨찾기 | `16:11204` | Task 1 | `16:21098` |
| `EmptyState` 컴포넌트 | `92:2349` | | |

Task 1이 빈 상태, 실패 상태, 정류장 상세, 노선형 07 프레임을 더하고 이 표에 노드 ID를 적습니다. 4b(`2026-11-20-mvp-4b-map-app.md` "Figma 노드")와 같은 방식입니다.

**Figma에 있지만 만들지 않는 것**
- "도착 알림 받기", "도착 알림" 버튼(06·07·08). 10·11은 범위 밖입니다([사용자 결정], 스펙 2장).
- 혼잡도 칸(06·07). 지도 설계 5장에서 출처를 정하지 않았습니다.
- 검색창의 마이크 아이콘, 지도 홈의 필터 칩과 "실시간 312대 운행 중" 알약(4b에서 장소 칩으로 바꿨습니다).
- 08의 주소 줄. 주소 자료가 없습니다. 그 자리에는 노선 배지만 둡니다.
- 07의 차량 번호판·저상 알약은 서울 버스 스냅샷에 값(`plainNo`, `busType`)이 있을 때만 보입니다.

## Global Constraints

- 커밋 메시지와 PR 본문에 AI 서명·출처 표기(`Claude-Session:`, `Co-Authored-By: Claude`, 세션 URL)를 넣지 않습니다.
- 브랜치: `feat/regional-bus-realtime`에서 만든 `feat/mvp-search-detail`에 커밋합니다.
- 린트 게이트: `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`. 루트에서 `bunx ultracite fix/check`는 돌리지 않습니다.
- 앱에는 ES2023 배열 메서드(`toSorted`, `toReversed`, `toSpliced`, `findLast`, `findLastIndex`)를 쓰지 않습니다(`lib/hermes-compat.test.ts`). 정렬은 `.slice().sort()`입니다.
- 화면 글자는 모두 `lib/i18n/messages-ko.ts`의 키로 씁니다(스펙 5.10 원칙 1, `no-hardcoded-copy.test.ts`). Figma에 있는 글자는 그대로 옮깁니다.
- 색·크기·간격은 `theme/tokens.ts`, `TRANSIT_COLORS`, `lineBadgeModel`, `busKindOf`를 씁니다. 값을 하드코딩하지 않습니다(AGENTS.md).
- 새 코드에 `Asia/Seoul`, `+09:00` 같은 도시·시간대 리터럴을 쓰지 않습니다(스펙 5.10 원칙 2). 서버는 기존 `DEFAULT_TIMEZONE`, `SOURCE_TIMEZONE`을 씁니다.
- ID는 출처 접두사가 붙은 값(`seoul-subway:…`, `seoul-bus:…`)만 씁니다(스펙 5.10 원칙 3).
- 서버에 주소·좌표·장소 이름·즐겨찾기를 보내지 않습니다(스펙 5.2). 새 API 본문은 로그에 남기지 않습니다.
- 출퇴근 세션, 지도 홈, 구간 등록의 동작과 응답 모양을 바꾸지 않습니다. 기존 테스트가 그대로 통과해야 합니다.
- 상태 글자는 단정하지 않습니다. "놓쳐요", "늦어요"를 쓰지 않습니다(정확도 우선 설계 4.5).
- 주석과 테스트 이름은 기존 코드처럼 한국어로 씁니다.

## Review Focus

1. **실시간이 없을 때:** `prod`이거나 한도를 넘었거나 처음 연 역은 수집기 행이 없습니다. 이때 역 상세와 즐겨찾기 역 카드는 빈 칸이 아니라 시간표 도착 3대를 "시간표 추정"으로 보여야 합니다. 07은 "배차 약 N분 · 시간표 추정"이어야 합니다. 테스트는 Task 4, Task 5, Task 9에 있습니다.
2. **관측 요청 덮어쓰기:** 07을 열었다 닫고 지도로 돌아오면, 지도 경로의 버스 감시가 다음 heartbeat를 기다리지 않고 바로 돌아와야 합니다. 07이 지도 감시를 지우면 안 됩니다. 테스트는 Task 10에 있습니다.
3. **경기·인천 노출:** `gbis:`·`tago:` 노선과 정류장이 검색 결과, 정류장 노선 목록, 즐겨찾기(옛 저장값 포함)에 나오면 안 됩니다. 마을버스는 나와야 합니다. 테스트는 Task 2, Task 3, Task 8에 있습니다.
4. **같은 이름의 다른 역:** "양평"을 찾으면 두 역이 따로 나오고, "강남"은 2호선·신분당선이 한 줄로 나와야 합니다. 테스트는 Task 2에 있습니다.
5. **색인을 받지 못했을 때:** 오프라인 첫 실행에서는 검색이 "검색 자료를 불러오지 못했어요"와 다시 시도를 보여야 합니다. 받아 둔 색인이 있으면 오프라인에서도 검색되어야 합니다. 테스트는 Task 6, Task 11에 있습니다.

---

## Part A: 시안

### Task 1: Figma 빈·실패 상태와 정류장 상세 시안

Model: opus

**Files:**
- Modify: Figma `Betro App UI`. iOS·Android 페이지 맨 아래에 "MVP5 Search (Dark)", "MVP5 Search (Light)" 줄을 새로 둡니다. 기존 프레임은 건드리지 않습니다.
- Modify: 이 계획의 "Figma 노드" 표

`figma:figma-use` 스킬을 먼저 읽습니다. 기존 프레임을 복제해 만들고, 컴포넌트 인스턴스와 변수(Color Dark/Light, Dimension, Transit)만 씁니다.

- [ ] **Step 1: 다음 프레임을 만듭니다.**
  - 05 검색 / 입력 전(최근 검색만), 결과 없음(`EmptyState`), 불러오지 못함(`EmptyState`와 다시 시도 버튼)
  - 08 역 상세 / 시간표 추정만(두 방향 모두 `StatusTag` Estimated)
  - 08 정류장 상세: `TopBar`(별 포함), 정류장 이름과 `arsId · {towards} 방면`, 작은 지도, 노선 행(`BusBadge`, 방면, "배차 약 N분", `StatusTag` Estimated)
  - 07 버스 노선 상세: 06·07의 시트 구성에서 차량 칸 대신 방면 `Segmented`와 정류장 `TimelineStop` 목록. 차량이 있는 정류장에 버스 표시. 고른 차량이 있으면 기존 07 머리 구성(번호판, 다음 정류장, 도착)
  - 09 즐겨찾기 / 빈 상태(`EmptyState`, "검색에서 별을 눌러 추가해요")
  - 위 프레임의 라이트 변형
- [ ] **Step 2: 만든 노드 ID를 "Figma 노드" 표에 적고, 각 프레임 스크린숏을 scratchpad에 남깁니다.**
- [ ] **Step 3: 커밋합니다**

```bash
git add docs/superpowers/plans/2026-11-24-mvp-search-detail.md
git commit -m "docs(plan): record Figma frames for search and detail states"
```

## Part B: 서버

### Task 2: 검색 색인 API

Model: sonnet

**Files:**
- Create: `apps/server/src/ref/search-index.ts`
- Modify: `apps/server/src/ref/routes.ts`. `routes.get("/search-index", …)`를 더합니다.
- Test: `apps/server/src/ref/search-index.test.ts`. 시드는 `apps/server/src/ref/test-seed.ts`를 넓혀 씁니다.

**Interfaces:**
- Produces:

```ts
export interface SearchStation { key: string; lat: number; lng: number; members: { line: string; stop: string }[]; name: string }
export interface SearchRoute { line: string; name: string; routeType: string; shortName: string }
export interface SearchStop { arsId: string | null; lat: number; lng: number; name: string; stop: string; towards: string | null }
export interface SearchIndex { routes: SearchRoute[]; stations: SearchStation[]; stops: SearchStop[] }
export const STATION_GROUP_RADIUS_M = 700;
export function groupStations(rows: readonly { lat: number; line: string; lng: number; name: string; stop: string }[]): SearchStation[];
export async function buildSearchIndex(db: Database): Promise<{ etag: string; index: SearchIndex } | null>;
```

- `GET /v1/ref/search-index`: 200 본문은 `SearchIndex`, `Cache-Control: public, max-age=3600`, `ETag: "search-<crosswalk>-<bus>"`. `If-None-Match`가 맞으면 304입니다. 현재 배치가 없으면 503입니다.
- 정류장은 `source = 'seoul'` 노선의 `bus_route_stop`을 `stationId`로 묶습니다. `stop = busStop("seoul", stationId)`, 이름·`arsId`·좌표는 그 정류장의 첫 행입니다.
- `towards`는 그 정류장을 지나는 노선들에서 다음 순번 정류장 이름 중 가장 많은 것입니다. 같으면 이름 순으로 앞선 것이고, 모든 노선의 마지막 정류장이면 null입니다.
- 노선은 `region = 'seoul'`만 넣습니다. 순서는 `shortName`, `routeId`입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("같은 이름이 700m 안이면 한 역이고 멀면 따로다", () => {
	const groups = groupStations([
		{ lat: 37.4979, line: "seoul-subway:2", lng: 127.0276, name: "강남", stop: "seoul-subway:1002000222" },
		{ lat: 37.4966, line: "seoul-subway:sinbundang", lng: 127.0283, name: "강남", stop: "seoul-subway:1077000687" },
		{ lat: 37.5257, line: "seoul-subway:5", lng: 126.8865, name: "양평", stop: "seoul-subway:1005000522" },
		{ lat: 37.4925, line: "seoul-subway:gyeongui", lng: 127.4917, name: "양평", stop: "seoul-subway:1063075131" },
	]);
	expect(groups.map((g) => [g.name, g.members.length])).toEqual([["강남", 2], ["양평", 1], ["양평", 1]]);
	expect(groups[0]?.key).toBe("seoul-subway:1002000222,seoul-subway:1077000687");
});
it("색인에는 서울 노선과 마을버스만 있고 경기·인천 노선과 그 정류장은 없다", async () => { /* 시드: seoul 간선, seoul routeType "2", gbis 노선 하나(서울 정류장과 stationId를 하나 공유) → routes 2개, stops에 gbis 전용 정류장 없음 */ });
it("towards는 가장 많은 노선의 다음 정류장 이름이다", async () => {});
it("ETag가 맞으면 304이고 배치가 없으면 503이다", async () => {});
```

역 ID와 좌표는 예시입니다. 시드에 맞게 바꿉니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `cd apps/server && bun test src/ref/search-index.test.ts`
Expected: FAIL. 모듈을 찾지 못한다는 오류가 나옵니다.

- [ ] **Step 3: 구현합니다.** 정류장 질의는 D1 바인딩 100개 제한에 걸리지 않게 `IN` 목록을 쓰지 않고 `batch_id`와 `source`로 거릅니다. 거리 계산은 기존 거리 함수가 있으면 그것을 씁니다(`rg -n "haversine|distanceM" apps/server/src packages`).
- [ ] **Step 4: 통과를 확인합니다**

Run: `cd apps/server && bun test src/ref`
Expected: PASS. 기존 ref 테스트도 통과합니다.

- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src/ref
git commit -m "feat(ref): serve a Seoul search index for stations, stops and routes"
```

### Task 3: 정류장 노선 API와 열차 운행 API

Model: sonnet

**Files:**
- Modify: `apps/server/src/ref/bus.ts`. `findStopRoutes`를 더합니다.
- Modify: `apps/server/src/ref/subway.ts`. `findTripStops`를 더합니다.
- Modify: `apps/server/src/ref/routes.ts`
- Test: `apps/server/src/ref/bus.test.ts`, `apps/server/src/ref/subway.test.ts`, `apps/server/src/ref/routes.test.ts`

**Interfaces:**
- Produces:

```ts
// bus.ts
export interface StopRouteView { directionName: string | null; firstBusMinute: number | null; headwayMin: number; lastBusMinute: number | null; line: string; nextStopName: string | null; routeType: string; seq: number; shortName: string }
export interface StopRoutes { arsId: string | null; lat: number; lng: number; name: string; routes: StopRouteView[]; stop: string; timezone: string }
export async function findStopRoutes(db: Database, stop: string): Promise<{ batchId: number; result: StopRoutes | null } | null>;
// subway.ts
export interface TripStop { arriveAt: number | null; departAt: number | null; name: string; stop: string }
export interface TripStops { direction: "up" | "down"; express: boolean; line: string; stops: TripStop[]; timezone: string; tripId: number }
export async function findTripStops(db: Database, tripId: number, now: number): Promise<TripStops | null>;
```

- `GET /v1/ref/bus/stops/:stop/routes`: `stop`은 `seoul-bus:<stationId>`입니다. 다른 접두사나 없는 정류장은 404입니다. 서울 노선만 `shortName` 순으로 냅니다. `timezone`은 `SOURCE_TIMEZONE`입니다. ETag는 버스 배치(`"bus-<id>"`)입니다.
- `GET /v1/ref/subway/trips/:tripId`: 현재 시간표 배치의 trip이 아니면 404입니다. 정차 시각은 `now`가 속한 서비스일(`serviceDayAt`, 새벽 3시 경계) 0시에 초를 더한 epoch ms입니다. `Cache-Control: public, max-age=300`이고 ETag는 없습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("정류장 노선은 서울 노선만이고 다음 정류장 이름과 배차 정보를 준다", async () => {
	const found = await findStopRoutes(db, "seoul-bus:121000012");
	expect(found?.result?.routes.map((r) => [r.shortName, r.seq, r.nextStopName, r.headwayMin])).toEqual([["146", 12, "역삼역", 8]]);
	expect(found?.result?.timezone).toBe(SOURCE_TIMEZONE);
});
it("gbis 정류장 ref는 404다", async () => {});
it("trip 정차 시각은 서비스일 0시 + 초이고 자정을 넘는 정차도 이어진다", async () => {
	// 시드: 출발 86_000초, 다음 역 도착 86_600초 → departAt + 600_000 === 다음 arriveAt
});
it("다른 배치의 tripId는 404다", async () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/ref`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** 서비스일 경계는 `apps/server/src/commute/cf-ports.ts`의 `D1Timetable`이 쓰는 함수를 그대로 가져다 씁니다. 같은 계산을 다시 쓰지 않습니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/server && bun test src/ref`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src/ref
git commit -m "feat(ref): list routes at a Seoul stop and stop times of a subway trip"
```

### Task 4: 역 도착 API

Model: opus

**Files:**
- Create: `apps/server/src/map/station-view.ts`
- Modify: `apps/server/src/map/routes.ts`. `POST /v1/map/station-view`를 더합니다.
- Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts`. `stationView` 의존성을 넘깁니다(`new D1Timetable(env.DB)`, `runnerConfig(env)`).
- Modify: `apps/server/src/commute/cf-ports.ts`. `D1Timetable.firstLast`를 더합니다.
- Modify: `packages/commute/src/sources/seoul-subway.ts`. `timetableOnlyBoard`를 더합니다.
- Test: `apps/server/src/map/station-view.test.ts`, `apps/server/src/map/routes.test.ts`, `packages/commute/src/sources/seoul-subway.test.ts`

**Interfaces:**
- Consumes: `CollectorRpcClient.watchStations`, `stationRows`(`apps/server/src/collector/client.ts`), `stationBoard`, `fillFromTimetable`, `TimetablePort`
- Produces:

```ts
// packages/commute/src/sources/seoul-subway.ts
/** 수집기 행이 없을 때 시간표 도착만으로 만든 도착판. 차량 ID는 `timetable:<tripId>`, method는 "timetable". */
export function timetableOnlyBoard(arrivals: readonly { at: number; tripId: number }[], now: number): StopBoard;
// apps/server/src/map/station-view.ts
export interface StationTimetable extends TimetablePort {
	firstLast(line: string, direction: "up" | "down", statnId: string, atMs: number): Promise<{ firstAt: number | null; lastAt: number | null }>;
}
export interface StationViewDirection {
	approaching: { etaAt: number | null; method: ArrivalMethod | null; stopsAway: number | null; vehicleId: string }[];
	direction: "up" | "down";
	etaState: "live" | "estimated";
	firstAt: number | null;
	headwayMs: number | null;
	lastAt: number | null;
}
export interface StationView { generatedAt: number; stations: { directions: StationViewDirection[]; line: string; stop: string }[]; timezone: string }
export const STATION_VIEW_MAX = 6;
export const STATION_VIEW_ARRIVALS = 3;
export async function stationView(deps: { collector: CollectorRpcClient; config: Pick<CommuteConfig, "staleAfterMs" | "subwayEtaBiasSec">; timetable: StationTimetable; timezone: string }, stations: readonly { line: string; stop: string }[], now: number): Promise<StationView>;
```

- 요청 본문은 `{ stations: { line, stop }[] }`이고 `.strict()`입니다. 1~`STATION_VIEW_MAX`개이고, `seoul-subway:` 접두사만 받습니다. 설치 인증은 `/v1/map/watch`와 같습니다. 응답은 `Cache-Control: no-store`입니다.
- 방향마다 수집기 행이 있으면 `fillFromTimetable(stationBoard(null, rows, direction, bias, fetchedAt), arrivals)`를 씁니다. `approaching`은 앞 `STATION_VIEW_ARRIVALS`대입니다.
- 행이 없거나 그 방향 `approaching`이 비면 `timetableOnlyBoard`를 씁니다.
- `etaState`는 다음이 모두 맞을 때만 `"live"`입니다. 수집기 행이 있고, `now − sourceAt ≤ staleAfterMs`이고, 첫 차량의 method가 `official` 또는 `official-corrected`입니다.
- 수집기 호출이 실패해도 500을 내지 않습니다. 시간표만으로 답합니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("수집기 행이 있으면 출퇴근 카드와 같은 도착판이고 live다", async () => {
	// 가짜 수집기: statnId 1002000222 rows [{direction:"up", barvlSec:120, sourceAt: NOW-10_000, trainNo:"2241", arvlCd:"99", ordkey:"…"}]
	const view = await stationView(deps, [{ line: "seoul-subway:2", stop: "seoul-subway:1002000222" }], NOW);
	const up = view.stations[0]?.directions.find((d) => d.direction === "up");
	expect(up?.etaState).toBe("live");
	expect(up?.approaching[0]).toMatchObject({ method: "official", vehicleId: "2241" });
	expect(fakeCollector.watched).toEqual([[["1002000222"], NOW + 300_000]]);
});
it("행이 없으면 시간표 3대를 estimated로 낸다", async () => {
	const down = (await stationView(depsWithoutRows, oneStation, NOW)).stations[0]?.directions.find((d) => d.direction === "down");
	expect(down?.etaState).toBe("estimated");
	expect(down?.approaching.map((a) => a.method)).toEqual(["timetable", "timetable", "timetable"]);
});
it("묵은 행(staleAfterMs 초과)은 estimated다", async () => {});
it("수집기가 throw해도 시간표로 200이다", async () => {});
it("seoul-subway가 아닌 stop이나 7개 이상은 400이고 인증이 없으면 401이다", async () => {});
it("timetableOnlyBoard는 now 뒤 도착만 쓰고 headwayMs는 이웃한 두 도착의 차다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다**

Run: `cd packages/commute && bun test src/sources/seoul-subway.test.ts && cd ../../apps/server && bun test src/map`
Expected: FAIL.

- [ ] **Step 3: 구현합니다.** `WATCH_MS`(5분)는 실행기의 값(`runner-core.ts`)을 export해 같이 씁니다. `firstLast`는 그 서비스일 그 방향의 최소·최대 출발 시각입니다.
- [ ] **Step 4: 통과를 확인합니다**

Run: `cd packages/commute && bun test && cd ../../apps/server && bun test src`
Expected: PASS. 출퇴근 실행기 테스트도 그대로 통과합니다.

- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/sources apps/server/src
git commit -m "feat(map): serve station arrival boards from collector rows and the timetable"
```

### Task 5: 버스 노선 도착 API

Model: opus

**Files:**
- Modify: `apps/server/src/commute/runner-core.ts`. `busRouteView`를 더합니다.
- Modify: `apps/server/src/commute/runner-do.ts`, `apps/server/src/commute/client.ts`. RPC를 더합니다.
- Modify: `apps/server/src/map/routes.ts`. `POST /v1/map/bus-route-view`를 더합니다.
- Test: `apps/server/src/commute/runner-core.test.ts`, `apps/server/src/map/routes.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BusRouteViewStop { seq: number; vehicles: { etaAt: number | null; plate: string | null; stopsAway: number | null; vehicleId: string }[] }
export interface BusRouteView { etaState: "live" | "estimated"; fetchedAt: number | null; headwayMs: number | null; stops: BusRouteViewStop[] }
// CommuteRunner
busRouteView(line: LineRef, now: number): Promise<BusRouteView>;
// CommuteRunnerClient
busRouteView: (line: LineRef) => Promise<BusRouteView>;
```

- `#exclusive` 안에서 `#collectBus(routeId, false, raw, now, true, "map")`를 부릅니다. 세션과 같은 캐시 키(`busRoute:<id>`)와 지도 몫 규칙을 씁니다.
- `stops`는 받은 `RouteStopArrival[]`의 정류장마다 차량(가까운 순)입니다. 원자료가 없으면 빈 배열입니다.
- `headwayMs`는 `readBusSchedules`와 `scheduledHeadwayMs(…, now, SOURCE_TIMEZONE)`입니다.
- `etaState`는 원자료가 있고 `now − fetchedAt ≤ staleAfterMs`일 때만 `"live"`입니다.
- 라우트 본문은 `{ line }`(`.strict()`)이고 `seoul-bus:<숫자>`만 받습니다. 그 밖은 400입니다. 설치 인증이 있고, 응답은 `no-store`입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("버스 노선 보기는 세션과 같은 캐시를 쓰고 60초 안에 다시 부르지 않는다", async () => {
	await runner.busRouteView("seoul-bus:100100118", T0);
	await runner.busRouteView("seoul-bus:100100118", T0 + 30_000);
	expect(upstream.busRouteCalls).toBe(1);
});
it("지도 몫에 닿으면 부르지 않고 배차간격 추정이다", async () => {
	await store.put(`budget:${dayOf(T0)}`, config.dailyBudgetBusArrival - config.busArrivalSessionReserve);
	const view = await runner.busRouteView("seoul-bus:100100118", T0);
	expect(upstream.busRouteCalls).toBe(0);
	expect(view).toMatchObject({ etaState: "estimated", headwayMs: 8 * 60_000, stops: [] });
});
it("gbis 노선은 400이다", async () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/commute/runner-core.test.ts src/map`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/server && bun test src`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src
git commit -m "feat(map): serve a Seoul bus route's stop arrivals from the shared runner cache"
```

## Part C: 앱 기반

### Task 6: 앱 클라이언트와 스냅샷 필드

Model: sonnet

**Files:**
- Create: `apps/native/lib/search/search-client.ts`
- Create: `apps/native/lib/detail/detail-client.ts`
- Modify: `apps/native/lib/map/map-client.ts`. 스냅샷 스키마에 필드를 더합니다.
- Test: `apps/native/lib/search/search-client.test.ts`, `apps/native/lib/detail/detail-client.test.ts`, `apps/native/lib/map/map-client.test.ts`

**Interfaces:**
- Consumes: Task 2~5의 응답 모양, `fetchRefMap`·`loadCachedRef`·`createMapRefCache`(`map-client.ts`)
- Produces:

```ts
// search-client.ts. zod 스키마로 읽는다. 타입 이름은 서버와 같다.
export type { SearchIndex, SearchRoute, SearchStation, SearchStop };
export const SEARCH_INDEX_CACHE_KEY = "search-index";
export function loadSearchIndex(client: ServerClient, cache: MapRefCache): Promise<SearchIndex>; // 실패하고 캐시도 없으면 throw
// detail-client.ts
export function fetchStationView(client: ServerClient, stations: { line: string; stop: string }[]): Promise<RefResult<StationView>>;
export function fetchBusRouteView(client: ServerClient, line: string): Promise<RefResult<BusRouteView>>;
export function fetchStopRoutes(client: ServerClient, stop: string): Promise<RefResult<StopRoutes>>;
export function fetchTrip(client: ServerClient, tripId: number): Promise<RefResult<TripStops>>;
```

- 버스 스냅샷 차량에 `busType: z.string().nullable().default(null)`, `plainNo: z.string().nullable().default(null)`를 더합니다.
- 지하철 스냅샷 차량에 `tripId: z.number().nullable().default(null)`, `destinationStatnId: z.string().nullable().default(null)`, `express: z.boolean().default(false)`를 더합니다. 옛 스냅샷도 읽혀야 합니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("색인은 ETag 304면 캐시를 쓰고, 오프라인이어도 캐시가 있으면 캐시를 쓴다", async () => {});
it("오프라인이고 캐시가 없으면 throw한다", async () => {});
it("tripId·express가 없는 옛 지하철 스냅샷도 읽고 기본값을 넣는다", () => {});
it("station-view 401은 unavailable이다", async () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/search lib/detail lib/map/map-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** 상태 코드 해석은 `map-client.ts`의 `statusFailure`를 export해 같이 씁니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/search apps/native/lib/detail apps/native/lib/map/map-client.ts apps/native/lib/map/map-client.test.ts
git commit -m "feat(native): add clients for the search index and detail views"
```

### Task 7: 검색 모델과 최근 검색

Model: sonnet

**Files:**
- Create: `apps/native/lib/search/search-model.ts`
- Create: `apps/native/lib/search/recents-store.ts`
- Test: `apps/native/lib/search/search-model.test.ts`, `apps/native/lib/search/recents-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type SearchScope = "all" | "station" | "stop" | "route";
export type SearchTarget =
	| { kind: "station"; key: string; name: string }
	| { kind: "stop"; name: string; stop: string }
	| { kind: "route"; line: string; name: string; shortName: string };
export interface SearchSections { routes: SearchRoute[]; stations: SearchStation[]; stops: SearchStop[] }
export const ALL_SECTION_LIMIT = 3;
export const SCOPED_LIMIT = 50;
export function normalizeQuery(raw: string): string;
export function searchIndex(index: SearchIndex, query: string, scope: SearchScope): SearchSections;
// recents-store.ts
export const RECENTS_KEY = "betro.search.recents";
export const RECENTS_MAX = 8;
export interface RecentsStore { add: (target: SearchTarget) => void; clear: () => void; get: () => SearchTarget[]; subscribe: (listener: () => void) => () => void }
export function createRecentsStore(kv: SyncKeyValue): RecentsStore;
```

- 규칙은 설계 결정 4를 따릅니다. 빈 질의는 빈 결과입니다.
- `add`는 같은 대상을 맨 앞으로 옮깁니다. `RECENTS_MAX`를 넘으면 뒤를 버립니다.
- 저장값을 읽다 실패하면 빈 목록입니다. `gbis:`·`tago:` 대상은 읽을 때 버립니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("'강남역'과 '강남'은 같은 역을 같음 순위로 찾는다", () => {
	expect(searchIndex(INDEX, "강남역", "all").stations[0]?.name).toBe("강남");
	expect(searchIndex(INDEX, " 강남 ", "all").stations[0]?.name).toBe("강남");
});
it("같음 > 앞부분 > 포함 순이고 '전체'는 구역마다 3개다", () => {
	expect(searchIndex(INDEX, "강남", "all").stations.map((s) => s.name)).toEqual(["강남", "강남구청", "신강남"]);
});
it("숫자는 노선 번호 앞부분과 arsId 앞부분을 찾는다", () => {
	const found = searchIndex(INDEX, "146", "all");
	expect(found.routes[0]?.shortName).toBe("146");
	expect(found.stops.map((s) => s.arsId)).toEqual(["14601"]);
});
it("범위 칩을 고르면 그 구역만 50개까지다", () => {});
it("최근 검색은 같은 대상을 맨 앞으로 옮기고 8개까지다", () => {});
it("gbis 대상이 저장돼 있어도 읽을 때 버린다", () => {});
```

`INDEX`는 테스트 파일 안의 작은 고정값입니다. "신강남"은 포함 순위를 보이려는 가짜 이름입니다.

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/search`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** ES2023 배열 메서드를 쓰지 않습니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib/search lib/hermes-compat.test.ts`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/search
git commit -m "feat(native): rank search results on device and keep recent picks"
```

### Task 8: 즐겨찾기 저장소

Model: sonnet

**Files:**
- Create: `apps/native/lib/favorites/favorites.ts`
- Create: `apps/native/lib/favorites/favorites-store.ts`
- Create: `apps/native/lib/favorites/app-favorites.ts`. `appPlaces`처럼 `expo-sqlite/kv-store`로 감쌉니다.
- Test: `apps/native/lib/favorites/favorites.test.ts`, `apps/native/lib/favorites/favorites-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type Favorite =
	| { addedAt: number; id: string; kind: "station"; members: { line: string; stop: string }[]; name: string }
	| { addedAt: number; arsId: string | null; id: string; kind: "stop"; name: string; stop: string; towards: string | null }
	| { addedAt: number; id: string; kind: "route"; line: string; name: string; routeType: string; shortName: string };
export const FAVORITES_KEY = "betro.favorites";
export function favoriteId(target: Pick<Favorite, "kind"> & ({ key: string } | { stop: string } | { line: string })): string; // station:<key> | stop:<ref> | route:<ref>
export function parseFavorites(raw: string | null): Favorite[];
export function serializeFavorites(list: readonly Favorite[]): string;
export interface FavoritesStore { get: () => Favorite[]; has: (id: string) => boolean; remove: (id: string) => void; subscribe: (listener: () => void) => () => void; toggle: (favorite: Favorite) => boolean }
export function createFavoritesStore(kv: SyncKeyValue): FavoritesStore;
```

- 저장값은 `{ version: 1, favorites: Favorite[] }`입니다. 순서는 더한 순서이고, 새 것이 앞입니다.
- `parseFavorites`는 모양이 틀린 항목과 `seoul-subway:`·`seoul-bus:`가 아닌 ref를 가진 항목을 버립니다. 전체가 깨졌으면 빈 목록입니다.
- `toggle`은 있으면 지우고 false, 없으면 더하고 true입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("toggle은 더하고 다시 누르면 지운다", () => {});
it("gbis·tago 노선이나 정류장은 읽을 때 버린다", () => {
	expect(parseFavorites(JSON.stringify({ version: 1, favorites: [route("gbis:200000037"), route("seoul-bus:100100118")] })).map((f) => f.id)).toEqual(["route:seoul-bus:100100118"]);
});
it("깨진 저장값은 빈 목록이다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/favorites`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib/favorites`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/favorites
git commit -m "feat(native): store favorites on the device"
```

### Task 9: 도착 표시 모델과 공용 컴포넌트

Model: sonnet

**Files:**
- Create: `apps/native/lib/transit/eta-status.ts`
- Modify: `apps/native/lib/map/sheet-model.ts`. `ESTIMATED_METHODS`를 `eta-status.ts`의 것으로 바꿉니다. 동작은 같습니다.
- Create: `apps/native/components/ui/search-bar.tsx`(Figma `SearchBar` Idle/Active), `apps/native/components/ui/segmented.tsx`(`Segmented`), `apps/native/components/ui/icon-button.tsx`(`IconButton` Glass/Solid), `apps/native/components/transit/arrival-row.tsx`(`ArrivalRow`), `apps/native/components/transit/timeline-stop.tsx`(`TimelineStop` Passed/Current/Upcoming)
- Modify: `apps/native/components/ui/text-field.tsx`. Android 자리표시자 정렬을 고칩니다(남은 일 #4, `2026-11-10-mvp-2e-commute-screens.md:547`).
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `eta.*` 키를 더합니다.
- Test: `apps/native/lib/transit/eta-status.test.ts`, `apps/native/lib/map/sheet-model.test.ts`

**Interfaces:**
- Produces:

```ts
export const ESTIMATED_METHODS: readonly string[]; // "timetable", "headway", "extrapolated"
export type EtaStatus = { kind: "live" | "estimated" | "ended"; text: string };
/** 도착 한 칸의 글자와 태그. 단정하지 않는다. */
export function arrivalStatus(input: { etaAt: number | null; etaState: "live" | "estimated"; method: string | null; now: number }): EtaStatus;
/** 정적 배차간격 칸. null이면 운행 시간 밖. */
export function headwayStatus(headwayMs: number | null): EtaStatus;
```

- 문구(`messages-ko.ts`):
  - `eta.arriving`: "곧 도착"
  - `eta.minutes`: "{minutes}분"
  - `eta.minutesEstimated`: "약 {minutes}분"
  - `eta.headway`: "배차 약 {minutes}분"
  - `eta.ended`: "운행 종료"
- `arrivalStatus` 규칙:
  - `etaState`가 `"estimated"`이거나 method가 `ESTIMATED_METHODS`에 있으면 `kind: "estimated"`이고 "약 N분"입니다.
  - 그 밖은 `kind: "live"`이고 "N분"입니다. 1분 미만은 "곧 도착"입니다.
  - `etaAt`이 null이면 `{ kind: "estimated", text: "" }`입니다. 화면은 그 줄을 그리지 않습니다.
- `headwayStatus(null)`은 `kind: "ended"`, "운행 종료"입니다. 아니면 `kind: "estimated"`, "배차 약 N분"(반올림, 최소 1)입니다.
- 태그 글자는 기존 `dataSources.status.*.label`을 씁니다.
- `SearchBar`와 `TextField`는 Android에서 `textAlignVertical="center"`, `includeFontPadding={false}`, 세로 padding 0입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("method가 headway면 live 상태여도 시간표 추정이다", () => {
	expect(arrivalStatus({ etaAt: NOW + 300_000, etaState: "live", method: "headway", now: NOW })).toEqual({ kind: "estimated", text: "약 5분" });
});
it("공식 예측이고 1분 미만이면 곧 도착이다", () => {});
it("배차간격이 없으면 운행 종료다", () => {
	expect(headwayStatus(null)).toEqual({ kind: "ended", text: "운행 종료" });
	expect(headwayStatus(7.6 * 60_000)).toEqual({ kind: "estimated", text: "배차 약 8분" });
});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/transit lib/map/sheet-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** 컴포넌트는 Figma 컴포넌트의 변형 이름을 props로 둡니다(`state: "idle" | "active"`, `variant: "glass" | "solid"`, `state: "passed" | "current" | "upcoming"`). 크기는 Dimension 토큰입니다(검색창 높이 44, 행 높이 64).
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib`. Expected: PASS. `no-hardcoded-copy`도 통과합니다.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/transit apps/native/lib/map/sheet-model.ts apps/native/lib/map/sheet-model.test.ts apps/native/components apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): share arrival status rules and add search and timeline components"
```

### Task 10: 버스 관측 요청을 한 곳에서 보내기

Model: opus

**Files:**
- Create: `apps/native/lib/map/watch-registry.ts`
- Create: `apps/native/lib/map/app-watch-registry.ts`. `postWatch`와 `serverClient`로 앱 하나를 만듭니다.
- Modify: `apps/native/lib/map/use-map-data.ts:455-470`. heartbeat가 `postWatch`를 직접 부르지 않고 registry에 `claim("map", refs)`합니다. 지도가 보이지 않으면 `release("map")`입니다. `:456` 주석("경기·인천 노선은 보지 않는다")을 지금 동작대로 고칩니다(남은 일 #8).
- Test: `apps/native/lib/map/watch-registry.test.ts`

**Interfaces:**
- Produces:

```ts
export const WATCH_MAX = 6;
export const WATCH_HEARTBEAT_MS = 60_000;
export interface WatchRegistry {
	/** 화면 하나의 요청을 바꾼다. 합집합이 바뀌면 바로 보낸다. 나중에 claim한 화면이 앞이다. */
	claim: (owner: string, refs: readonly string[]) => void;
	release: (owner: string) => void;
	/** heartbeat에서 부른다. 합집합이 비어 있으면 보내지 않는다. */
	beat: () => Promise<void>;
}
export function createWatchRegistry(send: (refs: string[]) => Promise<void>): WatchRegistry;
```

- 합집합은 가장 최근 claim의 refs부터 담고, 중복을 빼고 `WATCH_MAX`에서 자릅니다.
- 07 화면은 `claim("bus-detail", [line])`, 떠날 때 `release`입니다(Task 14).
- 보내기 실패는 다음 beat에 다시 보냅니다. 예외를 밖으로 던지지 않습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("상세가 claim해도 지도 요청을 지우지 않고 합집합을 보낸다", async () => {
	const sent: string[][] = [];
	const registry = createWatchRegistry(async (refs) => { sent.push(refs); });
	registry.claim("map", ["seoul-bus:100100118", "gbis:200000037"]);
	registry.claim("bus-detail", ["seoul-bus:100100029"]);
	expect(sent.at(-1)).toEqual(["seoul-bus:100100029", "seoul-bus:100100118", "gbis:200000037"]);
});
it("지도가 다시 claim하면 heartbeat를 기다리지 않고 바로 보낸다", async () => {});
it("6개를 넘으면 최근 claim 쪽을 남긴다", () => {});
it("같은 합집합이면 claim이 다시 보내지 않는다", () => {});
```

`.at()`은 테스트(Bun)에서만 씁니다. 구현에는 쓰지 않습니다.

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/map/watch-registry.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현하고 `use-map-data.ts`를 registry로 옮깁니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib`. Expected: PASS. `regional-legs`, `leg-vehicles` 테스트도 그대로 통과합니다.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/map
git commit -m "feat(map): merge bus watch requests from the map and detail screens"
```

## Part D: 화면

공통 규칙:
- 새 화면은 루트 Stack의 `Stack.Protected guard={!showOnboarding}` 안에 등록합니다(`app/_layout.tsx:171-178`).
- 폴링은 `useVisiblePoll`(화면이 보일 때만)이고, 실패 칸은 `OfflineNotice`나 `EmptyState`로 보입니다.
- 화면 로직은 `lib/detail/*-model.ts`의 순수 함수에 두고, 그 함수를 테스트합니다. 화면 파일에는 테스트를 두지 않습니다(기존 방식).

### Task 11: 05 검색 화면과 지도 홈 검색창

Model: sonnet

**Files:**
- Create: `apps/native/app/search.tsx`
- Create: `apps/native/lib/search/search-view-model.ts`
- Modify: `apps/native/app/_layout.tsx`. `search`, `station/[key]`, `stop/[stop]`, `bus/[line]`, `train/[trainNo]`을 등록합니다(화면은 다음 Task들이 채웁니다).
- Modify: `apps/native/app/(tabs)/index.tsx:700-720`. 위쪽 오버레이 맨 위에 `SearchBar`(Idle)를 둡니다. 누르면 `/search`입니다. 장소 칩과 알약은 그 아래입니다(`164:20202`).
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `search.*` 키를 더합니다.
- Test: `apps/native/lib/search/search-view-model.test.ts`

**Interfaces:**
- Consumes: `loadSearchIndex`(Task 6), `searchIndex`, `createRecentsStore`(Task 7), `SearchBar`, `Chip`, `ListRow`, `EmptyState`
- Produces:

```ts
export type SearchViewState =
	| { kind: "loading" }
	| { kind: "failed" }
	| { kind: "recents"; recents: SearchTarget[] }
	| { kind: "empty" }
	| { kind: "results"; sections: SearchSections };
export function searchViewState(input: { index: SearchIndex | null; failed: boolean; query: string; recents: SearchTarget[]; scope: SearchScope }): SearchViewState;
export function targetHref(target: SearchTarget): string; // "/station/<key>" | "/stop/<stop>" | "/bus/<line>"
```

- 문구:
  - `search.placeholder`: "역, 정류장, 버스 번호 검색"
  - `search.scope.all` "전체", `.station` "역", `.stop` "정류장", `.route` "버스 노선"
  - `search.section.stations` "역", `.stops` "정류장", `.routes` "버스 노선", `.recents` "최근 검색"
  - `search.clearRecents`: "모두 지우기"
  - `search.empty.title`: "검색 결과가 없어요"
  - `search.empty.body`: "역 이름, 정류장 이름이나 번호, 버스 번호로 찾아보세요"
  - `search.failed.title`: "검색 자료를 불러오지 못했어요"
  - `search.retry`: "다시 시도"
  - `search.stopSubtitle`: "{arsId} · {towards} 방면"
  - `search.back`: "뒤로"
- Figma 05에 있는 글자가 위 값과 다르면 Figma 글자를 씁니다.
- 행 모양:
  - 역 행은 `LineBadge`(구성 노선 모두), 이름입니다.
  - 정류장 행은 `Icon/map-pin`, 이름, 부제(`arsId`나 `towards`가 없으면 그 부분을 뺍니다)입니다.
  - 노선 행은 `BusBadge` 색(`busKindOf`), `shortName`, 노선 이름입니다.
- 결과를 누르면 `recents.add` 뒤 `router.push(targetHref(target))`입니다.
- 지도 홈의 "어디로 가세요?"(`map.empty.search`)는 그대로 숨깁니다. 이 검색창과 다른 것입니다(지도 설계 6장).

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("색인이 없고 실패했으면 failed, 아직이면 loading이다", () => {});
it("질의가 비면 최근 검색, 결과가 없으면 empty다", () => {});
it("targetHref는 ref를 인코딩한다", () => {
	expect(targetHref({ kind: "stop", name: "강남역", stop: "seoul-bus:121000012" })).toBe("/stop/seoul-bus%3A121000012");
});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/search`. Expected: FAIL.
- [ ] **Step 3: 화면을 만듭니다.** 색인 쿼리는 TanStack Query(`staleTime: MAP_REF_STALE_MS`)이고, 실패하면 다시 시도 버튼이 `refetch`입니다. 입력은 바로 거르고(지연 없음), 목록은 `FlatList`입니다.
- [ ] **Step 4: 통과와 타입을 확인합니다** `cd apps/native && bun test lib && bun run check-types`. Expected: PASS, 타입 오류 0.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/app apps/native/lib/search apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): add the search screen and the map home search bar"
```

### Task 12: 08 역 상세

Model: sonnet

**Files:**
- Create: `apps/native/app/station/[key].tsx`
- Create: `apps/native/lib/detail/station-model.ts`
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `stationDetail.*`
- Test: `apps/native/lib/detail/station-model.test.ts`

**Interfaces:**
- Consumes: `fetchStationView`(Task 6), `fetchSubwayMap`(방면 이름), `arrivalStatus`(Task 9), `appFavorites`(Task 8), 색인의 `SearchStation`(`key`로 찾습니다)
- Produces:

```ts
export interface StationDirectionRow { directionLabel: string; firstAt: number | null; lastAt: number | null; rows: { status: EtaStatus; trainNo: string | null }[] }
export interface StationLineModel { line: string; directions: StationDirectionRow[] }
/** 방면 이름은 그 방향 지선의 끝 역이고, 2호선은 "내선순환"/"외선순환"을 앞에 붙인다(`map.sheet.direction.subway`). */
export function stationModel(view: StationView, maps: Record<string, SubwayMap>, now: number): StationLineModel[];
export function formatClock(epochMs: number, timezone: string): string; // "05:30"
```

- 화면 구성(Figma `16:9607`):
  - `TopBar`(뒤로, 이름, 별)
  - 노선 배지
  - 작은 지도(역 좌표 하나, 움직이지 않음). "지도에서 보기" 알약은 만들지 않습니다. 지도 홈은 등록 경로만 그리기 때문입니다(지도 설계 2.1).
  - 노선이 둘 이상이면 `Segmented`
  - "{노선} 도착 정보"와 방향마다 `ArrivalRow` 2줄
  - "첫차 · 막차" 카드
  - 아래 버튼은 "즐겨찾기" 하나입니다("도착 알림"은 만들지 않습니다).
- 폴링은 15초입니다(`STATION_VIEW_POLL_MS = 15_000`). 수집기 ALL 간격(80초)보다 자주 불러도 상류 호출은 늘지 않습니다.
- `trainNo`가 있는 행을 누르면 `/train/<trainNo>?line=<line>`입니다. 시간표 차량(`timetable:`)은 누를 수 없습니다.
- 문구:
  - `stationDetail.arrivals`: "{line} 도착 정보"
  - `stationDetail.direction`: "{name} 방면"
  - `stationDetail.firstLast`: "첫차 · 막차"
  - `stationDetail.first`: "첫차"
  - `stationDetail.last`: "막차"
  - `stationDetail.noService`: "오늘은 운행 정보가 없어요"
  - `stationDetail.favorite`: "즐겨찾기"

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("두 방향 모두 시간표뿐이면 행마다 시간표 추정이다", () => {
	const [line] = stationModel(estimatedOnlyView, MAPS, NOW);
	expect(line?.directions.flatMap((d) => d.rows.map((r) => r.status.kind))).toEqual(["estimated", "estimated", "estimated", "estimated"]);
});
it("2호선 up 방향은 '내선순환 · 성수 방면'이다", () => {});
it("formatClock은 응답의 시간대로 그린다", () => {
	expect(formatClock(Date.UTC(2026, 10, 24, 20, 30), "Asia/Tokyo")).toBe("05:30");
});
```

테스트의 시간대 값은 계산 확인용 입력입니다. 앱 코드에는 쓰지 않습니다.

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/detail`. Expected: FAIL.
- [ ] **Step 3: 화면을 만듭니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib && bun run check-types`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/app/station apps/native/lib/detail apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): add the station detail screen"
```

### Task 13: 정류장 상세

Model: sonnet

**Files:**
- Create: `apps/native/app/stop/[stop].tsx`
- Create: `apps/native/lib/detail/stop-model.ts`
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `stopDetail.*`
- Test: `apps/native/lib/detail/stop-model.test.ts`

**Interfaces:**
- Consumes: `fetchStopRoutes`(Task 6), `scheduledHeadwayMs`(`@Betro/commute/sources/bus-schedule`), `headwayStatus`(Task 9)
- Produces:

```ts
export interface StopRouteRow { directionLabel: string | null; href: string; line: string; routeType: string; shortName: string; status: EtaStatus }
export function stopModel(routes: StopRoutes, now: number): StopRouteRow[];
```

- 노선마다 `headwayStatus(scheduledHeadwayMs({ firstBusMinute, headwayMin, lastBusMinute }, now, routes.timezone))`입니다. 상류 호출은 없습니다(설계 결정 8).
- `href`는 `/bus/<line>?stop=<seq>`입니다. 07은 이 순번의 정류장을 고른 채로 열립니다.
- 화면은 Task 1의 정류장 상세 프레임을 따릅니다. 별은 `kind: "stop"` 즐겨찾기입니다. 노선 행 위에 `InlineNotice` "버스 노선을 누르면 실시간 도착을 볼 수 있어요"를 둡니다.
- 문구:
  - `stopDetail.subtitle`: "{arsId} · {towards} 방면"
  - `stopDetail.routes`: "지나는 노선"
  - `stopDetail.notice`: "버스 노선을 누르면 실시간 도착을 볼 수 있어요"
  - `stopDetail.direction`: "{name} 방면"

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("운행 시간 안이면 배차 약 N분, 밖이면 운행 종료다", () => {});
it("방면이 없는 노선은 directionLabel이 null이다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/detail`. Expected: FAIL.
- [ ] **Step 3: 화면을 만듭니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib && bun run check-types`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/app/stop apps/native/lib/detail apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): add the bus stop detail screen with headway estimates"
```

### Task 14: 07 버스 노선 상세

Model: sonnet

**Files:**
- Create: `apps/native/app/bus/[line].tsx`
- Create: `apps/native/lib/detail/bus-route-model.ts`
- Modify: `apps/native/components/map/vehicle-sheet.tsx`. 버스 시트에 "자세히" 행을 더합니다. 누르면 `/bus/<line>?veh=<vehId>`입니다.
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `busDetail.*`
- Test: `apps/native/lib/detail/bus-route-model.test.ts`

**Interfaces:**
- Consumes: `fetchBusMap`(정류장·모양·방면), `fetchBusRouteView`(Task 5, 6), 버스 스냅샷(`plainNo`, `busType`), `appWatchRegistry`(Task 10), `arrivalStatus`, `headwayStatus`
- Produces:

```ts
export interface BusTimelineStop { name: string; seq: number; state: "passed" | "current" | "upcoming"; status: EtaStatus | null; vehicleHere: boolean }
export interface BusRouteModel { directions: string[]; selectedVehicle: { lowFloor: boolean; nextStopName: string | null; plate: string | null; status: EtaStatus | null } | null; stops: BusTimelineStop[] }
export function busRouteModel(input: { map: BusMap; now: number; selectedDirection: string | null; selectedSeq: number | null; selectedVehicleId: string | null; vehicles: BusSnapshotVehicle[]; view: BusRouteView | null }): BusRouteModel;
```

- 방향은 정류장의 `directionName`이 바뀌는 곳으로 나눕니다. 이름이 없는 노선은 방향 칸을 숨깁니다.
- 정류장 줄의 `status`는 그 정류장에 가장 가까운 차량의 `arrivalStatus`입니다. `view`가 없거나 estimated면 고른 정류장 한 곳에만 `headwayStatus`를 둡니다.
- 고른 차량이 스냅샷에서 빠지면 `selectedVehicle`은 null이고 화면은 노선 보기로 돌아갑니다.
- `busType === "1"`이면 저상입니다. 서울 버스 위치 API의 값입니다. 구현 전에 `packages/realtime/src/__fixtures__/bus-6411.json`에서 확인합니다.
- 화면은 보이는 동안 `claim("bus-detail", [line])`, 떠나면 `release("bus-detail")`입니다. 폴링은 스냅샷 10초, 노선 보기 30초입니다.
- 문구:
  - `busDetail.title`: "{shortName}번"
  - `busDetail.direction`: "{name} 방면"
  - `busDetail.nextStop`: "다음 정류장"
  - `busDetail.arrival`: "도착"
  - `busDetail.lowFloor`: "저상"
  - `busDetail.notice`: "버스 위치는 실시간으로 갱신돼요"
  - `busDetail.running`: "{n}대 운행 중"
  - `map.sheet.more`: "자세히"

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("노선 보기가 estimated면 고른 정류장에 배차 약 N분만 둔다", () => {});
it("고른 차량의 다음 정류장과 도착을 낸다", () => {});
it("고른 차량이 스냅샷에 없으면 selectedVehicle은 null이다", () => {});
it("다른 노선 차량은 타임라인에 올리지 않는다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/detail`. Expected: FAIL.
- [ ] **Step 3: 화면을 만듭니다.** 위 지도는 노선 모양과 차량 마커만 그리고, 기존 `RouteLines`, `VehicleMarkers`를 다시 씁니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib && bun run check-types`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/app/bus apps/native/lib/detail apps/native/components/map/vehicle-sheet.tsx apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): add the bus route detail screen"
```

### Task 15: 06 열차 상세

Model: sonnet

**Files:**
- Create: `apps/native/app/train/[trainNo].tsx`
- Create: `apps/native/lib/detail/train-model.ts`
- Modify: `apps/native/components/map/vehicle-sheet.tsx`. 지하철 시트에도 "자세히"(`/train/<rawTrainNo>?line=<line>`)를 더합니다.
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `trainDetail.*`
- Test: `apps/native/lib/detail/train-model.test.ts`

**Interfaces:**
- Consumes: 지하철 스냅샷(`tripId`, `destinationStatnId`, `express`, `statnId`, `status`), `fetchTrip`(Task 6), `fetchSubwayMap`, 색인 `stations`(목적지 이름)
- Produces:

```ts
export interface TrainModel { destinationName: string | null; express: boolean; freshness: { live: boolean; secondsAgo: number } | null; hasTimetable: boolean; nextStopName: string | null; stops: { name: string; state: "passed" | "current" | "upcoming"; time: string | null }[] }
export function trainModel(input: { map: SubwayMap; now: number; stationsById: Record<string, string>; trip: TripStops | null; vehicle: SubwaySnapshotVehicle | null }): TrainModel;
```

- 정차 목록은 `trip`이 있으면 그 정차들이고, 없으면 그 방향 지선의 역입니다(`time: null`, `hasTimetable: false`).
- 현재 역은 차량의 `statnId`입니다. 차량이 없으면 모든 역이 `upcoming`이고 `freshness`는 null입니다.
- 신선도는 지도 시트와 같은 규칙(`map.sheet.live`, `map.sheet.stale`)입니다.
- 문구:
  - `trainDetail.title`: "{trainNo} 열차"
  - `trainDetail.subtitle`: "{destination}행 · {direction}"
  - `trainDetail.express`: "급행"
  - `trainDetail.nextStation`: "다음 역"
  - `trainDetail.notice`: "열차 위치는 역 도착 신호와 시간표로 계산돼요"
  - `trainDetail.noTimetable`: "이 열차의 시간표 정보가 없어요"
  - `trainDetail.gone`: "이 열차의 위치를 더 받지 못했어요"

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("tripId가 없으면 지선 역 목록이고 시각이 없다", () => {});
it("현재 역 앞은 passed, 뒤는 upcoming이다", () => {});
it("차량이 사라지면 freshness가 null이다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/detail`. Expected: FAIL.
- [ ] **Step 3: 화면을 만듭니다.** 별(즐겨찾기)은 두지 않습니다(설계 결정 12).
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib && bun run check-types`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/app/train apps/native/lib/detail apps/native/components/map/vehicle-sheet.tsx apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): add the train detail screen"
```

### Task 16: 09 즐겨찾기 탭

Model: sonnet

**Files:**
- Modify: `apps/native/app/(tabs)/favorites.tsx`. 자리만 있던 화면을 채웁니다.
- Create: `apps/native/lib/favorites/favorites-model.ts`
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `favorites.*`
- Test: `apps/native/lib/favorites/favorites-model.test.ts`

**Interfaces:**
- Consumes: `appFavorites`(Task 8), `appPlaces`, `fetchStationView`, `fetchStopRoutes`, `stationModel`, `stopModel`, `PlaceShortcut`에 해당하는 기존 장소 칩
- Produces:

```ts
export type FavoritesFilter = "all" | "station" | "stop" | "route";
export function filterFavorites(list: readonly Favorite[], filter: FavoritesFilter): Favorite[];
/** 화면에 보이는 역 즐겨찾기만 한 번에 묻는다. STATION_VIEW_MAX를 넘으면 나눈다. */
export function stationViewBatches(list: readonly Favorite[]): { line: string; stop: string }[][];
```

- 화면 구성(Figma `16:11204`):
  - `LargeTitle` "즐겨찾기". `IconButton/Add`는 `/search`로 갑니다.
  - 필터 칩 "전체·역·정류장·노선"
  - "내 장소"(기존 장소 칩, "관리"는 출퇴근 탭으로)
  - 카드 목록
- 역 카드는 방향마다 첫 도착 한 줄(`ArrivalRow`, 15초 폴링, 상류 0건)입니다.
- 정류장 카드는 노선마다 "배차 약 N분"입니다(`fetchStopRoutes`, `stopModel`).
- 노선 카드는 `BusBadge`, 번호, 노선 이름만 보입니다. 배차 정보를 주는 노선 단위 API가 없고, 실시간은 07에서 봅니다.
- 카드를 누르면 그 상세로 갑니다. `Icon/ellipsis`는 "즐겨찾기에서 빼기" 한 항목입니다.
- 빈 상태는 Task 1의 프레임입니다.
- 문구:
  - `favorites.title`: "즐겨찾기"
  - `favorites.filter.all` "전체", `.station` "역", `.stop` "정류장", `.route` "노선"
  - `favorites.myPlaces`: "내 장소"
  - `favorites.manage`: "관리"
  - `favorites.remove`: "즐겨찾기에서 빼기"
  - `favorites.empty.title`: "즐겨찾기가 없어요"
  - `favorites.empty.body`: "검색에서 별을 눌러 추가해요"
  - `favorites.empty.action`: "검색하기"

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("필터는 종류만 남긴다", () => {});
it("역 즐겨찾기 7개 노선은 6개와 1개로 나눠 묻는다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/favorites`. Expected: FAIL.
- [ ] **Step 3: 화면을 만들고, 08·정류장·07 화면의 별을 `appFavorites.toggle`에 연결합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib && bun run check-types`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add "apps/native/app/(tabs)/favorites.tsx" apps/native/app apps/native/lib/favorites apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): fill the favorites tab"
```

### Task 17: 전체 확인

Model: sonnet

- [ ] **Step 1: 전체 테스트, 타입, 린트를 돌립니다**

Run: 각 패키지에서 `bun test`(`packages/commute`, `packages/realtime`, `apps/server`(`src`), `apps/native`(`lib`, `components`)), 그리고 `bun run check-types`, `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`.
Expected: 실패 0, 타입 오류 0, 린트 오류 0.

- [ ] **Step 2: 서울 동작이 그대로인지 봅니다.**

Run: `git diff feat/regional-bus-realtime -- '*.test.ts' | rg '^-\s*(it|expect)\('`
Expected: 출력이 없습니다. 이 계획은 기존 테스트의 단언을 지우거나 바꾸지 않습니다.
- [ ] **Step 3: 시뮬레이터에서 한 번 봅니다(iOS).** 실기기 확인과 배포는 `2026-11-24-mvp-release-readiness.md`의 마지막 Task가 모아서 합니다.
  - 지도 홈 검색창 → "강남" → 역 상세 → 별 → 즐겨찾기 탭에 보임
  - "146" → 노선 상세 → 지도로 돌아와 등록 경로 차량이 계속 보임
  - 정류장 결과 → 정류장 상세 → 노선 행 → 07
- [ ] **Step 4: 결과를 이 계획 끝에 적고 커밋합니다**

```bash
git add docs/superpowers/plans/2026-11-24-mvp-search-detail.md
git commit -m "docs(plan): record search and detail verification"
```

## 열린 질문 (사용자만 답할 수 있음)

1. 정류장 단위 실시간(서울 `getStationByUid`, 오퍼레이션 한도 따로)을 신청해 정류장 상세와 즐겨찾기에 실시간을 붙일까요? **기본값: 이번에는 하지 않고 배차간격 추정만 보입니다.**
2. 검색 색인을 R2에 미리 만들어 둘까요? **기본값: Worker가 D1에서 만들고 메모리에 캐시합니다.**
3. 즐겨찾기 개수 상한이 필요할까요? **기본값: 두지 않습니다.**
