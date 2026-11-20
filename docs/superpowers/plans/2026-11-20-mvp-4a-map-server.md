# MVP 4-A 지도 서버·데이터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지도 앱(4-B)이 쓸 서버 쪽을 만든다. 범위는 버스 배차간격 정적 적재, 도착판이 없을 때의 배차 추정, 도착정보 호출 일원화와 경로 보기 API, 보는 동안만 관측하는 버스 관측 요청, 지도용 참조 데이터 API, 활성 세션의 차량 ID 노출이다.

**Architecture:**
- 버스 도착정보(`getArrInfoByRouteAll`)는 지금처럼 출퇴근 실행기 DO(`RunnerCore`)만 부른다. 실행기에 "지도 용도" 호출과 출퇴근 세션 몫(reserve)을 더하고, 경로 하나를 `estimateRoute`로 계산하는 `routeView` RPC를 연다.
- 버스 위치(`getBusPosByRtid`)는 수집기 DO가 맡는다. 설치별 관측 요청 집합(만료 시각 포함)을 `config.busRouteIds`와 합쳐 스케줄에 넣는다.
- Worker에 `/v1/map/*`(설치 인증)와 `/v1/ref/map/*`(공개, 배치 ETag)를 더한다.

**Tech Stack:** Bun(`bun:test`), TypeScript, Hono, Cloudflare Workers·Durable Objects·D1, drizzle-kit(turso dialect), zod.

**Spec:** `docs/superpowers/specs/2026-11-20-mvp4-map-design.md`(이하 "지도 설계"). 상위 문서는 `docs/superpowers/specs/2026-11-05-mvp-design.md`(이하 "MVP 설계")이고, 짝 계획은 `docs/superpowers/plans/2026-11-20-mvp-4b-map-app.md`(4-B)다.

## Global Constraints

- 작업 위치는 워크트리 `/Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen`이다. 브랜치는 develop에서 딴 `docs/mvp4-map-trip-design`이다. 구현 브랜치를 따로 만들려면 develop에서 딴다.
- PR은 develop으로 보내고 영어로 쓴다. 명령은 절대 경로로 실행하고, 원래 저장소 루트(`/Users/choehyeonjun/Project/Betro`)로 `cd`하지 않는다. bare `git stash`도 쓰지 않는다.
- 커밋 메시지와 PR 본문에 AI 서명, `Co-Authored-By`, 세션 URL 같은 출처 표기를 넣지 않는다.
- 비밀값(`DATA_GO_KR_API_KEY`, `SEOUL_OPEN_API_KEY`, 설치 비밀값, 푸시 토큰 등)은 화면, 로그, 문서, 테스트 픽스처 어디에도 출력하지 않는다.
- 사용자에게 먼저 확인받을 일: 원격 D1 마이그레이션·적재(`--remote`), Worker 배포, push, PR 병합. 이 계획의 단계들은 로컬 D1(`--local`)과 테스트까지만 한다.
- 린트 게이트는 `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`다. 루트에서 `bunx ultracite fix/check`를 돌리지 않는다.
- 한도와 시간 값은 코드에 박지 않고 설정값(env)으로 둔다. 기본값만 코드에 둔다(MVP 설계 6장).
- 시간대는 데이터다. 코드에 `Asia/Seoul`이나 `+09:00`을 직접 쓰지 않고, 기존 `DEFAULT_TIMEZONE`과 시간대 인자를 쓴다(MVP 설계 5.10).
- `/v1/map/*` 요청 본문과 응답에는 사용자의 좌표, 주소, 장소 이름을 넣지 않는다. 노선·정류장 ref(`seoul-bus:…`, `seoul-subway:…`)만 오간다(지도 설계 4.3, 7장).
- 우선순위는 **출퇴근 세션 > 관측 요청 > 지도용 상시 관측**이다(지도 설계 4.3).

## Review Focus

1. 설치가 한도(기본 6)보다 많은 노선으로 관측을 요청하면, 일부만 받아들이지 않고 400을 준다. 테스트는 Task 6에 있다.
2. 앱이 하트비트를 멈추면 그 노선이 TTL 뒤 스케줄에서 빠진다. 다른 설치가 같은 노선을 요청 중이면 남는다. 테스트는 Task 5에 있다.
3. 지도 용도 호출이 세션 몫을 침범하지 않는다. 예산이 `daily − reserve`에 닿은 뒤에도 세션 용도 호출은 계속 된다. 테스트는 Task 4에 있다.
4. 막차가 자정을 넘는 노선(예: 첫차 04:30, 막차 01:30)은 00:30에 운행 중으로 본다. 테스트는 Task 3에 있다.
5. 경로 보기에 D1에 없는 노선(배치가 바뀌어 사라진 노선)이 들어와도 500이 나지 않는다. 그 구간은 `etaState: "estimated"`, 시각 null로 돌려준다. 테스트는 Task 4에 있다.

---

### Task 1: MVP 설계에 지도·길찾기 결정 반영 (문서)

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-mvp-design.md`

**Interfaces:** 없음(문서).

- [ ] **Step 1: 지도 설계 9장과 길찾기 설계 9장의 표대로 MVP 설계를 고친다**
  - 고칠 곳: 2장 범위 밖 두 행, 2장 목표, 3장 결정 표, 3장 "버스 범위", 4.1, 5.1, 5.7, 5.8, 6장, 7장, 8장.
  - 상단 "개정" 줄에 `2026-11-20 지도·길찾기 설계 반영`을 더한다.
  - 각 변경에는 근거 문서 링크를 단다(`2026-11-20-mvp4-map-design.md`, `2026-11-20-trip-planner-design.md`).
  - 원래 [사용자 결정]을 바꾼 곳에는 "(2026-11-20 사용자 결정으로 변경)"을 붙인다.
- [ ] **Step 2: 확인**
  Run: `grep -n "길찾기" docs/superpowers/specs/2026-11-05-mvp-design.md`
  Expected: 2장 범위 밖 표에 "앱이 경로를 찾아 주는 기능" 행이 없고, 3장 결정 표에 길찾기 행이 있다.
- [ ] **Step 3: Commit**
  ```bash
  git add docs/superpowers/specs/2026-11-05-mvp-design.md
  git commit -m "docs(spec): fold map and trip planner decisions into the MVP design"
  ```

### Task 2: 버스 배차간격·첫차·막차 정적 적재

이미 받아 두는 노선 목록 응답(`getBusRouteList`)에 `term`, `firstBusTm`, `lastBusTm`이 있다. 2026-11-10 원본 캐시에서 `term: 13`, `firstBusTm: 20261110043000`을 확인했다. 그래서 API를 더 부르지 않는다.

**Files:**
- Modify: `packages/transit-static/src/sources/seoul-bus-route-list.ts`, `packages/transit-static/src/sources/seoul-bus-route-list.test.ts`
- Modify: `packages/transit-static/src/jobs/build-bus-routes.ts`, `packages/transit-static/src/jobs/build-bus-routes.test.ts`. 노선 목록 행이 `bus_route` 행으로 가는 곳이고, `BUS_ROUTE_LOGIC_VERSION`을 4에서 5로 올린다.
- Modify: `packages/transit-static/src/db/load.ts`. `loadBusRoutes`가 새 열을 넣는다.
- Modify: `packages/db/src/schema/transit.ts`(`busRoute`)
- Create: `packages/db/src/migrations/<YYYYMMDDHHmmss>_bus_route_schedule/`(`bun run db:generate`). `packages/db/d1-migrations/`는 `bun run db:d1-migrations`로 다시 만든다.
- Test: `packages/db/src/schema/transit.test.ts`

**Interfaces:**
- Produces:
  - `BusRouteListRow`에 `headwayMin: number | null; firstBusMinute: number | null; lastBusMinute: number | null`를 더한다. 분은 그 날 0시부터의 분이다.
  - `bus_route` 표에 열 세 개(`headway_min`, `first_bus_minute`, `last_bus_minute`)를 더한다. 모두 nullable integer다.
  - drizzle 필드 이름은 `headwayMin`, `firstBusMinute`, `lastBusMinute`이다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("parses term and first/last bus time into minutes", () => {
    const [row] = parseBusRouteList([{ busRouteId: "100100118", busRouteNm: "150", busRouteAbrv: "150", routeType: "3", term: "13", firstBusTm: "20261110043000", lastBusTm: "20261110225000" }]);
    expect(row).toMatchObject({ headwayMin: 13, firstBusMinute: 270, lastBusMinute: 1370 });
  });
  it("keeps nulls for blank or zero term and malformed times", () => {
    const [row] = parseBusRouteList([{ busRouteId: "1", busRouteNm: "x", term: "0", firstBusTm: "", lastBusTm: "abc" }]);
    expect(row).toMatchObject({ headwayMin: null, firstBusMinute: null, lastBusMinute: null });
  });
  ```
  - `build-bus-routes.test.ts`에는 `bus_route` 행에 세 값이 그대로 실리는 단언을 더한다.
  - `transit.test.ts`에는 마이그레이션 뒤 세 열이 있고 null을 받는 단언을 더한다.
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen/packages/transit-static && bun test src/sources/seoul-bus-route-list.test.ts`
  Expected: FAIL. `headwayMin`이 undefined다.
- [ ] **Step 3: 구현**
  - `parseBusRouteList`에서 파싱한다. 14자리 `yyyyMMddHHmmss`의 HHmm을 분으로 바꾼다. 형식이 다르거나 `term`이 0 이하면 null이다.
  - 스키마에 열 셋을 더하고 `bun run db:generate`를 돌린다. 생성된 SQL 위에 기존 마이그레이션처럼 한 줄 주석을 단다. 그다음 `bun run db:d1-migrations`를 돌린다.
  - 빌드와 적재가 값을 넘기게 하고 `BUS_ROUTE_LOGIC_VERSION = 5`로 올린다.
- [ ] **Step 4: 통과 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen/packages/transit-static && bun test && cd ../db && bun test src/schema/transit.test.ts`
  Expected: PASS
- [ ] **Step 5: 로컬 D1 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen/apps/server && bun run d1:migrate:local`
  Expected: 새 마이그레이션이 적용된다. **원격 적용과 `publish:d1 --remote`는 사용자 확인 뒤에만 한다.**
- [ ] **Step 6: Commit**
  ```bash
  git add packages/transit-static packages/db
  git commit -m "feat(static): load bus headway and first/last bus times from the route list"
  ```

### Task 3: 도착판이 없을 때 정적 배차간격으로 추정

**Files:**
- Create: `packages/commute/src/sources/bus-schedule.ts`, `packages/commute/src/sources/bus-schedule.test.ts`
- Modify: `packages/commute/src/sources/types.ts`(`TransitBoards`), `packages/commute/src/session/estimate.ts:285-287`, `packages/commute/src/session/estimate.test.ts`
- Modify: `packages/commute/src/sources/assemble.ts`(`RawBoards`, `assembleBoards`), `packages/commute/src/sources/assemble.test.ts`
- Modify: `apps/server/src/commute/ports.ts`, `apps/server/src/commute/cf-ports.ts`, `apps/server/src/commute/runner-core.ts`(`#rawBoards`가 일정도 채움)

**Interfaces:**
- Consumes: Task 2의 `bus_route.headway_min/first_bus_minute/last_bus_minute`
- Produces:
  - `export interface BusSchedule { headwayMin: number; firstBusMinute: number | null; lastBusMinute: number | null; }`
  - `export function scheduledHeadwayMs(schedule: BusSchedule, atEpochMs: number, timezone: string): number | null`. 운행 시간 밖이면 null을 준다. 막차가 첫차보다 이르면 자정을 넘는 것으로 본다. 첫차나 막차 중 하나라도 null이면 시간 제한 없이 배차간격을 준다.
  - `TransitBoards`에 선택 필드 `scheduledHeadwayMs?: (leg: Leg, atEpochMs: number) => number | null`를 더한다.
  - `RawBoards`에 선택 필드 `busSchedules?: Record<string, BusSchedule>`를 더한다. 키는 `busRouteId`이고 접두사가 없다.
  - 실행기 포트에 `busSchedules: (busRouteIds: string[]) => Promise<Record<string, BusSchedule>>`를 더한다. D1 구현은 현재 `bus_route` 배치에서 읽는다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  // bus-schedule.test.ts. 시각은 KST 기준으로 epoch을 만든다(테스트 헬퍼에서 timezone 인자로).
  it("returns headway inside service hours", () => expect(scheduledHeadwayMs({ headwayMin: 10, firstBusMinute: 270, lastBusMinute: 1370 }, kst("2026-11-21T12:00"), "Asia/Seoul")).toBe(600_000));
  it("returns null before first bus", () => expect(scheduledHeadwayMs({ headwayMin: 10, firstBusMinute: 270, lastBusMinute: 1370 }, kst("2026-11-21T04:00"), "Asia/Seoul")).toBeNull());
  it("treats last bus past midnight as in service at 00:30", () => expect(scheduledHeadwayMs({ headwayMin: 12, firstBusMinute: 270, lastBusMinute: 90 }, kst("2026-11-21T00:30"), "Asia/Seoul")).toBe(720_000));
  // estimate.test.ts
  it("uses scheduled headway when the board is missing", () => {
    // boards.board → null, boards.scheduledHeadwayMs → 600_000
    // expect leg.boardEtaAt === readyAt + 300_000, etaState "estimated", method "headway", positionState "none"
  });
  it("keeps null ETA when no board and no schedule", () => { /* scheduledHeadwayMs → null ⇒ boardEtaAt null */ });
  ```
  - 테스트 파일 안의 `"Asia/Seoul"`은 입력 데이터라서 허용한다. 구현 코드에는 쓰지 않는다.
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen/packages/commute && bun test src/sources/bus-schedule.test.ts src/session/estimate.test.ts`
  Expected: FAIL. 모듈이 없고, 추정값이 null이다.
- [ ] **Step 3: 구현**
  - `estimate.ts:285-287`의 `boardEtaAt` 계산에서 배차간격을 `(board ? knownHeadway(board) : null) ?? boards.scheduledHeadwayMs?.(leg, readyAt) ?? null` 순서로 고른다.
  - `assembleBoards`가 `busSchedules`로 `scheduledHeadwayMs`를 만든다. 버스 구간만 해당하고 시간대는 세션 입력의 시간대를 쓴다.
  - 실행기 `#rawBoards`가 세션 구간의 버스 노선 일정을 포트로 읽어 채운다.
- [ ] **Step 4: 통과 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test packages/commute apps/server/src/commute`
  Expected: PASS. 기존 테스트도 그대로 통과한다.
- [ ] **Step 5: Commit**
  ```bash
  git add packages/commute apps/server/src/commute
  git commit -m "feat(commute): estimate from scheduled bus headway when no board is available"
  ```

### Task 4: 도착정보 일원화와 경로 보기 RPC

**Files:**
- Modify: `packages/commute/src/config.ts`. `busArrivalSessionReserve`를 더한다. env는 `COMMUTE_BUS_ARRIVAL_SESSION_RESERVE`, 기본값은 300이다.
- Modify: `packages/commute/src/plan.ts`. `export function parseRoute(input: unknown): { ok: true; route: Route } | { ok: false; issues: string[] }`를 더한다. 기존 `routeSchema`를 쓴다.
- Modify: `apps/server/src/commute/runner-core.ts`(`#attemptBus`, `#collectBus`, 새 `routeView`), `apps/server/src/commute/runner-do.ts`, `apps/server/src/commute/client.ts`
- Test: `apps/server/src/commute/runner-core.test.ts`, `packages/commute/src/plan.test.ts`

**Interfaces:**
- Consumes: Task 3의 `busSchedules` 포트, `estimateRoute`
- Produces:
  - `type BusArrivalPurpose = "session" | "map"`. `#attemptBus`에 인자로 더한다. `"map"`은 `used >= dailyBudgetBusArrival − busArrivalSessionReserve`면 부르지 않고 캐시만 쓴다.
  - 경로 보기 결과 타입:
    ```ts
    export interface RouteViewLeg {
      approaching: { etaAt: number | null; method: ArrivalMethod | null; stopsAway: number | null; vehicleId: string }[];
      boardEtaAt: number | null; etaState: "live" | "estimated"; method: ArrivalMethod | null;
      positionState: "live" | "stale" | "none"; vehicleId: string | null;
    }
    export interface RouteView { destinationEtaAt: number | null; legs: RouteViewLeg[]; }
    ```
  - `RunnerCore.routeView(route: Route, now: number): Promise<RouteView>`
    - 버스는 `#collectBus(…, purpose "map")`로, 지하철은 `stations`와 `watch`로 도착판을 만든다.
    - `readyAt = now + walkMinutes[0]분`으로 `estimateRoute`를 한 번 돌린다.
    - `approaching`은 각 구간 승차 정류장 도착판의 `approaching`을 그대로 옮긴다.
  - DO RPC `routeView(route: Route): Promise<RouteView>`를 열고, `CommuteRunnerClient.routeView`에도 더한다.

- [ ] **Step 1: 실패하는 테스트(`runner-core.test.ts`, 기존 픽스처 업스트림 사용)**
  ```ts
  it("map purpose stops calling upstream at daily − reserve but session purpose continues", …);
  it("routeView shares the per-route arrival cache: two calls within busPollMs fetch once", …);
  it("routeView returns approaching vehicles with etas for the boarding stop", …);
  it("routeView on a route id missing from D1 returns estimated legs with null times, not a throw", …);
  ```
  - 마지막 테스트가 Review Focus 5다.
  - `plan.test.ts`에는 `parseRoute`의 성공 1건과 실패 1건(`walkMinutes` 길이가 틀림)을 더한다.
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test apps/server/src/commute/runner-core.test.ts packages/commute/src/plan.test.ts`
  Expected: FAIL. `routeView`와 `parseRoute`가 없다.
- [ ] **Step 3: 구현.** 세션 경로의 기존 호출은 모두 `"session"` 용도로 둔다.
- [ ] **Step 4: 통과 확인**
  Run: 같은 명령
  Expected: PASS
- [ ] **Step 5: Commit**
  ```bash
  git add packages/commute apps/server/src/commute
  git commit -m "feat(commute): route view RPC with a session reserve on bus arrival calls"
  ```

### Task 5: 수집기 버스 관측 요청(설치별, 만료 시각)

**Files:**
- Modify: `apps/server/src/collector/core-state.ts`(`STATE_KEYS`에 `busWatch`), `apps/server/src/collector/collector-state.ts`
- Modify: `packages/realtime/src/schedule.ts`(`planTick`, `sourcesFor`, `interval`, `planKind`), `packages/realtime/src/schedule.test.ts`
- Modify: `apps/server/src/collector/core.ts`(`#poll`, `#retryLater`, `refreshReferences`, `#tick`이 만료 처리), `apps/server/src/collector/core.test.ts`
- Modify: `apps/server/src/collector/durable-object.ts`, `apps/server/src/collector/client.ts`(`CollectorClient`, `CollectorRpcClient`, `collectorClient`)
- Modify: `apps/server/src/collector/cf-ports.ts`(`collectorConfig`). 설정값 `MAP_WATCH_MAX_PER_INSTALL`(기본 6)과 `MAP_WATCH_MAX_TOTAL`(기본 40)을 읽는다.

**Interfaces:**
- Produces:
  - `CollectorState.watchBusRoutes(installId: string, routeIds: readonly string[], until: number): void`. 그 설치의 집합을 통째로 바꾼다. 빈 배열이면 지운다.
  - `CollectorState.expireBusWatches(now: number): void`
  - `CollectorState.watchedBusRouteIds(now: number, maxTotal: number): string[]`. 여러 설치의 요청을 합쳐 중복을 없앤다. 합이 `maxTotal`을 넘으면 `until`이 늦은 설치부터 채운다.
  - `planTick(now: number, schedule: ScheduleState, budget: BudgetState, config: CollectorConfig, extraBusRouteIds: readonly string[] = []): TickPlan`. 버스 소스는 요청 노선을 먼저 두고 그 뒤에 `config.busRouteIds`를 둔다(중복 제거). `interval`의 소스 수도 합친 수로 센다.
  - DO RPC `watchBusRoutes(installId: string, routeIds: string[], until: number): Promise<void>`
    - `routeIds`는 숫자 문자열만 받는다.
    - 길이가 `MAP_WATCH_MAX_PER_INSTALL`를 넘으면 예외를 던진다.
  - 요청 노선이 바뀌면 `refreshReferences`가 그 노선의 참조(`loadBus`)를 불러온다. 그래야 `shapeDistanceM`이 null이 되지 않는다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  // schedule.test.ts
  it("puts extra bus routes before configured routes and counts them in the interval", …);
  it("in dev, the one due bus per tick prefers an extra route over a test route when both are due", …);
  // core.test.ts (또는 collector-state 테스트)
  it("replaces an install's watch set and drops it after until", …);
  it("keeps a route watched by another install when one install expires", …);   // Review Focus 2
  it("caps the union at maxTotal, preferring later until", …);
  it("loads bus references for newly watched routes", …);
  ```
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test packages/realtime/src/schedule.test.ts apps/server/src/collector/core.test.ts`
  Expected: FAIL
- [ ] **Step 3: 구현.** 저장은 기존 `watchStations`/`expireWatches` 패턴을 따른다(`collector-state.ts:173-190`).
- [ ] **Step 4: 통과 확인**
  Run: 같은 명령과 `bun test apps/server/src/collector packages/realtime`
  Expected: PASS
- [ ] **Step 5: Commit**
  ```bash
  git add packages/realtime apps/server/src/collector
  git commit -m "feat(collector): per-install bus route watches with expiry"
  ```

### Task 6: Worker `/v1/map` API(관측 요청, 경로 보기)

**Files:**
- Create: `apps/server/src/map/routes.ts`, `apps/server/src/map/routes.test.ts`
- Modify: `apps/server/src/app.ts`. `createMapRoutes`를 `/`에 붙인다. 설정값 `MAP_WATCH_TTL_MS`(기본 90000)를 읽는다.

**Interfaces:**
- Consumes:
  - `authenticateInstall(db, headers, now)`(`apps/server/src/commute/auth.ts:51`)
  - Task 5의 `CollectorClient.watchBusRoutes`
  - Task 4의 `CommuteRunnerClient.routeView`, `parseRoute`
- Produces: `export function createMapRoutes(deps: MapRoutesDeps): Hono`. `MapRoutesDeps`는 `{ collector?: CollectorClient; commute?: CommuteRunnerClient; db: Database; now?: () => number; watchTtlMs: number; maxRoutesPerInstall: number }`다.
  - `POST /v1/map/watch`
    - 본문은 `{ busRoutes: string[] }`다. 원소는 `seoul-bus:<id>` ref이고, 다른 출처는 무시한다.
    - 설치 인증이 없으면 401을 준다.
    - 버스 노선이 `maxRoutesPerInstall`을 넘으면 400(`{ error: "too-many-routes" }`)을 준다.
    - 정상이면 `watchBusRoutes(installId, ids, now + watchTtlMs)`를 부르고 204를 준다.
    - 앱은 보이는 동안 60초마다 다시 보낸다(4-B).
  - `POST /v1/map/route-view`
    - 본문은 `{ route: Route }`이고 `parseRoute`로 검증한다. 실패하면 400이다.
    - 설치 인증이 없으면 401을 준다.
    - 정상이면 `RouteView`를 JSON으로 주고 `Cache-Control: no-store`를 붙인다.
    - 수집기나 실행기가 없으면 503을 준다.
  - 두 엔드포인트 모두 좌표, 주소, 장소 이름을 받지 않는다. 요청 본문을 로그에 남기지 않는다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("401 without install auth", …);
  it("400 too-many-routes for 7 bus routes and does not call the collector", …);   // Review Focus 1
  it("ignores non-bus refs and forwards ids without prefix with until = now + ttl", …);
  it("route-view 400 on invalid route, 200 with RouteView on valid", …);
  ```
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test apps/server/src/map/routes.test.ts`
  Expected: FAIL. 모듈이 없다.
- [ ] **Step 3: 구현.** 인증 패턴은 `apps/server/src/commute/routes.ts`의 인라인 `authenticateInstall` 호출을 따른다.
- [ ] **Step 4: 통과 확인**
  Run: 같은 명령
  Expected: PASS
- [ ] **Step 5: Commit**
  ```bash
  git add apps/server/src/map apps/server/src/app.ts
  git commit -m "feat(server): map watch and route view endpoints"
  ```

### Task 7: 지도용 참조 데이터 API

**Files:**
- Create: `apps/server/src/ref/map.ts`, `apps/server/src/ref/map.test.ts`
- Modify: `apps/server/src/ref/routes.ts`(새 경로 등록)

**Interfaces:**
- Produces. 모두 공개이고 `Cache-Control: public, max-age=86400`, 배치 ETag를 붙인다. 좌표는 `[lng, lat]` 배열이다.
  - `GET /v1/ref/map/bus/:busRouteId`
    - 응답: `{ batchId: number; line: string; shape: [number, number][]; stops: { arsId: string | null; lat: number; lng: number; name: string; seq: number; stop: string }[] }`
    - ETag는 `"busmap-<batchId>"`다. 출처는 `bus_route_shape.coords`와 `bus_route_stop`이다. 없는 노선이면 404다.
  - `GET /v1/ref/map/subway/:lineKey`
    - 응답: `{ batchId: number; line: string; branches: { branchKey: string; direction: string; shape: [number, number][]; stations: { lat: number; lng: number; name: string; nextRunSec: number | null; offsetM: number; seq: number; stop: string }[] }[] }`
    - 출처는 `track_shape.coords`, `track_station`(`offsetM`), `station_crosswalk`다.
    - `nextRunSec`는 그 방향 다음 역까지 걸리는 평일 시간표 소요시간의 중앙값이다(`timetable_stop_time`). 앱이 역 사이를 보간할 때 쓴다(지도 설계 4.4). 계산이 무거우면 배치별로 응답을 캐시한다.
  - `GET /v1/ref/map/subway-stations`
    - 응답: `{ batchId: number; stations: { lat: number; line: string; lng: number; name: string; stop: string }[] }`
    - 전 노선 역 좌표다. 앱이 기기에서 근처 노선을 고를 때 쓴다(지도 설계 2.5).
  - ID 형식은 `apps/server/src/ref/ids.ts`(`busLine`, `busStop`, `subwayLine`, `subwayStation`)를 쓴다.

- [ ] **Step 1: 실패하는 테스트.** 로컬 테스트 DB에 노선 하나와 지하철 노선 하나를 넣어 둔다. `createTestDb()`(`packages/db/src/test-db.ts`)를 쓴다.
  ```ts
  it("bus map returns shape and stops with coordinates in seq order and a batch etag", …);
  it("bus map 404 for unknown route", …);
  it("subway map returns branches with shape and ordered stations", …);
  it("subway map gives nextRunSec as the median weekday run time to the next station, null at the terminal", …);
  it("subway-stations lists every station with line and coordinates", …);
  it("304 when If-None-Match matches", …);
  ```
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test apps/server/src/ref/map.test.ts`
  Expected: FAIL
- [ ] **Step 3: 구현.** 기존 `ref/bus.ts`, `ref/subway.ts`의 현재 배치 조회 패턴을 따른다.
- [ ] **Step 4: 통과 확인**
  Run: 같은 명령과 `bun test apps/server/src/ref`
  Expected: PASS
- [ ] **Step 5: Commit**
  ```bash
  git add apps/server/src/ref
  git commit -m "feat(ref): map shapes, stops and station coordinates"
  ```

### Task 8: 활성 세션에 구간별 차량 ID 노출

**Files:**
- Modify: `apps/server/src/commute/runner-core.ts:198-233`(`SessionRouteView`와 그 생성 함수), `apps/server/src/commute/runner-core.test.ts`

**Interfaces:**
- Produces: `SessionRouteView`에 `legVehicleIds: (string | null)[]`를 더한다. 값은 그 경로 추정의 구간별 `vehicleId`다. 탑승한 구간은 `state.fixed`의 값이다. 앱 쪽 스키마는 4-B Task 2에서 바꾼다.

- [ ] **Step 1: 실패하는 테스트**
  ```ts
  it("active session exposes legVehicleIds per route, using fixed for boarded legs", …);
  ```
- [ ] **Step 2: 실패 확인**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test apps/server/src/commute/runner-core.test.ts`
  Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
  Run: `bun test apps/server`
  Expected: PASS
- [ ] **Step 5: Commit**
  ```bash
  git add apps/server/src/commute
  git commit -m "feat(commute): expose per-leg vehicle ids on the active session"
  ```

### Task 9: 전체 검증

- [ ] **Step 1: 전체 검증 명령 실행**
  Run: `cd /Users/choehyeonjun/Project/Betro/.claude/worktrees/mvp2-lock-screen && bun test && bun run check-types && bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`
  Expected: 전부 통과한다.
- [ ] **Step 2: 로컬 Worker에서 확인**
  Run: `cd apps/server && bunx wrangler dev`. `.dev.vars`는 `UPSTREAM_MODE=fixture`다.
  할 일: `curl`로 `/v1/ref/map/bus/100100290`과 `/v1/ref/map/subway-stations`를 부른다.
  Expected: 200이고 좌표가 있다.
- [ ] **Step 3: 사용자 확인 뒤에 할 일을 정리해 보고한다.** 원격 적용(원격 D1 마이그레이션, `publish:d1 --remote`, `wrangler deploy`)은 여기서 실행하지 않는다.
