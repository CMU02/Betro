# MVP 출시 준비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MVP 설계 8장 6단계 "출시 준비" 중 코드와 설정으로 할 수 있는 일을 끝냅니다. 7.2·7.3 기준을 받칠 코드, 출시 전에 고칠 남은 일, 그리고 사용자 확인이 필요한 기기 확인과 배포 목록입니다.

**Architecture:** 세 Part입니다.
- **Part A(7.2·7.3).** 시간표 추정 모드(14)의 화면 표시와 시간표 위치 열차, 데이터 출처(13), 개인정보 처리방침과 오픈소스 고지, 릴리스 빌드 설정입니다.
- **Part B(남은 일).** 조사에서 확인한 남은 일을 하나씩 테스트와 함께 고칩니다.
- **Part C.** 기기 확인과 배포 단계를 한곳에 모읍니다. 이 Task는 사용자 확인 뒤에만 진행합니다.

실사용 검증(7.1, 2주 크래시 관찰, 지표 읽기), 스토어 등록 자료(스크린숏, 설명), 길찾기는 이 계획에 없습니다.

**Tech Stack:** TypeScript, Bun test, Hono on Cloudflare Workers + Durable Objects, D1, Expo(React Native, Hermes), EAS Build, Kotlin(Android 알림 모듈), Sentry.

**Spec:**
- `docs/superpowers/specs/2026-11-05-mvp-design.md` 4.1(13·14), 5.2, 5.8, 5.9, 7.2, 7.3, 8장 6단계, 11.1
- `docs/superpowers/specs/2026-11-20-mvp4-map-design.md` 4.4, 5장(14)
- `docs/research/2026-10-30-data-sources.md`(출처 표시와 라이선스)
- 앞 계획: `docs/superpowers/plans/2026-11-24-mvp-search-detail.md`. **그 계획이 끝난 뒤에 합니다.** 시간표 추정 표시가 새 화면에도 걸리고, 두 계획 모두 `messages-ko.ts`와 설정 화면을 고칩니다.

## 조사에서 확인한 것 (2026-11-24, HEAD 7c2b33c)

1. **14 시간표 추정 모드는 일부만 있습니다.** 조사 문서는 "만들어짐"이라고 했지만 코드는 다릅니다.
   - 있는 것: 버스 구간 예상이 추정이면 지도에 "{노선} · 시간표 추정 · 약 N분 뒤" 알약을 띄웁니다(`map-labels.ts:74` `estimatedBoardNotice`). 차량 시트도 method로 "시간표 추정"을 붙입니다.
   - 없는 것:
     - 서울 지하철·버스 수집이 한도로 멈춰도 스냅샷에 그 사실이 없습니다. `stoppedSources`는 `gbis | tago`만 담습니다(`collector/core.ts:142`).
     - 하루 예산을 다 쓴 것도 멈춤으로 남지 않습니다. 예산이 0이면 `planKind`가 부르지 않고(`schedule.ts:371-374`) `#attempt`도 그냥 돌아갑니다(`core.ts:525-528`). `state.stop`은 상류가 401·한도 초과를 돌려줄 때만 불립니다(`core.ts:572`). 그래서 `isStopped`만 보면 예산 소진은 `stoppedSources`에도 나오지 않고, 차량이 TTL로 빠져도 `staleSince`는 null로 남습니다.
     - 앱은 `staleSince`를 읽기만 하고 쓰지 않습니다.
     - 열차를 시간표 위치로 그리는 코드도 없습니다(스펙 5.8).
2. **iOS 위치 권한에 영어 기본 문구가 들어갑니다.** 생성된 `Info.plist`에 `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`이 "Allow $(PRODUCT_NAME) to access your location"으로 들어 있습니다. 앱은 사용 중 위치만 씁니다.
3. **Android 매니페스트에 쓰지 않는 권한이 있습니다.** `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`입니다.
4. **iOS 개인정보 매니페스트.** 생성된 `PrivacyInfo.xcprivacy`에는 API 사용 이유(UserDefaults, FileTimestamp, SystemBootTime)만 있고 `NSPrivacyCollectedDataTypes`가 비어 있습니다. 앱은 크래시 보고(Sentry, 설치 ID를 사용자로 씀)와 하루 지도 지표를 보냅니다.
5. **`eas.json`이 없습니다.** 빌드 번호(`ios.buildNumber`, `android.versionCode`)도 없습니다.
6. **데이터 출처 13에 GBIS(경기도), TAGO(국토교통부), 네이버 지도가 없습니다.** 지금은 서울특별시, 공공데이터포털, 국가철도공단, OpenStreetMap 네 곳입니다(`lib/legal/data-sources.ts`).
7. **개인정보 처리방침, 오픈소스 고지가 앱과 서버 어디에도 없습니다.**
8. **7.2 ③ 지표는 자동으로 모입니다.** `appMotionMetrics`가 하루 한 번 Sentry `map-motion-daily`로 숫자만 보냅니다. 코드 작업은 없고, 읽는 일은 Part C입니다.
9. **02 권한 문구는 4.4대로입니다.** "출퇴근 시간에 잠금화면에 도착 정보를 띄워요"(`permissions.purpose.*.notifications`). 고칠 것이 없습니다.

## 설계 결정

1. **한도로 멈춘 서울 출처를 스냅샷에 싣습니다. [설계 판단]**
   - 지하철·버스 스냅샷에 `stoppedToday: boolean`을 더합니다. 그날 그 종류(`subway`, 서울 `bus`)가 한도 초과나 인증 실패로 멈췄거나(`isStopped`), **그날 예산을 다 썼으면**(`remaining(budget, kind, config, now) <= 0`) true입니다.
   - 같은 규칙으로 `stoppedSources`도 예산을 다 쓴 지역 출처를 담습니다. 5-B 설계 결정 10("멈춘 출처는 실시간 정보 없음")이 예산 소진에도 걸리게 하려는 것입니다.
   - 앱은 지하철이 멈췄거나 `staleSince`가 3분(`ESTIMATED_MODE_AFTER_MS = 180_000`)보다 오래되면 "시간표 추정 모드"를 띄웁니다. 3분은 `dev` ALL 간격(80초)의 두 배보다 깁니다.
   - 버스는 스냅샷 전체의 `staleSince`를 쓰지 않습니다. 그 값은 모든 노선의 `staleRoutes` 중 가장 이른 값이고, 운행이 끝난 노선이나 지역 `no-data`도 들어갑니다(`state.ts:236-245`, `apply-call.ts:68-80`). 그래서 버스는 `stoppedToday`이거나, **지도가 보는 서울 버스 노선**의 `staleRoutes[routeId]`가 3분보다 오래됐을 때만 추정 모드입니다. [설계 판단]
2. **시간표 위치 열차. [설계 판단]** 스펙 5.8 "열차는 시간표 위치로 그린다"를 따릅니다.
   - Worker가 D1 시간표로 지금 달리는 열차의 앞 역, 다음 역, 진행률을 냅니다.
   - 앱은 시간표 추정 모드일 때만 그 열차를 70% 불투명도로 그립니다(Motion Spec).
   - 버스는 그리지 않습니다(스펙 5.8).
3. **개인정보 처리방침은 Worker가 한 곳에서 냅니다. [설계 판단]**
   - `GET /privacy`(API 호스트)가 HTML을 냅니다. 앱 설정 행은 그 주소를 엽니다. 글이 두 곳에 있으면 서로 어긋나기 때문입니다.
   - 내용은 스펙 5.2 그대로입니다. 연락처는 환경 변수 `PRIVACY_CONTACT`입니다.
4. **빌드 번호는 EAS가 셉니다. [설계 판단]** `appVersionSource: "remote"`이고 production 프로필에 `autoIncrement: true`입니다. `expo-updates`(OTA)는 쓰지 않습니다.
5. **`aps-environment`는 바꾸지 않습니다. [설계 판단]** 배포 서명 때 프로비저닝 프로필의 값(production)으로 바뀌는지를 Part C에서 아카이브로 확인합니다. 서버는 토큰의 환경을 앱이 보낸 값으로 정합니다(`CommuteTokenReporter.swift:197-203`).
6. **iPad는 받지 않습니다. [설계 판단, 열린 질문]** `supportsTablet: false`입니다. iPad 화면과 스크린숏 심사를 피합니다.
7. **production 빌드는 Sentry DSN이 있어야 합니다. [설계 판단]** 7.2 ①(크래시 0회 확인)은 수집 도구가 켜져 있어야 셀 수 있습니다. `EAS_BUILD_PROFILE=production`인데 `EXPO_PUBLIC_SENTRY_DSN`이 없으면 설정 단계에서 멈춥니다. 같은 이유로 production 빌드는 `SENTRY_AUTH_TOKEN`·`SENTRY_ORG`·`SENTRY_PROJECT`가 없으면 빌드 단계에서 멈춥니다(소스맵이 없으면 크래시 줄을 읽을 수 없습니다). 이 값들을 EAS에 넣기 전에는 production 빌드가 되지 않습니다.

## Global Constraints

- 커밋 메시지와 PR 본문에 AI 서명·출처 표기(`Claude-Session:`, `Co-Authored-By: Claude`, 세션 URL)를 넣지 않습니다.
- 브랜치: `feat/mvp-search-detail`에 이어서 커밋합니다(찾기와 상세 계획 다음).
- `.env`, `google-services.json`, `GoogleService-Info.plist`, API 키, 푸시 토큰, wrangler 토큰을 읽거나 화면·로그·문서·테스트에 남기지 않습니다. `expo config` 출력은 필요한 키만 `rg`로 골라 봅니다.
- 원격 배포(`wrangler deploy`, 원격 D1, `eas build/submit`)는 Part C에서 사용자 확인 뒤에만 합니다.
- 린트 게이트: `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`.
- 앱에는 ES2023 배열 메서드를 쓰지 않습니다(`lib/hermes-compat.test.ts`).
- 화면 글자는 `messages-ko.ts` 키로 씁니다. 새 코드에 `Asia/Seoul`, `+09:00` 리터럴을 쓰지 않습니다(스펙 5.10).
- 광고 SDK, 결제, 로그인 유도를 넣지 않습니다(스펙 11.1, 2장).
- 서버에 주소·좌표·장소 이름을 보내지 않습니다(스펙 5.2). 개인정보 처리방침도 이 사실과 다르게 쓰지 않습니다.
- 서울 동작을 바꾸지 않습니다. 기존 테스트의 단언은 이 계획이 일부러 바꾸는 인터페이스에서만 고칩니다. 교차 검토 때 확인한 곳은 다음 셋입니다. 그 밖의 단언을 고쳐야 하면 그 Task 본문에 단언과 이유를 적은 뒤 고칩니다. Task 1의 `stoppedToday`는 스냅샷 전체를 `toEqual`로 비교하는 기존 테스트가 없어 단언을 바꾸지 않습니다.
  - Task 3: `data-sources.test.ts`의 제공 기관 4곳 단언
  - Task 7: `notification-content.test.ts`의 인자 하나 `toEqual` 단언
  - Task 9: `schedule.test.ts`의 `dev defaults` `toEqual` 단언
- 주석과 테스트 이름은 한국어로 씁니다.

## Review Focus

1. **잠깐 끊긴 것과 멈춘 것:** 지하철 응답이 1분 비었다고 "시간표 추정 모드"가 깜빡이면 안 됩니다. 3분을 넘거나 그날 멈췄을 때만 떠야 합니다. 실시간이 돌아오면 다음 스냅샷에서 사라져야 합니다. 테스트는 Task 1에 있습니다.
2. **자정을 넘는 시간표:** 00:30에 달리는 막차(서비스일 초 > 86,400)도 시간표 위치 열차에 나와야 합니다. 03:00 경계 뒤에는 새 서비스일로 넘어가야 합니다. 테스트는 Task 2에 있습니다.
3. **카운트다운이 끝난 뒤:** 다음 푸시가 오기 전에도 "-0:05"가 아니라 "곧"이 보여야 합니다. 1분 안 남은 시각으로는 타이머를 걸지 않아야 합니다. 테스트는 Task 7에 있습니다.
4. **릴리스 설정이 개발 빌드를 막지 않음:** `EAS_BUILD_PROFILE`이 없는 로컬 개발에서는 DSN 없이도 설정이 읽혀야 합니다. 위치 Always 문구가 빠져도 사용 중 위치 요청은 그대로여야 합니다. 테스트는 Task 5에 있습니다.
5. **푸시 토큰 정리:** 진행 중인 세션의 Live Activity 토큰과 지금 쓰는 시작 토큰은 지우면 안 됩니다. 테스트는 Task 11에 있습니다.

---

## Part A: 7.2·7.3 코드와 설정

### Task 1: 시간표 추정 모드 표시 (14)

Model: opus

**Files:**
- Modify: `packages/realtime/src/state.ts`. `Snapshot`에 `stoppedToday: boolean`을 더합니다.
- Modify: `apps/server/src/collector/core.ts:140-156`, `apps/server/src/collector/collector-state.ts`. 스냅샷 캐시 키에 `stoppedToday`를 넣습니다. `stoppedSources(now)`와 새 `stoppedToday(kind, now)`는 `isStopped(kind, now) || remaining(this.budget, kind, config, now) <= 0`으로 셉니다(`remaining`은 `packages/realtime/src/budget.ts:72`, 운행 시간과 상관없이 하루 예산에서 쓴 수를 뺀 값).
- Modify: `apps/native/lib/map/map-client.ts`. 두 스냅샷 스키마에 `stoppedToday: z.boolean().default(false)`
- Create: `apps/native/lib/map/estimated-mode.ts`
- Modify: `apps/native/lib/map/use-map-data.ts`. `MapData`에 `estimatedMode: EstimatedMode`를 더합니다. 이미 있는 `RENDER_TICK_MS` 시계(`:544`)로 다시 셉니다.
- Modify: `apps/native/lib/map/use-nearby-trains.ts`. 반환값에 `estimatedMode: boolean`을 더합니다. 지금은 시계가 없어 304가 이어지면 다시 셀 수 없으므로, 보이는 동안 `SNAPSHOT_INTERVAL_MS`마다 `now`를 갱신합니다.
- Modify: `apps/native/app/(tabs)/index.tsx`. `RouteStatus`에 알약을 더합니다. 장소가 없을 때의 "근처 지하철" 알약 옆에도 둡니다.
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `map.estimatedMode`
- Test: `packages/realtime/src/state.test.ts`, `apps/server/src/collector/core.test.ts`, `apps/native/lib/map/estimated-mode.test.ts`

**Interfaces:**
- Produces:

```ts
export const ESTIMATED_MODE_AFTER_MS = 180_000;
export interface EstimatedMode { bus: boolean; subway: boolean }
/** `busRouteIds`는 지도가 보는 서울 버스 노선의 맨 ID(`vehicleRouteKey`)다. */
export function estimatedModeOf(input: { bus: BusSnapshot | null; busRouteIds: readonly string[]; now: number; subway: SubwaySnapshot | null }): EstimatedMode;
```

- `subway`는 지하철 스냅샷이 `stoppedToday`이거나, `staleSince !== null && now − staleSince > ESTIMATED_MODE_AFTER_MS`일 때 true입니다.
- `bus`는 버스 스냅샷이 `stoppedToday`이거나, `busRouteIds` 중 하나의 `staleRoutes[id]`가 `ESTIMATED_MODE_AFTER_MS`보다 오래됐을 때 true입니다. 스냅샷 전체 `staleSince`는 보지 않습니다(설계 결정 1).
- 문구 `map.estimatedMode`: "시간표 추정 모드". Figma `13:4866`에 다른 글자가 있으면 그것을 씁니다. 알약 tone은 `estimated`입니다.
- 버스만 추정 모드면 지하철 차량은 그대로 그립니다. 버스 마커는 원래 위치가 없어 그려지지 않습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
// core.test.ts
it("서울 지하철이 한도로 멈추면 지하철 스냅샷의 stoppedToday가 true이고 ETag가 바뀐다", async () => {});
it("다음 날(KST)에는 stoppedToday가 false로 돌아온다", async () => {});
it("지하철 하루 예산을 다 쓰면 상류 오류가 없어도 stoppedToday가 true다", async () => {});
it("GBIS 위치 예산을 다 쓰면 버스 스냅샷 stoppedSources에 gbis가 있다", async () => {});
// estimated-mode.test.ts
it("보지 않는 노선(운행 종료)이 오래 비어 있어도 버스 추정 모드가 아니다", () => {
	const bus = busSnap({ staleRoutes: { "100100290": NOW - 600_000 }, staleSince: NOW - 600_000 });
	expect(estimatedModeOf({ bus, busRouteIds: ["100100118"], now: NOW, subway: null }).bus).toBe(false);
	expect(estimatedModeOf({ bus, busRouteIds: ["100100290"], now: NOW, subway: null }).bus).toBe(true);
});
it("staleSince가 1분 전이면 추정 모드가 아니고 4분 전이면 추정 모드다", () => {
	expect(estimatedModeOf({ bus: null, now: NOW, subway: snap({ staleSince: NOW - 60_000 }) }).subway).toBe(false);
	expect(estimatedModeOf({ bus: null, now: NOW, subway: snap({ staleSince: NOW - 240_000 }) }).subway).toBe(true);
});
it("stoppedToday가 없는 옛 스냅샷은 false로 읽는다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다**

Run: `cd packages/realtime && bun test src/state.test.ts && cd ../../apps/server && bun test src/collector && cd ../native && bun test lib/map`
Expected: FAIL.

- [ ] **Step 3: 구현합니다.** 멈춤 판정은 `isStopped(kind, now)`와 예산 소진(`remaining(...) <= 0`)을 함께 봅니다. 예산 소진은 스냅샷 캐시 키(`stopped` 문자열)가 바뀌므로 ETag도 바뀝니다.
- [ ] **Step 4: 통과를 확인합니다** 같은 명령. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add packages/realtime/src apps/server/src/collector apps/native/lib/map apps/native/app apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(map): show the timetable estimate mode when Seoul sources stop or go stale"
```

### Task 2: 시간표 위치 열차 (14)

Model: opus

**Files:**
- Create: `apps/server/src/map/scheduled-trains.ts`
- Modify: `apps/server/src/map/routes.ts`. `GET /v1/map/scheduled/:lineKey`
- Create: `apps/native/lib/map/scheduled-trains.ts`
- Modify: `apps/native/lib/map/use-map-data.ts`. 추정 모드일 때만 그 노선의 시간표 열차를 15초마다 받습니다.
- Modify: `apps/native/app/(tabs)/index.tsx`. `routeMarkers`가 `estimated`를 `MarkerVehicle`로 넘깁니다.
- Modify: `apps/native/components/map/vehicle-markers.tsx`. `MarkerVehicle`에 `estimated?: true`를 더하고, `estimated` 차량은 불투명도 0.7입니다. 마커 `key`에 `estimated`를 넣어 실시간 열차와 섞이지 않게 합니다.
- Modify: `apps/native/lib/map/sheet-model.ts`. `scheduled:<tripId>` 차량은 `trainNo`가 null이고 `estimated: true`입니다. 도착판의 `timetable:<tripId>`와 같은 trip이면 그 행의 시각을 씁니다.
- Modify: `apps/native/lib/map/map-labels.ts`. `freshnessLabel`이 시간표 열차에는 "시간표 추정"(`map.sheet.estimated`)을 냅니다. "실시간 · 0초 전 위치"가 나오면 안 됩니다.
- Modify: `apps/native/components/map/vehicle-sheet.tsx`. 위 값을 그립니다.
- Test: `apps/server/src/map/scheduled-trains.test.ts`, `apps/native/lib/map/scheduled-trains.test.ts`, `apps/native/lib/map/sheet-model.test.ts`, `apps/native/lib/map/map-labels.test.ts`

**Interfaces:**
- Produces:

```ts
// 서버
export interface ScheduledTrain { direction: "up" | "down"; fromStop: string; progress: number; toStop: string; trainNo: string; tripId: number }
/** `db`는 다른 ref 질의(`ref/map.ts`)처럼 drizzle `Database`다. `MapRoutesDeps.db`를 그대로 쓴다. */
export async function scheduledTrains(db: Database, lineKey: string, now: number): Promise<{ generatedAt: number; trains: ScheduledTrain[] } | null>;
// 앱
export function fetchScheduledTrains(client: ServerClient, line: string): Promise<RefResult<{ generatedAt: number; trains: ScheduledTrain[] }>>;
/**
 * 구간에서 보일 시간표 열차. `subwayVehiclesForLeg`와 같은 규칙(구간 방향, 승차역 앞, 순환선 반 바퀴)으로 거르고,
 * 가지는 `subwayBranchForLeg`로 고른다. 위치는 `createSubwayTrack(branch)`의 역 `distanceM` 두 개를 `progress`로 보간한 거리를
 * `pointAlong(shape, distanceM)`에 넣어 낸다. 차량 ID는 `scheduled:<tripId>`, `estimated: true`.
 */
export function scheduledVehicles(trains: readonly ScheduledTrain[], leg: SubwayLeg, map: SubwayMap, legIndex: number): RenderVehicle[];
```

- `RenderVehicle`(`use-map-data.ts:72-90`)의 필드를 모두 채웁니다. `legIndex`는 그 구간 번호, `motion`은 움직임 없이 그 지점에 멈춘 상태, `observedPosition`·`latitude`·`longitude`는 보간한 지점, `observedAt`·`lastSeenAt`은 응답의 `generatedAt`, `positionSeq`는 앞 역 순번, `statnId`는 앞 역입니다.

- 서버: `now`가 속한 서비스일(3시 경계)과 요일 구분으로, `depart(앞 역) ≤ nowSec < arrive(다음 역)`인 trip을 고릅니다.
  - 시각은 `ref/map.ts` `loadRunTimes`처럼 `COALESCE(depart_sec, arrive_sec)`(앞 역), `COALESCE(arrive_sec, depart_sec)`(다음 역)이고, `arrive > depart`인 쌍만 씁니다. 두 열 모두 null일 수 있습니다(`transit.ts:178-179`).
  - `progress = (nowSec − depart) / (arrive − depart)`입니다.
  - 서비스일은 찾기와 상세 계획 Task 3이 export한 `serviceDayOf`(`D1Timetable`과 같은 함수, 새벽 3시 경계)로 셉니다. 이 함수는 `serviceDayAt`처럼 서울 시간대 고정이므로 `timezone` 인자를 받지 않습니다. 기존 시간표 코드와 같은 한계이고, 새 리터럴은 쓰지 않습니다.
  - 응답은 공개 GET이고 `Cache-Control: public, max-age=15`입니다.
- 앱: `RenderVehicle`에 `estimated?: true`를 더합니다. 시간표 열차는 실시간 열차와 같은 마커이고, 차량 시트는 "시간표 추정"으로 엽니다.
- 실시간 스냅샷 열차가 있으면 시간표 열차는 그리지 않습니다. 두 가지를 섞지 않습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("앞 역 출발과 다음 역 도착 사이의 열차만 progress와 함께 낸다", async () => {
	// 시드: 출발 30_000초, 다음 역 도착 30_120초 → now가 30_060초면 progress 0.5
});
it("서비스일 초가 86_400을 넘는 막차도 00:30에 나온다", async () => {});
it("03:00 뒤에는 새 서비스일의 첫차만 본다", async () => {});
it("앞 역이나 다음 역 시각이 null이면 COALESCE로 채우고, 같은 시각 쌍은 버린다", async () => {});
it("scheduledVehicles는 두 역의 선로 거리 사이에 놓이고 estimated다", () => {});
it("scheduledVehicles는 반대 방향과 승차역을 지난 열차를 그리지 않는다", () => {});
it("시간표 열차 시트는 열차 번호 없이 '시간표 추정'이다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/map && cd ../native && bun test lib/map`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** 위치에 `SubwayMap` 역의 `offsetM`을 쓰지 않습니다. 그 값은 역 좌표에서 선로까지의 수직 거리입니다(`motion.ts:458` 주석). 거리는 `createSubwayTrack`이 투영한 `distanceM`입니다. 서버(Step 3a)와 앱(Step 3b)을 나눠 커밋해도 됩니다.
- [ ] **Step 4: 통과를 확인합니다** 같은 명령. `motion-metrics` 테스트도 통과해야 합니다. 시간표 열차는 지표에 넣지 않습니다(실시간 갱신이 아닙니다).
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src/map apps/native/lib/map apps/native/components/map "apps/native/app/(tabs)/index.tsx"
git commit -m "feat(map): draw subway trains at timetable positions in the estimate mode"
```

### Task 3: 데이터 출처 13에 모든 출처 싣기

Model: sonnet

**Files:**
- Modify: `apps/native/lib/legal/data-sources.ts`
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `dataSources.providers.*`
- Test: `apps/native/lib/legal/data-sources.test.ts`

**Interfaces:**
- Produces: `DataProvider`에 `sources: readonly ("seoul-subway" | "seoul-bus" | "gbis" | "tago" | "kric" | "osm" | "naver-map")[]`를 더합니다. `export const USED_SOURCES`(같은 값의 전체 목록)를 둡니다.

- 더할 제공 기관:
  - `gyeonggi`: 제목 "경기도", 부제 "경기도 버스정보 · 경기 버스 노선·정류소·도착·위치", URL `https://www.data.go.kr`
  - `molit`: 제목 "국토교통부", 부제 "TAGO · 인천 버스 노선·정류소·도착·위치", URL `https://www.data.go.kr`
  - `naverMap`: 제목 "NAVER 지도", 부제 "배경 지도", URL `https://www.ncloud.com/product/applicationService/maps`
- `dataGoKr` 부제는 "서울 버스 위치·노선·정류소, 서울교통공사 시간표"로 바꿉니다.
- 라이선스 표기는 `docs/research/2026-10-30-data-sources.md`를 따릅니다(공공누리 1유형, ODbL). 각주 `dataSources.footnote`는 그대로 둡니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("앱이 쓰는 모든 출처가 제공 기관 하나 이상에 있다", () => {
	const covered = new Set(DATA_PROVIDERS.flatMap((p) => p.sources));
	expect(USED_SOURCES.filter((s) => !covered.has(s))).toEqual([]);
});
it("버스 출처 ID(@Betro/commute/refs BUS_SOURCE_IDS)마다 USED_SOURCES에 대응이 있다", () => {});
```

기존 `data-sources.test.ts`의 제공 기관 4곳 단언(`:22-47`)은 7곳으로 고칩니다(Global Constraints).

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/legal`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/legal apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): credit GBIS, TAGO and NAVER Map on the data sources screen"
```

### Task 4: 개인정보 처리방침과 오픈소스 고지

Model: sonnet

**Files:**
- Create: `apps/server/src/privacy-page.ts`
- Modify: `apps/server/src/app.ts`. `AppDeps`에 `privacyContact?: string`을 더하고, API 호스트에 `GET /privacy`를 더합니다. CSP는 상태 페이지와 같습니다.
- Modify: `apps/server/src/index.ts`. `getApp(env)`가 `privacyContact: env.PRIVACY_CONTACT`를 넘깁니다. 이 줄이 없으면 배포에서 값이 닿지 않습니다.
- Modify: `apps/server/src/worker-env.ts`, `apps/server/wrangler.jsonc`. `PRIVACY_CONTACT` 변수(값은 비워 둡니다. Part C에서 사용자가 채웁니다)
- Create: `apps/native/scripts/generate-licenses.ts`. `apps/native/package.json`의 `dependencies`를 따라 설치된 패키지의 `name`, `version`, `license`를 `apps/native/assets/licenses.json`에 씁니다. `workspace:` 의존성(`@Betro/api`, `@Betro/commute`)은 우리 코드이므로 뺍니다.
- Create: `apps/native/lib/legal/privacy.ts`. `privacyUrl`을 둡니다.
- Create: `apps/native/app/settings/licenses.tsx`
- Modify: `apps/native/app/(tabs)/settings.tsx:309-325`. "정보" 섹션에 "개인정보 처리방침"(외부 주소 열기), "오픈소스 라이선스" 행을 더합니다.
- Modify: `apps/native/app/_layout.tsx`. `settings/licenses`를 등록합니다.
- Modify: `apps/native/lib/i18n/messages-ko.ts`. `settings.privacy.title`, `settings.licenses.title`, `licenses.*`
- Test: `apps/server/src/privacy-page.test.ts`, `apps/server/src/app.test.ts`, `apps/native/scripts/generate-licenses.test.ts`, `apps/native/lib/legal/privacy.test.ts`

**Interfaces:**
- Produces:

```ts
export function renderPrivacyPage(input: { contact: string | null; updatedOn: string }): string;
/** 끝의 `/`를 떼고 `/privacy`를 붙인다. */
export function privacyUrl(serverUrl: string): string;
/** `workspace:`로 시작하는 의존성은 뺀다. */
export function collectLicenses(pkgJson: { dependencies: Record<string, string> }, readPackage: (name: string) => { license?: string; name: string; version: string } | null): { license: string; name: string; version: string }[];
```

- 처리방침 내용(스펙 5.2):
  - 서버가 받는 것: 설치 ID, 플랫폼, 푸시 토큰, 출퇴근 경로의 구간(노선·정류장·역)과 나가는 시각·요일
  - 크래시 보고(Sentry, 개인 식별 정보 없음, 설치 ID로 묶음)와 하루 지도 지표 숫자
  - 받지 않는 것: 주소, 좌표, 장소 이름. 위치는 기기 안에서만 씁니다.
  - 즐겨찾기와 장소는 기기에만 저장됩니다.
  - 지우는 법: 장소를 지우면 그 경로가 서버에서 지워집니다. 설치 기록의 보존 기간은 열린 질문 2의 답을 받기 전까지 적지 않습니다.
  - 광고 추적을 하지 않습니다.
- `contact`가 null이면 연락처 줄을 빼고 그린다. 빈 값으로 배포하지 않는 것은 Part C에서 확인합니다.
- `license`가 없는 패키지는 "UNKNOWN"으로 쓰고, 스크립트가 그 이름을 stderr에 찍습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("처리방침은 주소·좌표를 받지 않는다고 쓰고 광고 추적 문구가 있다", () => {
	const html = renderPrivacyPage({ contact: null, updatedOn: "2026-11-24" });
	expect(html).toContain("주소");
	expect(html).not.toContain("<script");
});
it("/privacy는 API 호스트에서만 200이고 상태 호스트에서는 404다", async () => {});
it("collectLicenses는 이름순이고 license가 없으면 UNKNOWN이며 workspace 의존성은 없다", () => {});
it("privacyUrl은 끝의 /를 한 번만 둔다", () => {
	expect(privacyUrl("https://api.example.test/")).toBe("https://api.example.test/privacy");
});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/privacy-page.test.ts src/app.test.ts && cd ../native && bun test scripts lib/legal`. Expected: FAIL.
- [ ] **Step 3: 구현하고 스크립트를 한 번 돌려 `licenses.json`을 만듭니다** (`cd apps/native && bun scripts/generate-licenses.ts`).
- [ ] **Step 4: 통과를 확인합니다** 같은 명령. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src apps/server/wrangler.jsonc apps/native/scripts apps/native/assets/licenses.json apps/native/app apps/native/lib/legal apps/native/lib/i18n/messages-ko.ts
git commit -m "feat: add a privacy policy page and an open source licenses screen"
```

### Task 5: 릴리스 빌드 설정

Model: opus

**Files:**
- Create: `apps/native/eas.json`
- Modify: `apps/native/app.config.ts`
- Modify: `apps/native/plugins/with-sentry-upload-guard.js`. production 빌드에서 Sentry 값이 없으면 업로드를 조용히 건너뛰지 않고 빌드를 멈춥니다.
- Test: `apps/native/app-config.test.ts`

**Interfaces:**
- Produces: `app.config.ts`는 `export default config`를 유지합니다. 테스트는 `process.env`를 바꾼 뒤 `import(…?v=<n>)`로 다시 읽습니다.

- `eas.json`:
  - `cli.appVersionSource: "remote"`
  - `build.development`: `developmentClient: true`, `distribution: "internal"`
  - `build.preview`: `distribution: "internal"`
  - `build.production`: `autoIncrement: true`
  - `submit.production`: 비워 둡니다. 계정 값은 Part C에서 사용자가 채웁니다.
- `app.config.ts`:
  - `ios.config.usesNonExemptEncryption: false`
  - `ios.supportsTablet: false`
  - `ios.privacyManifests.NSPrivacyCollectedDataTypes`
    - `NSPrivacyCollectedDataTypeCrashData`: linked false, tracking false, 목적 `NSPrivacyCollectedDataTypePurposeAppFunctionality`
    - `NSPrivacyCollectedDataTypeOtherDiagnosticData`: 같은 값
    - `NSPrivacyCollectedDataTypeDeviceID`(설치 ID): 같은 값
  - `expo-location` 플러그인 옵션: `locationAlwaysAndWhenInUsePermission: false`, `locationAlwaysPermission: false`, `motionUsagePermission: false`, `locationFullAccuracyPermission: false`, `isIosBackgroundLocationEnabled: false`, `isAndroidBackgroundLocationEnabled: false`
    - 마지막 두 옵션이 없으면 플러그인이 `NSMotionUsageDescription`과 `NSLocationTemporaryUsageDescriptionDictionary`에 영어 기본 문구를 넣습니다(`node_modules/expo-location/plugin/build/withLocation.js:215-236`). 앱은 움직임 감지와 일시적 정밀 위치를 쓰지 않습니다(`rg "requestTemporaryFullAccuracy|Pedometer" apps/native` 결과 없음).
  - `android.googleServicesFile`은 `process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json"`, `ios.googleServicesFile`은 `process.env.GOOGLE_SERVICE_INFO_PLIST ?? "./GoogleService-Info.plist"`입니다. 두 파일은 git이 무시하므로(`apps/native/.gitignore:50-51`) EAS 원격 빌드에는 파일 환경 변수로만 들어옵니다.
  - `android.blockedPermissions`: `android.permission.READ_EXTERNAL_STORAGE`, `android.permission.WRITE_EXTERNAL_STORAGE`, `android.permission.SYSTEM_ALERT_WINDOW`
  - `process.env.EAS_BUILD_PROFILE === "production"`이고 `EXPO_PUBLIC_SENTRY_DSN`이 없으면 throw합니다. 메시지는 키 값을 담지 않습니다.
  - `with-sentry-upload-guard.js`: `EAS_BUILD_PROFILE`이 `production`이면 `SENTRY_AUTH_TOKEN`·`SENTRY_ORG`·`SENTRY_PROJECT` 중 하나라도 없을 때 `SENTRY_DISABLE_AUTO_UPLOAD=true` 대신 오류로 끝냅니다(Xcode env 스크립트는 `exit 1`, Gradle은 `throw new GradleException`). 이 검사는 설정 읽기가 아니라 빌드 단계에 둡니다. 비밀 환경 변수는 EAS 빌드 기계에서만 보이기 때문입니다. [설계 판단]
  - `extra.eas.projectId`와 `owner`는 넣지 않습니다. 사용자가 `eas init`으로 넣습니다(Part C).

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("production 프로필에 DSN이 없으면 설정을 읽을 때 멈춘다", async () => {});
it("프로필이 없으면 DSN 없이도 읽힌다", async () => {});
it("위치 Always 문구를 넣지 않고 사용 중 문구는 한국어다", async () => {
	const config = await load({ NAVER_MAP_CLIENT_ID: "test-client" });
	const location = pluginOptions(config, "expo-location");
	expect(location).toMatchObject({ locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false, locationFullAccuracyPermission: false, motionUsagePermission: false });
	expect(location?.locationWhenInUsePermission).toContain("위치");
});
it("암호화 면제, iPad 끔, 개인정보 수집 항목 세 개", async () => {});
it("Firebase 설정 파일 경로는 EAS 파일 환경 변수가 있으면 그것을 쓴다", async () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test app-config.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인하고, 생성 결과를 골라 봅니다**

Run: `cd apps/native && bun test app-config.test.ts && npx expo config --type introspect 2>/dev/null | rg -o "NSLocation[A-Za-z]*|ITSAppUsesNonExemptEncryption|UIDeviceFamily|SYSTEM_ALERT_WINDOW|EXTERNAL_STORAGE" | sort -u`
Expected: 테스트 PASS. 출력에 `NSLocationWhenInUseUsageDescription`과 `ITSAppUsesNonExemptEncryption`, `UIDeviceFamily`는 있고, `NSLocationAlways…`, `NSLocationTemporaryUsageDescriptionDictionary`, `SYSTEM_ALERT_WINDOW`, `EXTERNAL_STORAGE`는 없습니다. `rg -c NSMotionUsageDescription`도 0입니다(blockedPermissions는 `tools:node="remove"`로 남을 수 있습니다. 그 경우 매니페스트에서 remove인지 봅니다).

Run: `cd apps/native && npx expo prebuild --platform ios --no-install && rg -o "NSPrivacy[A-Za-z]*|CA92.1|C617.1|35F9.1" ios/Betro/PrivacyInfo.xcprivacy | sort -u`
Expected: 이유 코드 `CA92.1`, `C617.1`, `35F9.1`이 그대로 있고, `NSPrivacyCollectedDataTypeCrashData`, `…OtherDiagnosticData`, `…DeviceID`가 더해졌습니다. `ios/`는 git이 무시하는 생성물입니다.

- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/eas.json apps/native/app.config.ts apps/native/app-config.test.ts apps/native/plugins/with-sentry-upload-guard.js
git commit -m "chore(native): add EAS profiles and release privacy and permission settings"
```

## Part B: 출시 전에 고칠 남은 일

### Task 6: GBIS 일시 오류 코드를 재시도하기 (남은 일 #5)

Model: sonnet

**Files:**
- Modify: `packages/commute/src/sources/regional-bus.ts:149-154`
- Test: `packages/commute/src/sources/regional-bus.test.ts`

- 0과 4가 아닌 숫자 `resultCode`는 `temporary`입니다. 숫자가 아니면 `malformed`입니다. 수집기 파서(`packages/realtime/src/upstream/regional-position.ts:130-136`)와 같은 규칙입니다.
- 지금 `gbisEnvelope`는 `z.coerce.number()`(`regional-bus.ts:126`)라서 `""`·`null`이 0(정상)으로 읽힙니다. 이것을 수집기의 `num()`(`regional-position.ts:64-67`)처럼 "숫자이거나 숫자 문자열일 때만 숫자"로 바꿉니다.
- TAGO(`tagoItems`, `:282-288`)도 수집기(`regional-position.ts:172-178`)와 맞춥니다. "00"·"03"이 아닌 코드는 `temporary`, 코드가 없으면 `malformed`입니다.
- 재시도는 지금처럼 한 번이고 시도마다 예산을 씁니다(`#attemptRegional`). 영구 오류 코드가 반복되면 하루 예산이 그만큼 닳지만, 수집기와 같은 규칙을 지키는 쪽을 고릅니다. [설계 판단]
- 실행기가 `temporary`를 재시도로 다루는지(`runner-core.ts` `#attemptRegional`) 확인하고, 아니면 그 분기도 고칩니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("GBIS resultCode 1은 temporary다", () => {
	expect(parseGbisLocations(gbisEnvelope(1))).toEqual({ ok: false, reason: "temporary" });
});
it("resultCode가 빈 문자열이나 null이면 정상이 아니라 malformed다", () => {
	expect(parseGbisLocations(gbisEnvelope(""))).toEqual({ ok: false, reason: "malformed" });
});
it("TAGO resultCode 99는 temporary다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd packages/commute && bun test src/sources/regional-bus.test.ts`. Expected: FAIL. 지금은 malformed가 나옵니다.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd packages/commute && bun test && cd ../../apps/server && bun test src/commute`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/sources apps/server/src/commute
git commit -m "fix(commute): retry GBIS system error codes as temporary"
```

### Task 7: Android 카운트다운이 0 아래로 가지 않게 (남은 일 #1)

Model: opus

**Files:**
- Modify: `apps/native/lib/commute/notification-content.ts`
- Modify: `apps/native/lib/commute/handle-commute-message.ts:109`, `apps/native/lib/commute/lock-sample-presenter.ts:65`. `now`와 `deps.t("commute.lock.minutes.soon")`을 넘깁니다.
- Modify: `apps/native/modules/commute-notification/android/src/main/java/expo/modules/commutenotification/CommuteNotificationModule.kt`. `ContentRecord`(`:9-17`)와 `CommuteContent` 변환(`:36-54`)에 `afterCountdown`(본문·칩)을 더합니다. 이것이 없으면 JS 값이 Kotlin에 닿지 않습니다.
- Modify: `apps/native/modules/commute-notification/android/src/main/java/expo/modules/commutenotification/CommuteNotifier.kt`. `show()`(`:43`)에서 알람을 걸고 마지막 내용을 저장하고, `end()`(`:68`)에서 알람을 지웁니다. `build()`(`:123-182`)의 타이머 분기는 그대로 둡니다.
- Create: `apps/native/modules/commute-notification/android/src/main/java/expo/modules/commutenotification/CountdownEndReceiver.kt`
- Modify: `apps/native/modules/commute-notification/android/src/main/AndroidManifest.xml`. 리시버를 등록합니다(`exported="false"`).
- Test: `apps/native/lib/commute/notification-content.test.ts`

**Interfaces:**
- Produces:

```ts
export const MIN_COUNTDOWN_MS = 60_000;
export interface NotificationContent {
	// 기존 필드 그대로
	/** 타이머가 끝난 뒤 네이티브가 다시 그릴 본문과 칩. 타이머가 없으면 null. */
	afterCountdown: { body: string; chipText: string } | null;
}
/** `soonText`는 `commute.lock.minutes.soon`("곧")이다. 이 모듈은 `t`를 모르므로 부르는 쪽이 넘긴다. */
export function notificationContent(model: LockScreenModel, nowMs: number, soonText: string): NotificationContent;
```

- `countdownEpoch × 1000 − nowMs < MIN_COUNTDOWN_MS`이면 타이머를 걸지 않습니다(`countdownAtMs: null`). 이때 본문 끝과 칩의 남은 분은 `model.minutes`가 아니라 `soonText`입니다. 모델을 만든 뒤 시간이 흘러 "1분"이 남는 일을 막습니다.
- 타이머를 걸면 `afterCountdown`은 남은 분 자리에 `soonText`를 넣은 본문과 칩입니다.
- 기존 `notification-content.test.ts`의 인자 하나 호출과 `toEqual`(`:27-96`)은 새 인자와 `afterCountdown`을 넣어 고칩니다(Global Constraints).
- Kotlin:
  - `CommuteNotifier.show`는 타이머가 있으면 `AlarmManager.setAndAllowWhileIdle(RTC, countdownAt, …)`로 `CountdownEndReceiver`를 겁니다. 정확한 알람 권한이 필요 없고 Doze에서도 울리지만, 늦을 수 있습니다. 화면이 꺼진 동안 울리지 않아 켤 때 잠깐 음수가 보이는지는 Task 13에서 화면을 끈 채로 보고, 보이면 `RTC_WAKEUP`으로 바꿉니다.
  - 마지막 내용(JSON)은 `SharedPreferences`에 둡니다. `sessionId`, `planId`, `seq`, `endLabel`, `channelName`도 같이 둡니다.
  - 리시버는 저장된 `seq`가 알람을 건 `seq`와 같고 같은 세션의 알림이 아직 있을 때만 `afterCountdown`으로 타이머 없이 다시 그립니다. 늦게 울린 알람이 새 내용을 덮지 않게 하려는 것입니다.
  - 새 `show`와 세션 끝은 걸린 알람을 지웁니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("남은 시간이 1분보다 짧으면 타이머를 걸지 않는다", () => {
	const content = notificationContent(model({ countdownEpoch: NOW_S + 30, minutes: "1분" }), NOW_S * 1000, "곧");
	expect(content.countdownAtMs).toBeNull();
	expect(content.afterCountdown).toBeNull();
	expect(content.chipText).toBe("곧");
});
it("타이머를 걸면 끝난 뒤의 칩은 '곧'이다", () => {
	const content = notificationContent(model({ countdownEpoch: NOW_S + 300 }), NOW_S * 1000, "곧");
	expect(content.afterCountdown?.chipText).toBe("곧");
});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/native && bun test lib/commute`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** Kotlin은 컴파일만 확인합니다: `cd apps/native/android && ./gradlew :commute-notification:compileDebugKotlin`. 기기 확인은 Task 13입니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib`. Expected: PASS. `lock-screen-cases.json` 사례 테스트도 통과합니다.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/native/lib/commute apps/native/modules/commute-notification
git commit -m "fix(android): stop the commute countdown at zero instead of counting negative"
```

### Task 8: 지역 버스 호출 동시성 (남은 일 #6)

Model: opus

**Files:**
- Modify: `apps/server/src/commute/runner-core.ts:1698`(노선 하나의 정류장들). 동시성 1을 `REGIONAL_CONCURRENCY`로 바꿉니다. 노선 단위(`:1605`)는 1로 둡니다. 둘 다 올리면 동시에 3×3=9건이 나가 수집기의 `MAX_PARALLEL_CALLS = 6`(`collector/core.ts:60`)보다 많아집니다. [설계 판단]
- Test: `apps/server/src/commute/runner-core.test.ts`

**Interfaces:**
- Produces: `export const REGIONAL_CONCURRENCY = 3;`

- 예산은 시도마다 셉니다(`#attemptRegional`). 하지만 지금은 `await store.get(budgetKey)`로 읽고 `await store.put(budgetKey, used + 1)`로 씁니다(`:1814`, `:1829`). `RunnerStore`가 비동기라(`ports.ts:72-77`) 동시에 부르면 둘 다 같은 `used`를 읽어 한도를 넘깁니다.
- 그래서 `RunnerCore`에 `budgetKey`별 직렬 큐(`#budgetLocks: Map<string, Promise<unknown>>`)를 둡니다. 멈춤 확인, `used` 읽기, 지도 몫·한도 판정, `put(used + 1)`을 이 큐 안에서 한 번에 합니다. 상류 호출(`call.fetch()`)은 큐 밖이므로 정류장 세 곳이 동시에 나갑니다. 재시도도 같은 큐를 다시 거칩니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("TAGO 정류장 세 곳이 각 8초 걸려도 tick은 약 8초다", async () => {});
it("예산이 2건 남았을 때 동시에 세 곳을 불러도 2건만 부르고 저장된 used는 한도와 같다", async () => {
	// 가짜 store의 get/put은 각각 한 틱씩 늦게 끝난다(await 사이 경쟁을 드러내려는 것).
});
it("노선 두 개의 정류장을 불러도 동시에 나가는 호출은 3건을 넘지 않는다", async () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/commute/runner-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/server && bun test src`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src/commute
git commit -m "perf(commute): call regional bus stops three at a time"
```

### Task 9: 수집기 지역 위치 간격 상한 (남은 일 #7)

Model: sonnet

**Files:**
- Modify: `packages/realtime/src/schedule.ts:312-325`. 지역 종류(`gbis-position`, `tago-position`)는 간격을 `regionalMaxIntervalMs`에서 자릅니다.
- Modify: `apps/server/src/collector/cf-ports.ts:686-701`(`configEnv`), `apps/server/src/worker-env.ts`. 환경 변수를 이름으로 골라 넘기므로 `REGIONAL_MAX_INTERVAL_MS`를 두 곳에 더해야 Worker가 읽습니다.
- Test: `packages/realtime/src/schedule.test.ts`

**Interfaces:**
- Produces: `CollectorConfig.regionalMaxIntervalMs: number`(기본 `240_000`, 환경 변수 `REGIONAL_MAX_INTERVAL_MS`)

- 지금은 남은 예산을 운행 시간 전체에 고르게 폅니다. 지역 노선은 지도에서 보는 동안만 부르므로, 이 계산은 간격을 차량 TTL(`BUS_TTL_MS = 300_000`, `state.ts:6`)보다 길게 만듭니다. 2개 노선이면 약 456초입니다.
- 규칙: `interval = min(spread, max(minMs, regionalMaxIntervalMs))`이고, `spread`는 지금 계산(`max(minMs, …)`)입니다. 하한(`minMs`)이 상한보다 크면 하한이 이깁니다. `dev` 하한은 `busMinIntervalMs = 160_000`(`schedule.ts:23`)이므로 상한 기본값은 그보다 크고 TTL보다 작은 240초입니다. [설계 판단]
- 상한을 두면 예산이 더 빨리 닳습니다. 하루 300건이면 노선 2개(시간당 30건)는 약 10시간, 설치 상한 6개(시간당 90건)는 약 3.3시간 뒤 닳습니다. 닳으면 Task 1의 규칙으로 그 출처가 `stoppedSources`에 들어가 "실시간 정보 없음"이 됩니다(5-B 설계 결정 10). 예산 값은 열린 질문입니다.
- `schedule.test.ts`의 `dev defaults` `toEqual`(`:35-53`)에 `regionalMaxIntervalMs: 240_000`을 더합니다(Global Constraints).

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("GBIS 노선 두 개를 보고 예산이 300건이어도 간격은 240초를 넘지 않는다", () => {});
it("하한이 상한보다 크면 하한을 쓴다", () => {});
it("서울 버스 간격은 바뀌지 않는다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd packages/realtime && bun test src/schedule.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd packages/realtime && bun test && cd ../../apps/server && bun test src/collector`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add packages/realtime/src apps/server/src/collector/cf-ports.ts apps/server/src/worker-env.ts
git commit -m "fix(realtime): cap regional position intervals below the vehicle TTL"
```

### Task 10: 7.1 정확도 보고 스크립트 (남은 일 #3)

Model: sonnet

**Files:**
- Create: `scripts/accuracy-report.ts`
- Test: `scripts/accuracy-report.test.ts`

**Interfaces:**
- Consumes: `packages/commute/src/accuracy.ts`의 `SessionSummary`(`:162`)와 `dailyReport`(`:889`). R2 `commute/summaries/…` 파일은 이미 `SessionSummary` JSON이므로 `summarize`(`:758`)는 쓰지 않습니다.
- Produces:

```ts
/** `within1Min`·`within2Min`은 건수, `ratio1Min`·`ratio2Min`은 0~1 비율이다. */
export interface AccuracyHitRates { mode: "bus" | "subway"; ratio1Min: number; ratio2Min: number; samples: number; within1Min: number; within2Min: number }
export function hitRates(summaries: readonly SessionSummary[]): AccuracyHitRates[];
/** 7.1의 나머지 자동 기준. 기간 전체 요약을 `dailyReport`로 한 번에 묶은 값이다. */
export function periodReport(summaries: readonly SessionSummary[]): DailyCommuteReport;
```

- 입력은 로컬 폴더입니다(`bun scripts/accuracy-report.ts <dir>`). R2 `commute/summaries/…`를 받아 오는 일은 사용자가 합니다. 스크립트는 네트워크를 쓰지 않습니다.
- 도착 정확도: `predictions`는 이미 차량마다 5분 전 시점 예측입니다(`leadMs`, `accuracy.ts:611`). `mode`는 `parseRef(line).source`가 `seoul-subway`면 subway, 그 밖은 bus입니다. 표시 방식(시간표 추정 포함)과 상관없이 모두 셉니다(스펙 7.1).
- 기준은 "±1분 80%, ±2분 95%"입니다(`docs/research/2026-11-06-mvp2-experiments.md:580`, 정확도 우선 설계 `:287`).
- 나머지 7.1 기준도 같은 출력에 싣습니다. 계산은 `dailyReport`에 맡기고 새로 만들지 않습니다.
  - 자동 시작(`starts.onTime / 전체`, 20회 중 20회)
  - 끊김(`maxSendGapMs` 2분 초과 0회)
  - 대안 제안(`suggestions.faster / (faster + slower)` 80%)
  - 나가는 시각(`leave`, 보고만)
  - 종료(`endReasons`)
- 출력은 표와 기준마다 통과 여부입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("예측 오차 0.5분·1.5분·3분 세 건이면 ±1분 1건(1/3), ±2분 2건(2/3)이다", () => {});
it("예측이 없는 세션은 도착 정확도에 세지 않는다", () => {});
it("지하철 노선 예측은 subway, 버스 출처는 bus로 나눈다", () => {});
it("기간 보고는 자동 시작·끊김·대안 제안을 dailyReport와 같게 센다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `bun test scripts/accuracy-report.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** `predictions`는 실제 도착 5분 전 ±60초 안에서 5분에 가장 가까운 예측 하나씩만 담습니다(`scorePredictions`, `accuracy.ts:583-617`). 그래서 다시 고르지 않고 그대로 셉니다. 오차 비교는 `dailyReport`의 `WITHIN_60_MS`·`WITHIN_120_MS`와 같은 값을 씁니다.
- [ ] **Step 4: 통과를 확인합니다** 같은 명령. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add scripts/accuracy-report.ts scripts/accuracy-report.test.ts
git commit -m "feat(scripts): report 7.1 hit rates from commute summaries"
```

### Task 11: 묵은 푸시 토큰 정리 (남은 일 #2)

Model: sonnet

**Files:**
- Create: `apps/server/src/commute/push-token-prune.ts`
- Modify: `apps/server/src/index.ts`. cron(`scheduled`)의 `Promise.allSettled`에 더합니다. cron은 5분마다 돌므로(`wrangler.jsonc:23`) `shouldPrune(now)`가 하루 한 번(서비스일 경계 뒤 04:00~04:05, `DEFAULT_TIMEZONE`)만 true입니다.
- Test: `apps/server/src/commute/push-token-prune.test.ts`

**Interfaces:**
- Produces:

```ts
export const ACTIVITY_TOKEN_KEEP_MS = 86_400_000;
export const IDLE_TOKEN_KEEP_MS = 60 * 86_400_000;
export function shouldPrune(now: number, timezone: string): boolean;
export async function prunePushTokens(db: Database, now: number): Promise<number>;
```

- 지우는 것:
  - `kind = 'apns-activity'`이고 그 `sessionId`의 세션(`commute_session.id`)이 `status = 'ended'`이며, `endedAt`에서 `ACTIVITY_TOKEN_KEEP_MS`가 지난 행
  - `kind = 'apns-activity'`이고 그 `sessionId`의 세션 행이 없으며, `updatedAt`에서 `ACTIVITY_TOKEN_KEEP_MS`가 지난 행. iOS는 모든 Activity의 토큰을 보내므로(`CommuteTokenReporter.swift:111-115`) 표본 화면의 `sample-<n>` 세션 토큰도 서버에 쌓입니다.
  - 켜진 출퇴근 계획(`commute_plan.enabled = 1`)이 없고, `install.lastSeenAt`이 `IDLE_TOKEN_KEEP_MS`보다 오래된 설치의 모든 토큰
- 시작 토큰(`apns-start`, FCM)은 `push_token.updatedAt`으로 판단하지 않습니다. 앱은 서버가 받은 토큰을 다시 보내지 않아서(`lib/commute/handle-commute-action.ts`), 쓰는 시작 토큰도 `updatedAt`이 오래될 수 있습니다.
- `install.lastSeenAt`은 인증된 요청마다 하루 한 번 갱신됩니다(`commute/auth.ts:78-83`, `routes.test.ts:207-211`). 그래서 두 번째 규칙을 씁니다.
- 진행 중 세션의 토큰과 켜진 계획이 있는 설치의 토큰은 지우지 않습니다. 지운 행 수를 돌려주고 로그에는 수만 남깁니다.
- 정리 기준(60일)은 열린 질문입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("끝난 세션의 Live Activity 토큰은 하루 뒤 지우고 진행 중 세션 토큰은 남긴다", async () => {});
it("세션 행이 없는 Live Activity 토큰(sample-1)은 하루 뒤 지운다", async () => {});
it("켜진 계획이 없고 60일 넘게 접속하지 않은 설치의 토큰은 지운다", async () => {});
it("켜진 계획이 있으면 updatedAt이 오래돼도 시작 토큰을 남긴다", async () => {});
it("shouldPrune은 하루에 한 cron 칸에서만 true다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/commute/push-token-prune.test.ts`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** 세션 표 이름과 끝난 시각 열은 `packages/db/src/schema/commute.ts`를 봅니다. D1 바인딩 100개 제한 때문에 ID 목록을 `IN`으로 넘기지 않고 하위 질의로 지웁니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/server && bun test src`. Expected: PASS.
- [ ] **Step 5: 커밋합니다**

```bash
git add apps/server/src
git commit -m "feat(commute): prune push tokens of ended sessions and idle installs"
```

### Task 12: 전체 확인

Model: sonnet

- [x] **Step 1: 전체 테스트, 타입, 린트를 돌립니다**

Run: 각 패키지에서 `bun test`(`packages/commute`, `packages/realtime`, `packages/transit-static`, `apps/server`(`src`), `apps/native`(`lib`, `components`, `scripts`, `app-config.test.ts`)), 루트 `bun test scripts`, `bun run check-types`, `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`.
Expected: 실패 0, 타입 오류 0, 린트 오류 0.

- [x] **Step 2: 5-B 계획 Task 11 Step 1의 결과를 그 계획 끝에 적습니다.** Step 2(배포)와 Step 3(기기)은 Task 13으로 옮겼다고 적습니다.
- [x] **Step 3: 커밋합니다**

```bash
git add docs/superpowers/plans
git commit -m "docs(plan): record release readiness verification"
```

## Part C: 사용자 확인이 필요한 일

### Task 13: 기기 확인과 배포 (사용자 확인 뒤)

Model: opus

이 Task의 단계는 하나씩 사용자에게 확인을 받고 진행합니다. 기기 확인은 한 번에 모아서 하고, 어느 기기를 연결할지만 묻습니다. 비행기 모드와 절전 모드 확인은 하지 않습니다.

- [ ] **Step 1: 원격 반영 (서버).** 순서는 다음과 같습니다.
  1. 5-A: 원격 D1 migration 0008, `publish:d1 --remote`
  2. GBIS 원본의 남은 92개 노선 받기(`fetch:gbis-routes`)와 다시 적재. 이 단계는 없어도 다음 단계를 막지 않습니다.
  3. `wrangler.jsonc`의 `PRIVACY_CONTACT` 채우기
  4. `wrangler deploy`
  5. 배포 뒤 `/v1/ref/search-index` 크기와 응답 시간, `/privacy`를 봅니다.
  6. GBIS 노선 하나를 지도에서 열어 Worker에서 GBIS가 불리는지 봅니다(5-B Task 11 Step 2).
- [ ] **Step 2: 기기 확인.** iOS 시뮬레이터와 S20 실기기입니다.
  - 7.2 흐름: 온보딩 → 권한 → 지도 → 검색 → 상세 → 즐겨찾기 → 내 장소 등록 → 출퇴근 안내
  - 검색창 자리표시자가 Android에서 가운데에 있는지(남은 일 #4)
  - 지도 위 알약과 검색창이 NAVER 로고를 가리지 않는지(네이버 지도 약관)
  - Android 출퇴근 알림의 카운트다운이 0에서 "곧"으로 바뀌는지(Task 7). 화면을 켠 채로 한 번, 끈 채로 한 번 보고 늦은 초를 적습니다. 화면을 켤 때 음수가 잠깐이라도 보이면 알람을 `RTC_WAKEUP`으로 바꿉니다.
  - 경기·인천 노선 출퇴근 카드가 실시간 ETA를 내는지(5-B Task 11 Step 3)
  - 2-E의 Android 18 Live Update 프레임 문구
- [ ] **Step 3: 릴리스 빌드.**
  - `eas init`으로 `owner`, `extra.eas.projectId`를 넣습니다.
  - EAS 환경 변수: `NAVER_MAP_CLIENT_ID`, `EXPO_PUBLIC_SERVER_URL`, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`·`SENTRY_ORG`·`SENTRY_PROJECT`
  - 파일 비밀값: `google-services.json`은 `GOOGLE_SERVICES_JSON`, `GoogleService-Info.plist`는 `GOOGLE_SERVICE_INFO_PLIST`라는 EAS 파일 환경 변수로 올립니다(Task 5가 이 이름을 읽습니다).
  - production 빌드 뒤 아카이브 entitlements의 `aps-environment`가 `production`인지 봅니다(`codesign -d --entitlements :- <app>`).
  - Sentry에 그 릴리스의 소스맵이 올라갔는지, 시험 오류 하나가 원래 줄로 보이는지 봅니다.
- [ ] **Step 4: 스토어 양식.** App Store 개인정보(App Privacy)와 Google Play 데이터 보안 양식을 Task 5의 매니페스트와 Task 4의 처리방침에 맞춰 채웁니다. 처리방침 주소는 `<API 호스트>/privacy`입니다.
- [ ] **Step 5: 출시 뒤 읽을 지표.**
  - Sentry `map-motion-daily`의 `ratio`(7.2 ③, 1% 미만)
  - 크래시 0회(7.2 ①, 2주)
  - `scripts/accuracy-report.ts`(7.1)
- [ ] **Step 6: 남은 측정.** 2-C의 지하철 `staleAfterMs`(150초) 측정, 정확도 계획 Task 10의 사전 수집은 지하철 세션이 있어야 하므로 실사용 기간에 합니다.

## 이번에 하지 않는 것

- 2-E: `ContentState`에 버스 `routeType`을 넣어 잠금화면 배지 색을 나누는 일. 겉모습만 바뀌고 서버와 앱을 같이 고쳐야 합니다. 열린 질문입니다.
- 2-C: 임시 공휴일에 평일 시간표를 쓰는 문제, 지원 목록 밖 시간대 경로. 지금 사용자 범위(서울 시간대)에서는 생기지 않습니다.
- 4단계: 401로 멈춘 출처를 상태 페이지가 표시하지 않는 것, `clientDisconnected` 알람. 관찰 항목입니다.
- 옛 계획들의 체크박스 정리. 문서만 바뀌고 동작은 같습니다.

## 열린 질문 (사용자만 답할 수 있음)

1. 시간표 위치 열차(Task 2)를 1차 출시에 꼭 넣을까요? **기본값: 넣습니다(스펙 5.8).** 교차 검토 뒤 이 Task는 구간 거르기, 시트, 신선도 줄까지 고치므로 Part A에서 가장 큽니다.
2. 개인정보 처리방침의 연락처와 설치 기록 보존 기간. **기본값: 둘 다 배포 전에 받습니다. 그전까지 페이지는 연락처 줄을 빼고, 보존 기간은 "장소를 지우면 바로 지웁니다"만 적습니다. 설치 기록을 지우는 코드는 아직 없으므로 기간을 약속하지 않습니다.**
3. iPad 지원. **기본값: 받지 않습니다(`supportsTablet: false`).**
4. EAS 계정(owner)과 프로젝트. **기본값: 사용자가 `eas init`으로 정합니다.**
5. 수집기 GBIS 위치 예산(기본 하루 300건)과 간격 상한. **기본값: 예산은 그대로 두고 상한 240초를 둡니다.** `dev` 하한이 160초라 120초 상한은 성립하지 않습니다(Task 9). 노선 6개를 보면 약 3.3시간 뒤 예산이 닳고 그 출처는 "실시간 정보 없음"이 됩니다.
6. 묵은 푸시 토큰 정리(남은 일 #2)의 원래 의도와 기준. **기본값: 끝난 세션과 세션 행이 없는 Live Activity 토큰은 하루 뒤, 켜진 계획 없이 60일 접속하지 않은 설치의 토큰은 그때 지웁니다. 하루 한 번 돕니다.** `install.lastSeenAt`은 하루 한 번 갱신되므로 60일 규칙을 씁니다.
7. 2-E 버스 `routeType` 배지 색을 1차 출시에 넣을까요? **기본값: 넣지 않습니다.**
8. App Privacy에서 설치 ID를 "기기 ID"로 신고할까요? **기본값: 기기 ID, 사용자와 연결 안 됨, 앱 기능 목적으로 신고합니다.**

## 교차 검토 (2026-11-24)

Gemini(agy `gemini-4-neon-high`, 읽기 전용)로 이 계획을 검토했고, 지적 21건을 코드에서 하나씩 확인했습니다. 근거가 있는 것만 위 본문에 반영했습니다.
- 반영: 예산 소진의 멈춤 처리, 버스 추정 모드를 노선별로 판정, 시간표 열차의 위치 계산(`offsetM` 대신 `distanceM`)과 구간 거르기, `PRIVACY_CONTACT` 전달, 위치 플러그인 옵션 두 개, Firebase 파일 경로, GBIS·TAGO 파싱, Android 알림 브리지(`ContentRecord`), 예산 경쟁, 간격 상한과 하한, 정확도 보고 범위, 토큰 정리 주기와 고아 토큰
- 일부만 반영: `aps-environment`는 그대로 두고 Task 13에서 확인합니다(설계 결정 5). `RTC` 대 `RTC_WAKEUP`은 기기에서 보고 정합니다. 정리 질의용 색인은 더하지 않습니다.

