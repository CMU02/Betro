# MVP 4-B 지도 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지도 탭(04)에서 내가 등록한 장소로 가는 경로 하나의 버스·지하철을 실시간으로 움직이게 그린다. 함께 만드는 것은 다음과 같다.
- 장소 칩과 경로 펼침
- 차량을 누르면 확대하고 시트를 띄우는 동작
- 장소가 없을 때의 카드와 근처 지하철 표시
- 설정의 노선별 표시

**Architecture:**
- 순수 로직은 `apps/native/lib/map/`에 두고 `bun:test`로 검증한다. 대상은 선택, 차량 거르기, 보간, 시트 모델, 근처 노선, 지표다.
- 데이터 훅(폴링, 하트비트, 참조 캐시)과 화면 컴포넌트(`components/map/`)는 그 위에 얇게 얹는다.
- 서버 API는 4-A가 만든다.

**Tech Stack:**
- Expo React Native, `@mj-studio/react-native-naver-map` 2.10.0(`NaverMapMarkerOverlay`, `NaverMapPathOverlay`)
- TanStack Query, expo-sqlite kv-store, expo-location
- Uniwind, 자체 i18n(`t`)

**Spec:** `docs/superpowers/specs/2026-11-20-mvp4-map-design.md`(이하 "지도 설계"). 선행 계획은 `docs/superpowers/plans/2026-11-20-mvp-4a-map-server.md`(4-A)이고, 4-A를 먼저 병합한다.

## Global Constraints

- 4-A의 Global Constraints를 모두 따른다. 대상은 워크트리와 브랜치 규칙, AI 서명 금지, 비밀값 출력 금지, 원격 작업 확인, 린트 게이트다.
- 화면 문구는 `apps/native/lib/i18n/messages-ko.ts`에 키로 둔다. `app/`, `components/`, `lib/`에 한글 문자열을 직접 쓰면 `no-hardcoded-copy.test.ts`가 실패한다.
- 색과 크기는 Figma 변수에서 온 토큰(`apps/native/theme/tokens.ts`, `TRANSIT_COLORS`, `lineBadgeModel`)을 쓴다. 값을 하드코딩하지 않는다(AGENTS.md).
- **사용자 위치는 기기 밖으로 보내지 않는다.** 근처 노선 계산은 기기에서 한다. 서버에는 노선·정류장 ref만 보낸다(지도 설계 2.5, 7장).
- 지도 폴링과 하트비트는 지도 탭이 포커스이고 앱이 active일 때만 돈다(지도 설계 4.5). 판단은 `useActiveSession`의 `useIsFocused` + `AppState` 패턴을 쓴다(`apps/native/lib/commute/use-active-session.ts:29-49`).
- 한 번에 한 경로의 차량만 그린다(지도 설계 2.1). 시간표 추정 상태의 버스는 그리지 않는다(MVP 설계 5.8).
- 상태 문구는 단정하지 않는다. "놓쳐요", "늦어요"를 쓰지 않는다(정확도 우선 설계 4.5).

## Review Focus

1. 등록한 경로의 노선이 설정에서 모두 꺼져 있으면, 선은 그리고 차량은 없다. 빈 지도처럼 보이지 않게 "이 경로의 노선이 모두 꺼져 있어요" 안내가 뜬다. 테스트는 Task 4에 있다.
2. 위치 권한이 거부됐으면 근처 지하철을 띄우지 않는다. 카드와 기본 카메라(서울시청)만 보이고 오류는 없다. 테스트는 Task 8에 있다.
3. 순환 버스(같은 정류장이 두 번 나옴)에서 승차 순번보다 앞선 차량만 남고, 반대쪽 반 바퀴의 차량은 빠진다. 테스트는 Task 4에 있다.
4. 관측이 두 번 연속 빠져도 마커가 사라지지 않고 제자리에 머문다. 신선도 표시만 늘어난다. 테스트는 Task 5에 있다.
5. 앱이 백그라운드에 있다가 돌아오면, 폴링이 즉시 한 번 돌고 하트비트가 다시 시작된다. 백그라운드 동안에는 요청이 0건이다. 테스트는 Task 6에 있다.

---

### Task 1: Figma 시안

**Files:** Figma `Betro App UI`(https://www.figma.com/design/MiS0r5xYKVht3Pc7YXMXpP/Betro-App-UI). 코드 변경은 없다.

**Interfaces:**
- Produces: 아래 프레임의 노드 ID 목록. 이후 Task들이 이 프레임을 따른다.
  - iOS와 Android의 04 지도 홈 변형 다섯 개
    - 장소 칩 기본
    - 칩 재탭 경로 목록
    - 버스 차량 시트
    - 지하철 차량 시트
    - 장소 없음 카드
  - 12 설정의 "지도에 표시할 노선" 섹션

- [ ] **Step 1:** `figma:figma-use` 스킬과 `figma:figma-generate-design` 스킬을 먼저 불러온다. 그다음 기존 04 지도 홈과 12 설정 프레임을 복제해 변형을 만든다.
  - 브레인스토밍 시안의 배치를 따른다. 원본은 저장소 밖에 있으니 지도 설계 2.2~2.5의 글을 기준으로 삼는다.
  - Foundations 변수(Color Dark/Light, Dimension, Transit)와 기존 컴포넌트(Chip, ListRow, LineBadge)를 쓴다.
- [ ] **Step 2: 확인.** 각 프레임을 `get_screenshot`으로 확인한다.
  Expected: 다크와 라이트에서 칩, 시트, 카드가 토큰 색을 쓴다.
- [ ] **Step 3: 기록.** 노드 ID를 이 계획 파일 맨 끝의 "Figma 노드" 절에 적고 커밋한다.
  ```bash
  git add docs/superpowers/plans/2026-11-20-mvp-4b-map-app.md
  git commit -m "docs(plan): record map figma frames"
  ```

### Task 2: 지도 데이터 클라이언트

**Files:**
- Create: `apps/native/lib/map/map-client.ts`, `apps/native/lib/map/map-client.test.ts`
- Modify: `apps/native/lib/commute/session-client.ts`(`SessionRouteView`에 `legVehicleIds`), 그 테스트

**Interfaces:**
- Consumes:
  - 4-A Task 6·7의 엔드포인트
  - `ServerClient.request(method, path, body?)`(`apps/native/lib/server/app-server.ts`)
  - `RefResult<T>`/`RefFailure` 패턴(`apps/native/lib/ref/ref-client.ts`)
- Produces(전부 `Promise<RefResult<…>>`):
  - `fetchBusMap(client: ServerClient, busRouteId: string): Promise<RefResult<BusMap>>`
  - `fetchSubwayMap(client: ServerClient, lineKey: string): Promise<RefResult<SubwayMap>>`
  - `fetchSubwayStations(client: ServerClient): Promise<RefResult<SubwayStationPoint[]>>`
  - `fetchSnapshot(client: ServerClient, kind: "bus" | "subway", etag: string | null): Promise<RefResult<{ etag: string; snapshot: BusSnapshot | SubwaySnapshot } | "not-modified">>`
  - `postWatch(client: ServerClient, busRoutes: string[]): Promise<RefResult<null>>`
  - `postRouteView(client: ServerClient, route: Route): Promise<RefResult<RouteView>>`
  - 타입 `BusMap`, `SubwayMap`, `SubwayStationPoint`, `RouteView`, `RouteViewLeg`는 4-A 응답을 zod 스키마로 정의한다. 스냅샷 차량은 지도에 필요한 필드만 파싱한다.
    - 버스: `vehId`, `routeId`, `sectOrd`, `lat`, `lng`, `lastSeenAt`, `observedAt`
    - 지하철: `rawTrainNo`, `lineKey`, `direction`, `statnId`, `status`, `stationDistanceM`, `lastSeenAt`, `observedAt`
  - `createMapRefCache(store: KvStore): { get<T>(key: string): Promise<{ etag: string; value: T } | null>; set<T>(key: string, etag: string, value: T): Promise<void> }`. 참조 데이터를 ETag와 함께 kv에 저장해서, 버전이 바뀔 때만 다시 받는다(지도 설계 4.2).

- [ ] **Step 1: 실패하는 테스트.** 가짜 `ServerClient`를 쓴다.
  ```ts
  it("fetchSnapshot sends If-None-Match and maps 304 to not-modified", …);
  it("postWatch posts { busRoutes } and maps 400 too-many-routes to invalid", …);
  it("postRouteView maps 401 to unavailable and parses legs", …);
  it("session view parses legVehicleIds and tolerates its absence (old server) as []", …);
  ```
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test apps/native/lib/map/map-client.test.ts apps/native/lib/commute`
  Expected: FAIL
- [ ] **Step 3: 구현.** `ServerClient`가 요청 헤더를 받지 못하면 `If-None-Match`를 넘길 수 있게 선택 인자를 더한다.
- [ ] **Step 4: 통과 확인**
  Run: 같은 명령
  Expected: PASS
- [ ] **Step 5: Commit**
  ```bash
  git add apps/native/lib/map apps/native/lib/commute apps/native/lib/server
  git commit -m "feat(native): map data client for refs, snapshots, watches and route views"
  ```

### Task 3: 선택 모델(장소 칩, 경로)

**Files:**
- Create: `apps/native/lib/map/selection.ts`, `apps/native/lib/map/selection.test.ts`

**Interfaces:**
- Consumes:
  - `Place`, `PlacesState`(`apps/native/lib/places/places.ts`)
  - `ActiveSessionView`(`session-client.ts`)
- Produces:
  - `export interface MapSelection { placeId: string; rank: number }`
  - `export function initialSelection(places: readonly Place[], session: ActiveSessionView | null, nowEpochMs: number): MapSelection | null`
    - 장소가 없으면 null이다.
    - 세션이 있으면 그 `planId`의 장소와, 세션 `content`가 따르는 경로 rank를 고른다. rank를 알 수 없으면 0이다.
    - 세션이 없으면 `schedule.leaveMinute`가 지금 시각(그 plan의 `schedule.timezone` 기준)과 가장 가까운 장소의 rank 0을 고른다. 하루를 원으로 보고 거리를 잰다.
  - `export function placeChips(places: readonly Place[], selection: MapSelection | null): { id: string; label: string; selected: boolean }[]`
  - `export function routeOptions(place: Place, selection: MapSelection): { rank: number; lineNames: string[]; selected: boolean }[]`. 칩 재탭 목록에 쓴다. 기본 경로와 대안 경로의 `lineName`을 순서대로 담는다.
  - 사용자가 직접 고른 선택은 모듈 수준 상태에 둔다. 앱을 다시 열 때까지만 유지하고 저장하지 않는다(지도 설계 3장).

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("returns null with no places", …);
  it("prefers the active session's plan and route rank", …);
  it("picks work at 08:05 and home at 18:10 by circular distance to leaveMinute", …);
  it("routeOptions lists base then alternatives with line names", …);
  ```
- [ ] **Step 2–4:** 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/selection.test.ts`
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): map place and route selection model"
  ```

### Task 4: 구간별 차량 거르기와 노선 표시 설정

**Files:**
- Create: `apps/native/lib/map/leg-vehicles.ts`, `apps/native/lib/map/leg-vehicles.test.ts`
- Modify: `apps/native/lib/preferences/preferences.ts`. `hiddenMapLines: string[]`를 더한다. 기본값은 `[]`이고 `FIELD_SCHEMAS`에도 넣는다. 그 테스트도 고친다.

**Interfaces:**
- Consumes:
  - Task 2의 스냅샷 차량 타입, `BusMap`, `SubwayMap`
  - `Leg`(`@Betro/commute/plan`)
- Produces:
  - `export function busVehiclesForLeg(leg: BusLeg, vehicles: readonly BusVehicle[], boardedVehicleId: string | null): BusVehicle[]`
    - 같은 노선이면서 `sectOrd < leg.board.seq`인 차량을 남긴다.
    - 순환 노선이면 승차 순번보다 앞선 한 바퀴 구간(`leg.board.seq − 노선 정류장 수의 절반`보다 큰 순번)만 남긴다.
    - `boardedVehicleId`가 있으면 그 차량만 남긴다. 하차 순번까지만이다.
  - `export function subwayVehiclesForLeg(leg: SubwayLeg, vehicles: readonly SubwayVehicle[], map: SubwayMap, boardedVehicleId: string | null): SubwayVehicle[]`
    - 같은 `lineKey`이고 같은 방향이면서, 역 순서상 승차역 앞에 있는 열차를 남긴다.
  - `export function visibleLegs(route: Route, hiddenMapLines: readonly string[]): { leg: Leg; showVehicles: boolean }[]`. 숨긴 노선도 선은 그린다. 차량만 숨긴다(지도 설계 2.3).
  - `export function allLinesHidden(route: Route, hiddenMapLines: readonly string[]): boolean`. Review Focus 1 안내에 쓴다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("keeps buses with sectOrd before the boarding seq and drops those past it", …);
  it("on a circular route keeps only the approaching half lap", …);   // Review Focus 3
  it("keeps only the boarded vehicle when boardedVehicleId is given", …);
  it("keeps subway trains in the leg direction before the boarding station", …);
  it("hidden lines keep the line but hide vehicles; allLinesHidden true when every leg line is hidden", …);   // Review Focus 1
  it("preferences parse hiddenMapLines and default to []", …);
  ```
- [ ] **Step 2–4:** 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/leg-vehicles.test.ts apps/native/lib/preferences`
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): filter vehicles per leg and add hidden map lines preference"
  ```

### Task 5: 보간과 7.2 지표

**Files:**
- Create: `apps/native/lib/map/motion.ts`, `apps/native/lib/map/motion.test.ts`, `apps/native/lib/map/motion-metrics.ts`, `apps/native/lib/map/motion-metrics.test.ts`

**Interfaces:**
- Consumes:
  - `BusMap.shape`, `BusMap.stops`(순번별 노선 거리는 정류장 좌표를 선에 투영해 구한다)
  - `SubwayMap` 역의 `offsetM`과 `nextRunSec`
- Produces:
  - `export interface TrackPoint { distanceM: number; observedAt: number; nextStopDistanceM: number | null }`. 관측 하나를 노선 위 거리로 바꾼 값이다.
  - `export interface MotionState { shownDistanceM: number; lastObservedAt: number; speedMps: number; ceilingM: number | null }`
  - `export function observe(state: MotionState | null, point: TrackPoint): { state: MotionState; violation: "backward" | "jump" | null }`
    - 뒤로 가는 관측이면 `shownDistanceM`을 그대로 두고 멈춘다. 이것은 관측이 뒤로 간 것으로, 표시 위치는 그대로라 위반으로 세지 않는다.
    - 속도는 직전 두 관측으로 추정하고, 정류장 간격과 시간표 역간 시간으로 상한을 둔다.
    - `ceilingM`은 아직 도착이 관측되지 않은 다음 정류장(역)의 거리다.
    - 위반은 새 관측을 받은 순간 표시 위치가 바뀐 결과로 판단한다. 표시 위치가 뒤로 가면 `backward`, 정류장 한 구간 이상 앞으로 뛰면 `jump`다(지도 설계 4.4).
  - `export function positionAt(state: MotionState, nowMs: number): number`. `min(shownDistanceM + speedMps × 경과초, ceilingM ?? ∞)`이고 절대 줄지 않는다.
  - `export function pointAlong(shape: readonly [number, number][], distanceM: number): { latitude: number; longitude: number; bearing: number }`
  - `motion-metrics.ts`: `export function createMotionMetrics(store: KvStore, nowMs: () => number): { record(violation: "backward" | "jump" | null): void; summary(): { updates: number; backward: number; jump: number; ratio: number } }`
    - 하루 단위로 kv에 쌓는다.
    - 하루에 한 번 Sentry 메시지 `map-motion-daily`로 숫자만 보낸다. 위치는 보내지 않는다.
    - 설정의 개발자 섹션에 `summary()`를 보여 준다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("never moves backward when a new observation is behind the shown position", …);
  it("does not extrapolate past the next unobserved stop", …);
  it("keeps the marker at its last position through two missed observations", …);   // Review Focus 4
  it("counts a jump when a new observation forces the shown position forward by more than one stop interval", …);
  it("subway progress between stations uses nextRunSec", …);
  it("metrics ratio = (backward + jump) / updates, reset per day", …);
  ```
- [ ] **Step 2–4:** 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/motion.test.ts apps/native/lib/map/motion-metrics.test.ts`
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): forward-only vehicle motion with stop ceilings and motion metrics"
  ```

### Task 6: 지도 데이터 훅(보일 때만 폴링, 하트비트, 경로 보기)

**Files:**
- Create: `apps/native/lib/map/use-map-visible.ts`, `apps/native/lib/map/use-map-data.ts`, `apps/native/lib/map/polling.ts`, `apps/native/lib/map/polling.test.ts`

**Interfaces:**
- Consumes: Task 2·3·4·5
- Produces:
  - `export function useMapVisible(): boolean`. `useIsFocused() && AppState active`다.
  - `polling.ts`(순수):
    - `export function createPoller(opts: { intervalMs: number; run: () => Promise<void>; now: () => number; schedule: (fn: () => void, ms: number) => () => void }): { setVisible(visible: boolean): void; dispose(): void }`
    - 보이게 바뀌는 순간 `run`을 한 번 바로 돌리고, 그 뒤로는 `intervalMs`마다 돈다.
    - 숨겨지면 예약을 취소한다.
  - `export function useMapData(selection: MapSelection | null, places: readonly Place[]): MapData`
    - `MapData`는 `{ route: Route | null; legs: { leg: Leg; showVehicles: boolean; shape: [number, number][]; vehicles: RenderVehicle[] }[]; view: RouteView | null; source: "session" | "route-view"; allHidden: boolean }`다.
    - 간격은 상수로 둔다.
      - 스냅샷 10초(서버 `max-age=10`과 맞춤)
      - 하트비트 60초(서버 TTL 90초보다 짧게)
      - 경로 보기 15초
    - 선택 경로가 활성 세션의 `planId`와 rank이면 `useActiveSession`의 값을 쓴다(`source: "session"`, 지도 설계 4.6). 아니면 `postRouteView`를 쓴다.
    - 하트비트는 그 경로 버스 노선의 `seoul-bus` ref를 `postWatch`로 보낸다. `seoul-bus`가 아닌 출처는 보내지 않는다.

- [ ] **Step 1: 실패하는 테스트(`polling.test.ts`, 가짜 시계)**
  ```ts
  it("runs immediately on becoming visible, then every interval", …);
  it("makes zero calls while hidden and resumes with an immediate run", …);   // Review Focus 5
  it("dispose cancels the pending run", …);
  ```
- [ ] **Step 2–4:** 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/polling.test.ts`
  - 훅은 `bun run check-types`로 타입만 확인한다.
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): visibility-gated map polling, watch heartbeat and route view"
  ```

### Task 7: 차량 시트 모델

**Files:**
- Create: `apps/native/lib/map/sheet-model.ts`, `apps/native/lib/map/sheet-model.test.ts`
- Modify: `apps/native/lib/i18n/messages-ko.ts`(`map.sheet.*`)

**Interfaces:**
- Consumes: Task 2의 `RouteView`/세션 뷰, `BusMap`/`SubwayMap`, Task 4의 구간
- Produces:
  - `export interface SheetModel { lineLabel: string; directionKey: MessageKey; directionParams: MessageParams; freshness: { live: boolean; secondsAgo: number }; trainNo: string | null; stops: { name: string; state: "past" | "now" | "next" | "mine" }[]; minutesToMine: number | null; estimated: boolean }`
  - `export function sheetModel(input: { leg: Leg; vehicleId: string; observedAt: number; positionSeq: number; map: BusMap | SubwayMap; view: RouteViewLeg | null; nowMs: number }): SheetModel`
    - 정류장 줄은 지난 정류장 1개, 현재, 다음 정류장들을 거쳐 내 승차 정류장(`mine`)에서 끝난다.
    - `minutesToMine`은 `view.approaching`에 그 `vehicleId`가 있을 때만 값이 있다(지도 설계 2.8). 내림한 분이다.
    - `estimated`는 그 항목의 `method`가 시간표, 배차간격, 외삽 중 하나일 때 true다.
  - 문구 키:
    - `map.sheet.direction.bus`: "{name} 방면"
    - `map.sheet.direction.subway`: "{loop} · {name} 방면"
    - `map.sheet.live`: "실시간 · {seconds}초 전 위치"
    - `map.sheet.estimated`: "시간표 추정"
    - `map.sheet.mine`: "내 정류장"
    - `map.sheet.mineStation`: "내가 탈 역"
    - `map.sheet.minutes`: "{minutes}분"
    - `map.sheet.trainNo`: "열차 {no}"

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("bus sheet lists one past stop, now, next stops and ends at my stop with minutes from approaching", …);
  it("no minutes when the vehicle is not on the boarding board", …);
  it("marks estimated when method is headway", …);
  it("subway sheet includes train number and loop direction", …);
  ```
- [ ] **Step 2–4:** 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/sheet-model.test.ts apps/native/lib/i18n`
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): vehicle sheet model and copy"
  ```

### Task 8: 장소 없음 카드와 근처 지하철

**Files:**
- Create: `apps/native/lib/map/nearby.ts`, `apps/native/lib/map/nearby.test.ts`, `apps/native/lib/map/use-here.ts`
- Modify: `apps/native/lib/i18n/messages-ko.ts`(`map.empty.*`)

**Interfaces:**
- Consumes: Task 2의 `SubwayStationPoint[]`, `getPermissionsState`·`PermissionStatus`(`apps/native/lib/permissions/permissions.ts`)
- Produces:
  - `export function nearbyLines(stations: readonly SubwayStationPoint[], here: { latitude: number; longitude: number }, radiusM: number): string[]`
    - 반경 안 역들의 노선 키를 거리순으로, 중복 없이 돌려준다.
    - 기본 반경 상수는 `NEARBY_RADIUS_M = 1500`이다.
  - `export function useHere(): { latitude: number; longitude: number } | null`
    - 위치 권한이 `granted`일 때만 `getCurrentPositionAsync`를 한 번 부른다. 정확도는 `Balanced`다.
    - 결과는 화면 상태에만 둔다. 저장하거나 서버로 보내지 않는다.
  - 문구 키:
    - `map.empty.title`
    - `map.empty.register`: "집·회사 등록하고 출퇴근 차량 보기"
    - `map.empty.search`: "어디로 가세요?". 이 버튼은 길찾기가 붙기 전까지 렌더하지 않는다(지도 설계 6장).

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("returns lines of stations within radius ordered by distance without duplicates", …);
  it("returns [] when nothing is within radius", …);
  it("useHere contract: permission denied → no location call (tested via an injected getter)", …);   // Review Focus 2
  ```
- [ ] **Step 2–4:** 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/nearby.test.ts`
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): nearby subway lines from device location"
  ```

### Task 9: 지도 화면 조립

**Files:**
- Modify: `apps/native/app/(tabs)/index.tsx`
- Create:
  - `apps/native/components/map/place-chips.tsx`(Task 3 모델, 기존 `Chip` 사용, 선택 칩에 ▾/▴)
  - `apps/native/components/map/route-menu.tsx`
  - `apps/native/components/map/route-lines.tsx`(`NaverMapPathOverlay`, 노선 전체는 옅게, 승차~하차는 진하게)
  - `apps/native/components/map/vehicle-markers.tsx`(`NaverMapMarkerOverlay`, `requestAnimationFrame`으로 `positionAt` 적용, `smoothVehicleMotion`이 꺼져 있으면 관측 위치로 바로 이동)
  - `apps/native/components/map/vehicle-sheet.tsx`(Task 7 모델, 아래에서 올라오는 카드, 끌어내리기와 빈 지도 탭으로 닫기)
  - `apps/native/components/map/empty-card.tsx`
- Modify: `apps/native/lib/i18n/messages-ko.ts`(`map.chips.*`, `map.routeMenu.*`, `map.allHidden`)

**Interfaces:**
- Consumes: Task 3~8 전부, `NaverMapViewRef.animateCameraTo`/`animateRegionTo`
- Produces: 화면만 있다. 동작은 지도 설계 2.1~2.6, 3장을 따른다.
  - 차량을 탭하면 `animateCameraTo`(zoom 16)로 확대하고 시트를 연다. 시트가 열린 동안은 2초마다 그 차량 위치로 카메라를 옮긴다.
  - 시트를 닫으면 경로 전체 영역으로 `animateRegionTo`를 부른다.
  - 사용자가 지도를 직접 움직이면(`onCameraChanged`의 사용자 제스처) 카메라 자동 맞춤을 멈춘다.
  - 장소가 없으면 `empty-card`를 띄우고, `useHere`와 `nearbyLines`로 근처 노선 열차를 그린다. 이 경우만 한 경로 원칙의 예외다.

- [ ] **Step 1: 타입과 린트 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen/apps/native && bun run check-types && cd ../.. && bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched && bun test apps/native`
  Expected: 전부 통과한다(`no-hardcoded-copy` 포함).
- [ ] **Step 2: Commit**
  ```bash
  git commit -m "feat(native): live vehicle map with place chips, route menu and vehicle sheet"
  ```

### Task 10: 설정의 노선별 지도 표시

**Files:**
- Modify: `apps/native/app/(tabs)/settings.tsx`(새 `Section`), `apps/native/lib/i18n/messages-ko.ts`(`settings.mapLines.*`)
- Create: `apps/native/lib/map/my-lines.ts`, `apps/native/lib/map/my-lines.test.ts`

**Interfaces:**
- Produces: `export function myLines(places: readonly Place[]): { line: string; lineName: string; mode: "bus" | "subway" }[]`. 모든 장소와 모든 경로에 있는 노선을 중복 없이 모은다. 지하철을 먼저 두고, 그 안은 이름순이다.
  - 섹션에는 노선마다 `ListRow`에 `LineBadge`와 토글을 단다. 토글은 `hiddenMapLines`를 바꾼다.
  - 장소가 없으면 섹션 대신 "등록한 경로가 없어요" 행 하나를 둔다.

- [ ] **Step 1–4:** 실패하는 테스트(`dedupes lines across places and routes, subway first`) → 실패 확인 → 구현 → 통과 확인.
  Run: `bun test apps/native/lib/map/my-lines.test.ts`
- [ ] **Step 5: Commit**
  ```bash
  git commit -m "feat(native): per-line map visibility in settings"
  ```

### Task 11: 실기기 확인

**Files:** 없음. 결과는 PR 본문에 적는다.

- [ ] **Step 1: 빌드.** 4-A가 로컬 Worker나 사용자 확인 뒤의 배포 서버에 있어야 한다.
  - S20(`R3CN20S850J`)에 Android 디버그 빌드를 설치한다.
  - iPhone에 iOS 디버그 빌드를 설치한다.
  - 기기 확인 중에는 묻지 않고 진행한다. 어느 기기를 USB로 연결할지만 묻는다.
- [ ] **Step 2: 시나리오.** 각 기기에서 확인한다.
  - 장소 없음: 카드가 보이고, 위치를 허용하면 근처 지하철이 보인다.
  - 장소 등록 뒤: 칩이 보이고, 시간대에 맞는 장소가 선택된다.
  - 칩을 재탭하면 경로 목록이 펼쳐지고, 경로를 바꾸면 차량이 바뀐다.
  - 차량을 탭하면 확대되고 시트가 뜬다. 내 정류장까지의 분이 보이고, 시트를 닫으면 원래대로 돌아간다.
  - 설정에서 노선을 끄면 그 노선 차량이 사라지고, 모두 끄면 안내가 뜬다.
  - 백그라운드로 보냈다가 돌아왔을 때 즉시 갱신된다.
  - 설정 개발자 섹션의 motion 지표에서 비율이 1% 미만이다(`dev` 갱신 속도 기준).
- [ ] **Step 3: 기록.** 결과와 스크린샷 경로(scratchpad)를 PR 본문에 적는다. 알림 내용 같은 개인 화면은 적지 않는다.

## Figma 노드

(Task 1에서 채운다.)
