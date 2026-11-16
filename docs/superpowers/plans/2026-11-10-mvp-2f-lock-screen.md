# MVP 2-F: 잠금화면(iOS Live Activity, Android Live Update) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버가 보내는 출퇴근 푸시로 iOS Live Activity·다이내믹 아일랜드와 Android 진행 중 알림을 띄우고 갱신하고 끝낸다. 카드에는 지금 구간과 남은 구간의 승차 정보가 보인다. Android의 "종료" 버튼은 앱을 열지 않고 서버에 입력을 보낸다(2026-11-11 변경: "탔어요", "다음 차 탈게요" 버튼은 없다).

**Architecture:** 푸시 값(`ContentState` v1, 2-C가 정함)을 화면 모델로 바꾸는 규칙을 TypeScript 순수 함수 하나(`lock-screen-model.ts`)로 두고 `bun test`로 고정한다. Android는 FCM 백그라운드 처리기가 JS에서 이 모델을 만들어 Kotlin 모듈에 넘기므로 문구가 앱의 메시지 묶음 한 곳에서 나온다. iOS 위젯 확장은 JS를 돌릴 수 없어 같은 규칙을 Swift로 한 번 더 구현하고, 같은 표본 값의 기대 문구를 JSON 한 파일로 공유해 두 구현을 맞춘다. 기기 인증값(설치 ID, 비밀값)은 앱이 네이티브 모듈에 건네 iOS는 모듈 전용 키체인 항목에, Android는 헤드리스 JS가 보안 저장소에서 읽는다.

**Tech Stack:** Expo SDK 58 / React Native 0.88, `@bacons/apple-targets` 5(위젯 확장), ActivityKit + SwiftUI + App Intents(iOS 17.2+), Kotlin Expo 모듈 + `Notification.ProgressStyle`(API 36+) + `NotificationCompat`, `@react-native-firebase/messaging`, bun test.

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` 4.3, 5.2, 5.5, 5.6, 5.10, 7.1. 푸시 값은 같은 문서의 "푸시 값 v1"(2-C Task 7이 적는다). 실험 결과: `docs/research/2026-11-06-mvp2-experiments.md` 2~5절.

## 계획 중 확인한 사실 (2026-11-10)

- 실험 코드가 로컬 브랜치에 있다. `spike/mvp2-live-activity`: `apps/native/targets/commute-activity/`(위젯 확장), `apps/native/modules/commute-activity/`(Expo 모듈, `CommuteTokenReporter`), `app.config.ts`의 `@bacons/apple-targets` 설정. `spike/mvp2-android-update`: `apps/native/modules/commute-notification/`(Kotlin), `lib/push/background.ts`. 이 계획은 그 코드를 옮겨 와 고친다. 실험 브랜치 자체는 병합하지 않는다.
- iOS(실험 3, 4): 확장 타깃 이름은 로컬 모듈 pod 이름과 겹치면 안 된다(`CommuteActivityWidget`). Activity 정의 파일은 `targets/` 아래 하나를 원본으로 두고 모듈에는 심볼릭 링크로 넣는다. 앱이 꺼져 있어도 시작 푸시가 앱을 백그라운드로 깨우고, `ExpoAppDelegateSubscriber`가 JS 없이 토큰을 보낼 수 있다. push-to-start 토큰은 재설치·재부팅에도 같고, 업데이트 토큰은 Activity마다 다르다.
- Android(실험 5): 높은 우선순위 FCM 데이터 메시지 → `setBackgroundMessageHandler`(헤드리스 JS) → Kotlin 모듈 순서로 프로세스가 죽은 상태에서도 0.8초 안에 처리됐다. 삼성 "절전 앱"에서도 끊기지 않았다. 강제 종료 중에 보낸 메시지는 앱을 다시 열 때 순서가 섞여 도착한다. API 36.0에는 `setRequestPromotedOngoing`이 없어 extras 키를 직접 넣고, 리플렉션은 R8에서 깨진다.
- 앱(`develop`): 설치 ID와 비밀값은 `lib/device/app-install-identity.ts`의 `ensureInstallIdentity()`가 `expo-secure-store`(`AFTER_FIRST_UNLOCK`)에 둔다. FCM 수신은 `lib/push/*`에 있다. 문구는 `lib/i18n/messages-ko.ts`와 `t()`로만 쓴다(검사 테스트가 강제한다). 서버 주소는 `EXPO_PUBLIC_SERVER_URL`이다.
- 앱의 화면 디자인은 PR #13(Figma 개편 반영)이 병합된 뒤의 `develop`을 기준으로 한다.

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/mvp2-lock-screen`. Task 1~3은 브랜치 `feat/mvp2-lock-screen`(PR #16, 병합됨). Task 4~8은 브랜치 `feat/mvp2-lock-screen-views`(2026-11-14, `develop` `036bccd`에서 만듦. 2-E와 Task 2A가 들어 있다). PR은 develop으로.
- 커밋 메시지와 PR 본문에 AI 서명이나 출처 표기를 넣지 않는다.
- 커밋 전 lint는 `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`와 새 파일의 `bunx biome ci <파일>`로 본다(루트 `ultracite fix/check`는 쓰지 않는다). 각 Task 끝에 `bun test apps/native`와 `cd apps/native && bun run check-types`가 통과해야 한다. Swift·Kotlin을 고친 Task는 `bun run ios -- --device`와 `bun run android`로 실기기 빌드가 되어야 한다.
- **잠금화면과 그 버튼은 앱을 열지 않는다.** 로그인 요구, 팝업, 광고가 끼어들지 않는다(스펙 실패 기준).
- **위계**: 차량 위치("2정거장 전")가 가장 먼저 읽히고, 도착 시각과 남은 분은 그다음이다. 도착 시각의 확신이 낮아도 위치는 계속 보여 준다(4.3).
- **단정하지 않는다.** 사용자 입력이 없는 동안에는 차량에 대한 사실("지나갔어요")과 조건문("08:10에 나가면")만 쓴다. "놓쳤어요", "늦었어요"는 쓰지 않는다.
- **오래된 값을 그리지 않는다.** 이미 그린 것보다 `seq`가 작거나 같은 값은 버린다. 끝난 세션의 값도 버린다.
- 문구는 코드에 직접 쓰지 않는다. 앱과 Android 알림은 `messages-ko.ts`의 키, iOS 확장은 `Localizable.strings`의 같은 키를 쓴다. Android 알림을 JS가 만들기 때문에 Android 문자열 리소스가 아니라 메시지 묶음을 쓴다(스펙 5.10의 "플랫폼 문자열 리소스"에서 Android만 바꾼 것이다. **[설계 판단]**).
- 서버 주소, 설치 비밀값, 푸시 토큰을 기기 콘솔과 출퇴근 토큰 보고 로그에 남기지 않는다(`__DEV__`에서도 토큰은 앞 8자만). 예외: `components/push-notifications.tsx`가 `__DEV__`에서 번들러(Metro) 로그에 FCM 토큰 전체를 찍는 줄은 그대로 둔다. 개발자 Mac에만 보이고, 수집기 알림 대상 토큰(`ALERT_FCM_TOKEN`)을 넣을 때 그 값이 필요하다.
- iOS 최소 버전 17.2. `NSSupportsLiveActivities`와 `NSSupportsLiveActivitiesFrequentUpdates`를 켠다. Android는 `POST_PROMOTED_NOTIFICATIONS` 권한을 선언한다.
- 포그라운드 서비스와 로컬 알림 보조 경로는 만들지 않는다(실험 4, 5 결정).
- 범위 밖: 경로 등록과 출퇴근 안내 화면(2-E), 서버(2-C), 기기 위치로 탑승을 판단하는 기능, Android 16 QPR1 실기기의 상태바 칩 확인(기기가 없다. 에뮬레이터 API 36.1로만 본다).
- 선행: Task 1~3은 바로 할 수 있다. Task 4부터는 2-E의 Figma 수정(18 Live Activity, 19 Dynamic Island, 18 Live Update에 4.3의 위계와 버튼을 반영)이 끝나 있어야 한다. Task 8은 2-C가 배포돼 있어야 한다.

## 2026-11-11 변경: 버튼 제거, 남은 구간 **[사용자 결정]**

사용자가 2026-11-11에 잠금화면과 17의 "탔어요", "다음 차 탈게요" 버튼을 빼고, 카드에 남은 구간의 승차 정보를 모두 보여 주기로 정했다(스펙 4.3 개정, 근거는 "누르는 일이 번거롭다"). 탑승은 서버가 시각으로만 추정한다. 아래가 이 계획에서 바뀌는 것이고, 각 Task 본문보다 앞선다.

- **푸시 값과 잠금화면 모델은 2-E Task 2A가 바꾼다.** `ContentState.nextLegs`를 더하고(`v`는 1 그대로), `LockScreenModel`의 `progress`를 지우고 `nextLegs`(최대 2줄)·`moreLegs`("외 N구간")를 더한다. `actions`는 iOS `[]`, Android `["end"]`이다. Swift 구조체의 `nextLegs` 필드도 그 Task에서 더한다. 위 "잠금화면 문구 표"의 버튼 줄과 `status.beforeLeave` 문구는 2-E Task 2A의 표가 대신한다.
- **Task 4**: 진행 표시를 그리지 않는다. 지금 구간(배지 + 상태 + 남은 분·상세) 아래에 남은 구간 줄을 그린다. 레이아웃은 Figma `LiveActivity`(87:2420)의 2026-11-11 변형과 `NextLegRow`, `LegBadge · S`다. 카드는 모든 사례에서 160pt 이하다. 표본 대조의 "구간 3개 사례의 진행 표시" 기대는 "남은 구간 2줄과 '외 1구간'이 잘리지 않는다"로 바꾼다.
- **Task 5(iOS 잠금화면 버튼)는 하지 않는다.** App Intents와 `CommuteInputSender`를 만들지 않는다.
- **Task 6**: 버튼은 "종료" 하나다(`actionLabels`는 `end`만). 남은 구간 줄을 Android 알림에 넣을 수 있는지 먼저 확인한다. Android 16의 상단 고정(promoted ongoing) 알림은 허용되는 스타일과 커스텀 뷰 금지 조건이 있다. 그래서 `ProgressStyle` 또는 `BigTextStyle` 본문 줄로 승격이 유지되는지 공식 문서와 에뮬레이터 API 36.1로 본다. 안 되면 Android는 지금 구간만 보여 주고 그 사실을 이 문서에 적는다. `ProgressStyle`을 쓴다면 점의 수는 구간 수로 정한다(진행 표시 컴포넌트는 쓰지 않는다).
- **Task 7**: `handleCommuteAction`의 `kind`는 `"end"`뿐이다. "탔어요" 기기 확인을 지운다.
- **Task 8**: 시나리오 3·4를 아래로 바꾼다.
  - 3: 버스를 그대로 타면, 그 차량이 승차 정류장을 지난 다음 갱신에서 "하차까지 N정거장"이 된다.
  - 4: 환승 경로에서 둘째 구간 줄의 시각이 첫 구간 하차 예상에 맞춰 바뀌고, 첫 구간을 내린 뒤에는 둘째 구간이 지금 구간이 된다.
- **Review Focus 3**(잠긴 기기에서 버튼)은 Android "종료"에만 해당한다. **Review Focus 5**는 "남은 구간이 3개일 때 두 줄과 '외 1구간'이 잘리지 않는다"로 바꾼다.

## 잠금화면 문구 표 **[설계 판단]**

> **2026-11-14:** 아래 표는 처음 설계다. 버튼 줄, `status.beforeLeave`, 진행 표시는 2-E Task 2A가 바꿨다. 문구의 원본은 `apps/native/lib/i18n/messages-ko.ts`의 `commute.lock.*`, 규칙의 원본은 `lib/commute/lock-screen-model.ts`, 사례는 `lib/commute/__fixtures__/lock-screen-cases.json`이다. Swift와 Android는 이 셋에 맞춘다.

`lock-screen-model.ts`와 Swift 구현이 함께 따르는 규칙이다. 키는 `commute.lock.*`이고 값은 한국어다. `{eta}`와 `{leave}`는 기기 시간대의 `HH:mm`, `{n}`은 정거장 수, `{m}`은 분이다.

| 줄 | 조건 | 키 | 문구 |
|---|---|---|---|
| 상태 | `passed`가 있음, `mode: bus` | `status.passedBus` | `{passedLine}번이 지나갔어요` (2026-11-15: 다음 차 시각은 상세 줄로) |
| 상태 | `passed`가 있음, `mode: subway` | `status.passedSubway` | `{passedLine} 열차가 지나갔어요` |
| 상태 | `walk`, 첫 구간, 지금이 `leaveEpoch` 전 | `status.beforeLeave` | `{leave}에 나가면 {line} {eta} 탑승` |
| 상태 | `walk`·`wait`, `stopsAway` ≥ 1 | `status.stopsAway` | `{n}정거장 전` |
| 상태 | `walk`·`wait`, `stopsAway` 0 | `status.arriving` | `곧 도착` |
| 상태 | `walk`·`wait`, `stopsAway` 없음, `awaitingDeparture`이고 `positionState: live` (2026-11-15) | `status.awaitingDeparture` | `출발 대기 중` |
| 상태 | `walk`·`wait`, `stopsAway` 없음 | `status.unknown` | `위치 확인 중` |
| 상태 | `ride`, `stopsAway` ≥ 1 | `status.ride` | `하차까지 {n}정거장` |
| 상태 | `ride`, `stopsAway` 0 | `status.rideLast` | `이번에 내려요` |
| 상태 | `ride`, `stopsAway` 없음 | `status.rideUnknown` | `이동 중` |
| 상태 | `arrived` | `status.arrived` | `{stop} 도착` |
| 상세 | `passed`가 있음, `mode: bus` (2026-11-15) | `detail.passedBus`, 추정이면 `detail.passedBusEstimated` | `다음 차 {eta} · {stop}`, `다음 차 약 {eta} · {stop}` |
| 상세 | `passed`가 있음, `mode: subway` (2026-11-15) | `detail.passedSubway`, 추정이면 `detail.passedSubwayEstimated` | `다음 열차 {eta} · {stop}`, `다음 열차 약 {eta} · {stop}` |
| 상세 | `etaEpoch` 있음, `etaState: live` | `detail.eta` | `{stop} · {eta} 도착` |
| 상세 | `etaEpoch` 있음, `etaState: estimated` | `detail.etaEstimated` | `{stop} · 약 {eta} 도착` |
| 상세 | `etaEpoch` 없음 | `detail.noEta` | `{stop}` |
| 남은 분 | 60초 이상 | `minutes.value` | `{m}분` |
| 남은 분 | 60초 미만 | `minutes.soon` | `곧` |
| 태그 | `etaState: estimated`이거나 `positionState`가 `live`가 아님 | `tag.estimated` | `시간표 추정` |
| 태그 | 그 밖이고 `delayMinutes` ≥ 5 | `tag.delayed` | `지연` |
| 태그 | 그 밖 | `tag.live` | `실시간` |
| 제안 | `suggestion.mode: bus` | `suggestion.bus` | `{line}번이 {m}분 뒤 와요 · {saves}분 빨리 도착` |
| 제안 | `suggestion.mode: subway` | `suggestion.subway` | `{line} 열차가 {m}분 뒤 와요 · {saves}분 빨리 도착` |
| 버튼 | `walk`·`wait` | `action.boarded`, `action.next` | `탔어요`, `다음 차 탈게요` |
| 버튼 | Android, 모든 단계 | `action.end` | `종료` |

- 상태 줄은 위에서부터 처음 맞는 것 하나를 쓴다.
- 지하철 노선 이름(`2호선`)에는 "번"을 붙이지 않는다. 지나간 차량 문구는 지금 구간의 `mode`로, 제안 문구는 `suggestion.mode`(대안 첫 구간의 수단, 2026-11-10에 푸시 값에 더함)로 고른다.
- iOS 버튼은 `walk`·`wait`에 둘, 그 밖에는 없다. Android는 `walk`·`wait`에 `탔어요`, `다음 차 탈게요`, `종료` 셋, 그 밖에는 `종료` 하나다. "대안 경로" 버튼은 두지 않고 알림 본문을 누르면 17 출퇴근 안내가 열린다(Android 알림 버튼은 셋까지만 보인다).
- 머리줄(예: "출근 · 회사까지")은 서버가 모르는 장소 이름이라 기기에서 붙인다. 앱이 `planId`별 머리줄을 저장해 두고(2-E), 없으면 `header.fallback` "출퇴근"을 쓴다.

## Review Focus

1. **값이 비거나 추정인 경우.** `stopsAway`, `etaEpoch`, `leaveEpoch`, `suggestion`, `destinationEtaEpoch`는 null일 수 있다. 기대: 빈 칸이나 "null", "0분", 1970년 시각이 화면에 나오지 않고, 위치가 없으면 "위치 확인 중", 시각이 없으면 정류장 이름만 나온다. Task 2 테스트와 Task 4·6의 표본 화면으로 고정.
2. **늦게 도착한 옛 메시지.** Android에서 강제 종료 뒤 쌓였던 메시지가 순서 없이 오거나, 끝난 세션의 `update`가 `end` 뒤에 온다. 기대: `seq`가 더 작은 값과 끝난 세션의 값은 알림을 다시 만들지 않는다. Task 2·7 테스트로 고정.
3. **잠긴 기기에서 Android "종료".** 기기를 켠 뒤 한 번 잠금을 푼 상태에서 알림의 "종료"를 누른다. 기대: 앱을 열지 않고 인증값을 읽어 서버에 보내고, 실패하면 알림을 그대로 둔다. Task 7 테스트와 Task 8 기기 확인으로 고정.
4. **토큰 보고가 빠지는 경우.** 앱이 백그라운드로 깨어난 몇 초 안에 업데이트 토큰을 보내지 못하면 서버가 갱신할 수 없다. 기대: 네이티브 코드가 JS 없이 보내고, 실패하면 1초·3초 뒤 두 번 더 보낸다. 인증값이 아직 없으면(첫 실행 전) 보내지 않는다. Task 3의 기기 확인으로 고정.
5. **구간이 여러 개인 경로.** 남은 구간이 3개 이상이면 두 줄과 "외 N구간"을 보인다. 기대: iOS 카드가 160pt를 넘지 않고 줄이 잘리지 않으며, 긴 정류장 이름만 말줄임된다. Task 2A 테스트, Task 4의 Swift 대조, Task 8 화면으로 고정.

---

### Task 1: 서버 클라이언트와 설치 등록

**Files:**
- Create: `apps/native/lib/server/api-client.ts`, `lib/server/register-install.ts`, `lib/server/app-server.ts`(expo 의존 부분)
- Modify: `apps/native/app/_layout.tsx`(앱 시작 때 등록)
- Test: `apps/native/lib/server/api-client.test.ts`, `register-install.test.ts`

**Interfaces:**
- Produces:
  - `interface ServerClient { request(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: unknown }> }`
  - `createServerClient(deps: { baseUrl: string; fetch: typeof fetch; identity: () => Promise<InstallIdentity> }): ServerClient`. 모든 요청에 `X-Betro-Install`과 `Authorization: Bearer <secret>`를 붙인다. 타임아웃 10초. 네트워크 오류는 `{ status: 0, json: null }`로 돌려주고 던지지 않는다.
  - `registerInstall(deps: { client: ServerClient; hash: (text: string) => Promise<string>; identity: InstallIdentity; platform: "ios" | "android"; store: { get(): Promise<string | null>; set(value: string): Promise<void> } }): Promise<"registered" | "already" | "conflict" | "offline">`. `POST /v1/installs`에 `sha256(secret)`의 16진수를 보낸다. 201·200이면 `store`에 `installId`를 적어 다음 실행에서는 부르지 않는다(`"already"`). 409는 `"conflict"`(다른 해시가 이미 있다. 로그만 남긴다).
  - `app-server.ts`: `serverClient: ServerClient`(실제 값으로 묶은 것), `ensureRegistered(): Promise<void>`. 해시는 `expo-crypto`의 `digestStringAsync(SHA256)`.

- [ ] **Step 1: 실패하는 테스트**
  - 헤더 두 개가 붙고 본문이 JSON이다. `baseUrl` 끝의 `/`와 `path` 앞의 `/`가 겹쳐도 주소가 하나다.
  - fetch가 던지면 `{ status: 0, json: null }`. 응답 본문이 JSON이 아니어도 던지지 않는다.
  - 등록: 201 → `"registered"`이고 `store`에 값이 있다. 다시 부르면 fetch를 부르지 않고 `"already"`. 409 → `"conflict"`이고 `store`는 비어 있다. 네트워크 오류 → `"offline"`이고 다음에 다시 시도한다.
  - 보낸 본문에 비밀값 원문이 없다(해시만 있다).
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/server` / Expected: FAIL
- [ ] **Step 3: 구현** — 순수 파일(`api-client.ts`, `register-install.ts`)은 `react-native`와 `expo-*`를 import하지 않는다.
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(native): add the server client and install registration`

---

### Task 2: 푸시 값과 잠금화면 모델

**Files:**
- Create: `apps/native/lib/commute/content-state.ts`, `lib/commute/lock-screen-model.ts`, `lib/commute/__fixtures__/lock-screen-cases.json`
- Modify: `apps/native/lib/i18n/messages-ko.ts`(`commute.lock.*`)
- Test: `apps/native/lib/commute/content-state.test.ts`, `lock-screen-model.test.ts`

**Interfaces:**
- Produces:
  - `content-state.ts`
    - `interface ContentState`: 스펙 "푸시 값 v1"과 같은 필드.
    - `parseContentState(input: unknown): ContentState | null`. `v`가 1이 아니거나 필수 필드의 타입이 다르면 null. 모르는 필드는 무시한다(서버가 필드를 더해도 옛 앱이 동작하게).
    - `shouldApply(last: { ended: boolean; seq: number } | null, next: ContentState): boolean`. `last`가 없으면 true. `last.ended`면 false. `next.seq <= last.seq`면 false.
  - `lock-screen-model.ts`
    - `interface LockScreenModel { actions: ("boarded" | "next" | "end")[]; detail: string; header: string; lineName: string; minutes: string | null; mode: "bus" | "subway"; progress: { current: number; nodes: number }; status: string; suggestion: string | null; tag: "live" | "estimated" | "delayed"; tagLabel: string }`
    - `lockScreenModel(state: ContentState, deps: { header: string | null; now: number; platform: "ios" | "android"; t: (key: MessageKey, params?: MessageParams) => string; timezone: string }): LockScreenModel`
    - `progress.nodes`는 `2 + legCount * 2`(집, 구간마다 승차·하차, 목적지). `current`는 `walk`면 `legIndex * 2`, `wait`면 `legIndex * 2 + 1`, `ride`면 `legIndex * 2 + 1`과 `+2` 사이를 뜻하는 `legIndex * 2 + 1.5`, `arrived`면 `nodes - 1`.
  - `lock-screen-cases.json`: `{ name, now, state, expected: { status, detail, minutes, tag, suggestion, actions } }[]`. 문구 표의 줄마다 사례가 하나 이상 있다. Task 4의 Swift 구현이 같은 파일의 기대값과 맞아야 한다.

- [ ] **Step 1: 실패하는 테스트**
  - `parseContentState`: 2-C의 표본 값 통과. `v: 2`, `stage: "fly"`, `seq`가 문자열 → null. 모르는 필드가 있어도 통과.
  - `shouldApply`: 처음 true, 같은 `seq` false, 더 작은 `seq` false, 더 큰 `seq` true, 끝난 세션은 더 큰 `seq`여도 false.
  - 모델: `lock-screen-cases.json`의 모든 사례에서 `expected`와 같다.
  - **빈 값**: `stopsAway: null`·`wait` → "위치 확인 중", `etaEpoch: null` → 상세가 정류장 이름뿐이고 `minutes`가 null, `suggestion: null` → null. 결과 어디에도 `"null"`, `"undefined"`, `"NaN"`, `"1970"`이 없다.
  - 남은 분: 61초 → "1분", 59초 → "곧", 이미 지난 시각 → "곧".
  - 태그: `estimated` → `tag: "estimated"`, `live`이고 `delayMinutes: 5` → `"delayed"`, 4 → `"live"`. `positionState: "stale"`이면 `etaState`가 `live`여도 `"estimated"`.
  - 버튼: iOS `walk` → `["boarded", "next"]`, iOS `ride` → `[]`, Android `wait` → `["boarded", "next", "end"]`, Android `ride` → `["end"]`.
  - 진행: `legCount: 1`이면 `nodes` 4, 3이면 8. `legIndex: 1`·`wait` → `current` 3.
  - `header`가 null이면 `commute.lock.header.fallback` 값.
  - 기존 검사 테스트(`no-hardcoded-copy.test.ts`)가 통과한다(이 파일들에 한글 문구가 없다).
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/commute` / Expected: FAIL
- [ ] **Step 3: 구현** — 시각 문자열은 `Intl.DateTimeFormat`에 `timezone`을 넘겨 만든다.
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(native): model lock screen content from commute push state`

---

### Task 3: iOS Activity 정의, 토큰 보고, 인증값 전달

**Files:**
- Create(실험 브랜치에서 옮겨 와 고침): `apps/native/targets/commute-activity/{expo-target.config.js,Info.plist,CommuteActivityAttributes.swift,CommuteLiveActivity.swift}`, `apps/native/modules/commute-activity/{expo-module.config.json,index.ts,ios/CommuteActivity.podspec,ios/CommuteActivityModule.swift,ios/CommuteTokenReporter.swift,ios/CommuteCredentials.swift}`, `ios/CommuteActivityAttributes.swift`(심볼릭 링크)
- Create: `apps/native/locales/ko.json`(앱 번들의 `Localizable.strings`가 된다. 시작 푸시의 알림 키 `commute.start.title` "출퇴근 안내를 시작해요", `commute.start.body` "잠금화면에서 도착 정보를 확인하세요")
- Modify: `apps/native/app.config.ts`(`appleTeamId: "5JKMP6D4C5"`, `NSSupportsLiveActivities`, `NSSupportsLiveActivitiesFrequentUpdates`, `@bacons/apple-targets` 플러그인, 앱과 확장의 앱 그룹 `group.com.cmu02.betro`, `locales: { ko: "./locales/ko.json" }`), `apps/native/package.json`(`@bacons/apple-targets` 5.0.0), `apps/native/app/_layout.tsx`(인증값 전달)

**Interfaces:**
- Consumes: `ensureInstallIdentity`(기존), `ensureRegistered`(Task 1), `ContentState`(Task 2)
- Produces:
  - Swift `CommuteActivityAttributes`: `attributes`는 `planId: String`, `sessionId: String`. `ContentState`는 "푸시 값 v1"의 필드를 그대로 `Codable`로 받는다(null일 수 있는 필드는 옵셔널, `passed`와 `suggestion`은 중첩 구조체). 모르는 키가 와도 디코딩이 실패하지 않는다.
  - Swift `CommuteCredentials`: 키체인 일반 암호 항목(`kSecAttrService: "com.cmu02.betro.commute"`, `kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock`)에 `installId`, `secret`, `serverUrl`을 JSON으로 둔다. `static func load() -> CommuteCredentials?`, `static func save(_:)`.
  - JS 모듈 `CommuteActivity`
    - `setCredentials(input: { installId: string; secret: string; serverUrl: string }): Promise<void>`
    - `setPlanHeaders(headers: Record<string, string>): Promise<void>`(앱 그룹 `UserDefaults`에 `planId` → 머리줄. 확장이 읽는다)
    - `areActivitiesEnabled(): boolean`
    - `startLocal(attributes: { planId: string; sessionId: string }, state: ContentState): Promise<string>`(표본 화면 확인용. `__DEV__`에서만 부른다)
    - `endAll(): Promise<void>`
  - `CommuteTokenReporter`: 앱 시작 때(`ExpoAppDelegateSubscriber`) 관찰을 시작한다. push-to-start 토큰은 `PUT <serverUrl>/v1/push-tokens`에 `{ kind: "apns-start", token, env }`, Activity의 토큰은 `{ kind: "apns-activity", token, env, activityId, sessionId }`(`sessionId`는 `activity.attributes.sessionId`)로 보낸다. `env`는 빌드의 `aps-environment`가 `development`면 `"sandbox"`, 아니면 `"production"`이다. 헤더는 Task 1과 같다. 응답이 2xx가 아니거나 오류면 1초, 3초 뒤 두 번 더 보낸다. `beginBackgroundTask`로 전송 시간을 확보한다. 같은 `(kind, activityId, token)`은 한 번만 보낸다. `CommuteCredentials.load()`가 nil이면 보내지 않는다.

- [x] **Step 1: 옮기기** — 실험 브랜치의 파일을 `git show spike/mvp2-live-activity:<경로>`로 꺼내 위 경로에 둔다. 실험용 주소(`betro-spike-apns…`)와 `launch`·`activityNew` 보고는 지운다.
- [x] **Step 2: 구현** — 위 Interfaces대로. `_layout.tsx`는 `ensureInstallIdentity()` → `ensureRegistered()` → `CommuteActivity.setCredentials(...)` 순으로 부른다(iOS에서만).
- [x] **Step 3: 빌드** — Run: `cd apps/native && bunx expo prebuild --clean -p ios && bun run ios -- --device` / Expected: 앱과 확장이 함께 빌드되고 설치된다. 새 번들 ID라 처음에는 Xcode 계정 로그인과 `-allowProvisioningUpdates`가 필요하다(실험 3).
- [x] **Step 4: 기기 확인** — 시작 푸시의 알림 문구가 키 그대로(`commute.start.title`) 보이지 않고 `locales/ko.json`의 문구로 나오는지는 Task 8에서 본다. 여기서는 로컬 서버(`apps/server`의 `bun run dev`, `PUSH_MODE=log`)를 `EXPO_PUBLIC_SERVER_URL`로 두고 앱을 연다. Expected: 서버 로그에 설치 등록과 `apns-start` 토큰 등록이 찍힌다. `startLocal`로 Activity를 만들면 `apns-activity` 토큰이 `sessionId`와 함께 등록된다. 서버를 끄고 `startLocal`을 하면 요청이 세 번(0초, 1초, 3초 간격) 나가고 앱은 멈추지 않는다. Xcode 콘솔에 비밀값과 토큰 전체가 없다.
- [x] **Step 5: 커밋** — `feat(native): add the commute Live Activity target and token reporting`

#### Task 3 기기 확인 기록 (2026-11-10, iPhone 16 Pro)

- **Step 3**: 통과. `xcodebuild -workspace ios/Betro.xcworkspace -scheme Betro -configuration Debug -destination id=<UDID> -allowProvisioningUpdates DEVELOPMENT_TEAM=5JKMP6D4C5 build`로 앱과 확장(`CommuteActivityWidget.appex`)이 함께 빌드되고 `xcrun devicectl device install app`으로 설치됐다. 서명된 권한에 두 타깃 모두 `group.com.cmu02.betro`가 들어 있고, 설치한 앱이 실행된다.
  - 처음 두 번은 서명에서 멈췄다: 앱 그룹이 새로 들어가 기존 프로파일이 맞지 않았고, 명령줄 `xcodebuild`는 Xcode에 계정이 로그인돼 있는데도 `No Accounts`를 냈다(샌드박스 밖에서 돌려도 같았다). Xcode에서 `ios/Betro.xcworkspace`를 열어 두 타깃의 Signing & Capabilities를 한 번 띄우자 Xcode가 앱 그룹이 든 관리형 프로파일을 받아 왔고, 그 뒤 같은 명령이 통과했다. **새 권한을 넣은 뒤 첫 빌드는 Xcode에서 프로젝트를 한 번 열어야 한다.**
  - 아래 Step 4는 그 전에, 생성된 `ios/`의 권한 파일에서 앱 그룹만 빼고 서명한 빌드로 확인했다. 토큰 보고는 앱 그룹을 쓰지 않는다. `setPlanHeaders`(앱 그룹 `UserDefaults`)는 Task 4에서 처음 쓰인다.
- **Step 4**: 통과. 로컬 서버(2-C 브랜치, `wrangler dev --ip 0.0.0.0`, `PUSH_MODE=log`)를 `EXPO_PUBLIC_SERVER_URL`로 두었다.
  - 첫 실행: `POST /v1/installs` 201, `PUT /v1/push-tokens` 204(`apns-start`, `sandbox`). `startLocal` 뒤 `PUT /v1/push-tokens` 204. 로컬 D1 `push_token`에 `apns-start` 1행과 `apns-activity` 1행(`activity_id`와 `session_id`가 `startLocal`에 넘긴 값과 같다).
  - 503만 답하는 서버: 토큰마다 요청 3번, 첫 요청에서 1.02초, 4.12초 뒤(1초, 3초 간격). 앱은 계속 동작했다.
  - 서버를 끈 상태: 콘솔에 `status=0 attempt=1…3`, 토큰마다 3번에서 멈췄고 앱은 멈추지 않았다(`startLocal` 성공, 프로세스 유지).
  - 서버를 다시 켜고 실행: 밀린 `apns-start`와 `apns-activity`가 모두 204로 전달됐다.
  - 기기 콘솔 4회분(70줄): 64자 이상 hex 0건, `Bearer`·`secret`·`Authorization` 0건, 서버 주소 0건. 토큰은 앞 8자만 찍힌다(`[commute] token kind=… token=808c3b3d… status=… attempt=…`).
- **관찰**
  - 중복 방지(`delivered`)는 프로세스 안에서만 유지된다. 앱을 다시 실행하면 `apns-start`와 살아 있는 Activity의 토큰을 한 번씩 다시 보낸다. 서버는 같은 행을 덮어쓴다.
  - 전달에 실패한 토큰은 다음 토큰 이벤트 때 함께 다시 시도된다.
  - Metro(JS) 로그에는 기존 코드(`components/push-notifications.tsx`)가 `__DEV__`에서 FCM 토큰 전체를 찍는다. 일부러 둔 줄이라 그대로 두고, Global Constraints에 예외로 적었다(2026-11-10 사용자 결정).
  - `startLocal`을 부를 화면이 아직 없어(Task 4의 "잠금화면 표본" 줄) 실행 12초 뒤 표본 Activity를 띄우는 임시 코드를 커밋하지 않고 넣어 확인했다. 시험용 Activity는 `endAll`로 지웠다.

---

### Task 4: iOS 잠금화면과 다이내믹 아일랜드 화면 (2026-11-14 다시 씀)

**Files:**
- Create: `apps/native/targets/commute-activity/CommuteCopy.swift`(Foundation만 import), `CommuteViews.swift`, `ko.lproj/Localizable.strings`
- Create: `apps/native/scripts/check-lock-copy-swift.sh`와 `apps/native/scripts/swift-copy-check/main.swift`(맥에서 `swiftc`로 돌리는 대조)
- Create: `apps/native/lib/commute/localizable-strings.test.ts`
- Modify: `targets/commute-activity/CommuteLiveActivity.swift`, `apps/native/app/settings/`(개발 빌드 전용 "잠금화면 표본" 줄)

**Interfaces:**
- Consumes: Swift `CommuteActivityAttributes.ContentState`(`nextLegs` 포함), `lock-screen-model.ts`의 규칙, `lock-screen-cases.json`, 앱 그룹 `UserDefaults`의 `planId` → 머리줄(`setPlanHeaders`, 2-E가 이미 부른다), Figma `LiveActivity`(87:2420, 2026-11-11 모양), `NextLegRow`, `LegBadge · S`, `iOS / 19 Dynamic Island`.
- Produces:
  - `struct CommuteLockModel { detail, header, lineName, mode, status, tag, tagLabel: String; minutes, suggestion, moreLegs: String?; nextLegs: [CommuteLockNextLeg] }`. 필드와 값은 TS `LockScreenModel`과 같다(iOS라 `actions`는 없다).
  - `enum CommuteCopy { static func model(state: ContentState, now: Date, header: String?, timeZone: TimeZone, t: (String, [String: String]) -> String) -> CommuteLockModel }`. `t`는 키(`commute.lock.*`)와 매개변수를 받아 문구를 돌려준다. 확장에서는 `Localizable.strings`를 읽는 함수를, 대조 스크립트에서는 `messages-ko.ts`에서 뽑은 사전을 넘긴다.
  - 카드 레이아웃(Figma 2026-11-11): 머리줄, 지금 구간(배지 + 상태 + 남은 분, 그 아래 상세), 남은 구간 줄 최대 2줄(둘째 줄 끝에 "외 N구간"), 제안이 있으면 남은 구간 줄 자리에 제안 줄. 160pt 이하. 상태 문장은 줄바꿈하지 않고 정류장 이름만 말줄임한다.
  - 다이내믹 아일랜드: Expanded(배지·상태·남은 분·상세), Compact(배지 + 남은 분), Minimal(수단 아이콘).
  - `context.isStale`이면 태그를 "시간표 추정"으로 바꾼다.

- [x] **Step 1: Figma 읽기** — 위 노드의 레이아웃, 색 변수, 글자 크기를 읽는다. 색과 간격은 Figma 변수 값을 Swift 상수로 옮기고(다크·라이트) 임의 값을 쓰지 않는다.
- [x] **Step 2: 실패하는 대조** — `localizable-strings.test.ts`: `ko.lproj/Localizable.strings`의 키와 값이 `messages-ko.ts`의 `commute.lock.*`와 같다(`{name}` 자리표시는 Swift 쪽도 같은 이름으로 둔다). `check-lock-copy-swift.sh`: `CommuteActivityAttributes.swift`(ActivityKit import를 빼고 작은 대역 프로토콜로)와 `CommuteCopy.swift`, `main.swift`를 `swiftc`로 묶어 `lock-screen-cases.json`의 모든 사례를 돌리고, `expected`의 `status`·`detail`·`minutes`·`tag`·`suggestion`·`nextLegs`·`moreLegs`와 글자 그대로 같은지 본다. Run: 둘 다 / Expected: FAIL(파일이 없다)
- [x] **Step 3: 구현** — `CommuteCopy.swift`, `Localizable.strings`, `CommuteViews.swift`, `CommuteLiveActivity.swift`. 위계: 상태 줄이 가장 크고, 상세와 남은 분이 그다음이다.
- [x] **Step 4: 통과 확인** — Run: `bun test apps/native && bash apps/native/scripts/check-lock-copy-swift.sh && cd apps/native && bun run check-types` / Expected: 모든 사례 일치, PASS. 그리고 `xcodebuild … -configuration Debug build`(Task 3 기록의 명령)로 앱과 확장이 빌드된다.
- [x] **Step 5: 커밋** — `feat(native): render the commute Live Activity and Dynamic Island`
- 화면 대조(사례마다 `startLocal` → 잠금화면 캡처, 다이내믹 아일랜드 세 형태, 160pt)는 Task 8의 기기 확인에서 한 번에 한다.

---

#### Task 4 결과 (2026-11-14)

- 서브에이전트가 별도 워크트리에서 만들고 이 브랜치로 가져왔다(`d2f85a3`부터 4개 커밋, 가져온 뒤 해시는 바뀜). 화면은 아직 기기에서 보지 않았다(Task 8).
- **대조**: `scripts/check-lock-copy-swift.sh`가 `lock-screen-cases.json` **33/33** 사례에서 Swift 문구가 TS 기대값과 글자 그대로 같다. `localizable-strings.test.ts`가 `Localizable.strings`와 `messages-ko.ts`의 `commute.lock.*`를 맞춘다. 시뮬레이터용 `xcodebuild`(서명 없음) BUILD SUCCEEDED.
- **Figma에서 읽은 값**: `LiveActivity` 87:2420(변형 123:2419~123:3085, 제안 123:2861), `NextLegRow` 114:1599, `LegBadge · S` 114:1598, `iOS / 19 Dynamic Island` 49:18907. 색은 Figma 변수(다크·라이트)를 Swift 상수로, 글자 크기는 고정(큰 글자 설정이 160pt를 넘기지 않게).
- **표본 화면**: 설정의 "잠금화면 표본"은 빌드 환경값 `EXPO_PUBLIC_LOCK_SAMPLES=1`일 때만 보이고 열린다(`.env.schema`). iOS는 `startLocal`, Android는 진행 중 알림으로 띄운다. 표본은 머리줄 없이 "출퇴근"으로 보인다.
- **TS와 다른 점**: `stopsAway`가 소수면 Swift는 디코딩에 실패하고(TS는 내림), 모르는 `stage`는 Swift에서 "도착"으로 보인다(TS는 값 전체를 버림). 서버는 둘 다 보내지 않는다.
- **결정이 필요한 것**
  - "146번이 지나갔어요 · 다음 차 08:12"는 24pt 한 줄에 다 들어가지 않아 끝이 잘린다. Figma 변형은 제목에 "341번이 지나갔어요"만 두고 다음 차 시각을 상세 줄에 둔다. → **2026-11-15 사용자 결정: Figma처럼 나눈다.** 아래 "문구 결정 (2026-11-15)".
  - 버스 배지는 푸시 값에 노선 유형이 없어 늘 간선 색이다. 지하철 배지는 Swift 표(공식 노선 이름 → Figma 짧은 이름·색)로 그린다. 17 화면은 "2호선" 전체 이름을 쓰므로 잠금화면과 모양이 다르다.
  - 다이내믹 아일랜드 Expanded는 시스템 영역(위: 배지·상태, 가운데: 남은 분·상세, 아래: 첫 남은 구간)에 맞췄고 제안과 "외 N구간"은 없다.
- 루트 `biome.json`에 `**/*.xcassets/**/*.svg` 제외를 더했다(Figma 아이콘 SVG를 HTML로 검사해서).

#### 문구 결정 (2026-11-15) **[사용자 결정]**

- **지나간 차**: 상태 줄은 "146번이 지나갔어요"(지하철 "2호선 열차가 지나갔어요")만, 상세 줄은 Figma `1구간 지나감`(123:3023)처럼 "다음 차 08:12 · 강남역"(지하철 "다음 열차", 추정이면 "다음 차 약 08:12"). 정류장 이름만 말줄임된다. 17 화면도 같은 모델이라 함께 바뀐다.
- **기점 문구**: 2-E에서 본 노선 기점의 "위치 확인 중"을 "출발 대기 중"으로 바꾼다. "위치 확인 중"은 묵은 도착판, 도착판 없음, 지하철에서도 쓰이므로 이름만 바꾸지 않고 신호를 따로 둔다.
  - 서울 버스 `getArrInfoByRouteAll`의 차량 칸 `arrmsg`가 "출발대기"면(그 칸의 `vehId`는 0) 목록 다음 차량이 아직 기점에서 떠나지 않은 것이다. `RouteStopArrival`·`StopBoard`에 `awaitingDeparture?: true`를 둔다.
  - 새 도착판에서 탈 차량을 고르지 못했을 때(도착판 범위 밖, 배차간격 추정)만 `LegEstimate.awaitingDeparture`가 된다. 묵은 도착판, 차량을 고른 경우, 다른 출처는 해당하지 않는다.
  - `ContentState.awaitingDeparture?: true`는 walk·wait에서만 실린다(키가 없으면 false, `v`는 1 그대로, 배포된 옛 앱과 확장은 모르는 키를 무시한다). 값이 바뀌면 우선순위 5로 보낸다.
  - 기기는 walk·wait에서 `stopsAway`가 없고 `awaitingDeparture`이며 `positionState: live`일 때 "출발 대기 중"을 쓴다. 우선순위: 지나갔어요 > 나가기 전 > 정거장 수 > 출발 대기 중 > 위치 확인 중.
  - **서버를 배포해야 보인다.** 배포는 사용자 확인 뒤에 한다. 기기 확인은 Task 8에서 기점 경로로 본다.
- 대조 사례는 38개(Swift 38/38 일치).

#### 브랜치 리뷰 (2026-11-15, `/code-review`)

고친 것(테스트를 먼저 실패시키고 고침):
- Android "종료"와 17의 "안내 종료"가 404·409(이미 없거나 끝난 세션)에도 알림을 지운다(`endSession` 재사용). 전에는 204만 지워서 끝 푸시를 놓친 세션의 알림이 지워지지 않았다.
- `event: end` 메시지는 값을 읽기 전에 알림을 지운다(값이 깨져도 남지 않음).
- 앱이 서버에서 지난 세션 없이 답을 받으면 그 세션의 알림을 지운다(`endedSessionId`).
- FCM 토큰은 서버가 받을 때까지 앱이 앞으로 올 때와 연결이 돌아올 때 다시 보낸다(`createFcmTokenSender`).
- 표본 알림의 세션 ID가 같은 초에 겹치지 않게 했고, 확장의 문구 번들을 한 번만 찾는다.

남긴 것(사용자 판단 또는 작은 영향):
- ~~남은 분이 푸시 사이에 줄지 않는다.~~ 2026-11-16 사용자 결정으로 고침(아래 "남은 시간 타이머").
- `start`보다 `update`가 먼저 오면 `start`가 버려져 ack가 빠진다(서버 기록의 `shownAt`만 비음).
- 기기 시계가 10분 넘게 빠르면 모든 메시지를 오래된 것으로 버린다.
- Android 표본 표시가 `handleCommuteMessage`의 알림 만들기와 겹친다.

#### 남은 시간 타이머 (2026-11-16, 사용자 결정)

잠금화면의 남은 분은 푸시 사이에도 시스템 타이머가 거꾸로 센다. 글자는 "12분"에서 "11:42"(분:초)로 바뀐다. 앱 화면(15 상단 띠, 17)은 "N분" 그대로다.
- 모델(TS `LockScreenModel.countdownEpoch`, Swift `CommuteLockModel.countdownEpoch`)이 끝 시각(탈 차량 도착 예정, epoch 초)을 준다. `minutes`가 "N분"일 때만 있고, "곧"(60초 미만)이나 시각 없음, 도착·끝 단계에서는 null이다. 대조 사례 38개의 `expected.countdownEpoch`로 두 구현을 맞춘다.
- iOS: 카드의 남은 시간과 아일랜드 Compact 오른쪽이 `Text(timerInterval:countsDown:showsHours: false)`다. 1시간 넘게 남으면 "75:00"처럼 분으로 센다. 0:00에서 멈춘다. 타이머 글자가 폭을 다 차지하지 않게 보이지 않는 "00:00"(100분 이상이면 "000:00")으로 폭을 정한다. 끝 시각이 이미 지났으면 받은 글자를 쓴다(범위가 거꾸로면 확장이 죽는다).
- Android: 끝 시각이 있으면 `setWhen`(밀리초) + `setShowWhen(true)` + `setUsesChronometer(true)` + `setChronometerCountDown(true)`. 본문 끝의 " · N분"은 빼고(멈춘 글자가 타이머 옆에 남지 않게), API 36 이상에서는 칩 글자(`shortCriticalText`)를 넣지 않는다. 칩은 `when`이 양수인 동안 타이머를 센다(developer.android.com "Live updates" → "When time"). "곧"과 노선 이름은 전처럼 칩 글자다.
- 기기에서 아직 보지 않았다(Task 8 Step 3). 특히 Android 알림 머리의 chronometer는 0을 지나면 음수("-0:05")로 센다. 서버가 110초 안에 다시 보내므로 길지 않지만 기기에서 본다.

### Task 5: iOS 잠금화면 버튼 — 하지 않음 (2026-11-11 변경)

2026-11-11 사용자 결정으로 버튼이 없다. App Intents와 `CommuteInputSender`를 만들지 않는다.

---

### Task 6: Android 진행 중 알림 모듈 (2026-11-14 다시 씀)

**Files:**
- Create(실험 브랜치 `spike/mvp2-android-update`에서 `git show`로 꺼내 고침. 실험 브랜치는 병합하지도 push하지도 않는다): `apps/native/modules/commute-notification/{expo-module.config.json,index.ts,android/build.gradle,android/src/main/AndroidManifest.xml,android/src/main/java/expo/modules/commutenotification/CommuteNotificationModule.kt,CommuteNotifier.kt,CommuteActionReceiver.kt,CommuteActionTaskService.kt}`
- Create: `apps/native/lib/commute/notification-content.ts`, `notification-content.test.ts`
- Modify: `apps/native/app.config.ts`(`android.permissions`에 `android.permission.POST_PROMOTED_NOTIFICATIONS`)

**Interfaces:**
- Consumes: `LockScreenModel`(Task 2/2A), Figma `LiveUpdate`(87:19468, "종료"만)
- Produces:
  - `notificationContent(model: LockScreenModel): { title: string; body: string; lines: string[]; chipText: string }`(순수 함수). 제목은 `{lineName} · {status}`, 본문은 상세(남은 분이 있으면 `· {minutes}`), `lines`는 남은 구간 줄(`{lineName} {text}`, 최대 2줄, 둘째 줄 끝에 `moreLegs`)이나 제안 줄, `chipText`는 `{lineName} · {minutes}`(남은 분이 없으면 노선만).
  - JS 모듈 `CommuteNotification`
    - `interface ShowInput { channelName: string; content: { title; body; lines; chipText }; endLabel: string; legCount: number; legIndex: number; seq: number; sessionId: string }`
    - `show(input: ShowInput): boolean`. 그 세션에서 이미 그린 `seq`보다 크면 알림 ID 4101로 만들거나 덮어쓰고 true, 아니면 false. 마지막 `seq`와 끝난 세션 ID는 앱 전용 `SharedPreferences`.
    - `end(sessionId: string): void`. 알림을 지우고 끝난 세션으로 적는다. 그 뒤 같은 세션의 `show`는 false.
  - 채널 `commute-live`(`IMPORTANCE_HIGH`), `setOngoing(true)`, `setOnlyAlertOnce(true)`. 본문을 누르면 `betro://commute`.
  - API 36 이상: 승격(promoted ongoing)이 유지되는 스타일로 그린다. extras `android.requestPromotedOngoing = true`, `android.shortCriticalText = chipText`(리플렉션 없음). `lines`를 넣을 수 있는지는 Step 1에서 정한다. 그 아래: `NotificationCompat` 진행 중 알림 + `BigTextStyle`(제목·본문·`lines`).
  - 버튼은 "종료" 하나: `PendingIntent`(브로드캐스트) → `CommuteActionReceiver` → `CommuteActionTaskService`(`HeadlessJsTaskService`, 태스크 이름 `CommuteAction`, 데이터 `{ sessionId, kind: "end" }`, 타임아웃 15초). 앱 화면은 열리지 않는다.

- [x] **Step 1: 승격 조건 확인** — Android 공식 문서(Live Updates, `ProgressStyle`, promoted ongoing 조건)에서 `BigTextStyle`/`ProgressStyle` 중 승격이 유지되고 여러 줄을 보일 수 있는 것을 고른다. 결과와 근거를 이 문서에 적는다. `ProgressStyle`이면 점(segment) 수는 `legCount`, 진행은 `legIndex`. 남은 구간 줄을 못 넣으면 Android는 지금 구간만 보이고 그 사실을 적는다.
- [x] **Step 2: 실패하는 테스트** — `notification-content.test.ts`: 사례 파일의 `android` 모델로 제목·본문·`lines`·`chipText`. 남은 분 없음 → 본문에 "·"가 남지 않음, `chipText`가 노선만. 남은 구간 3개 → `lines` 2줄이고 둘째 줄 끝에 "외 1구간". 제안 있음 → `lines`가 제안 줄. Run: `bun test apps/native/lib/commute` / Expected: FAIL
- [x] **Step 3: 구현** — 위 Interfaces대로. `CommuteSpike` 로그와 `log` 함수는 지운다.
- [x] **Step 4: 통과와 빌드** — Run: `bun test apps/native && cd apps/native && bun run check-types`, 그리고 `bunx expo prebuild -p android` 뒤 `cd android && ./gradlew :app:assembleRelease`(2-E S20 기록과 같은 방식). Expected: PASS, APK가 만들어진다.
- [x] **Step 5: 커밋** — `feat(native): add the commute ongoing notification module for Android`
- 화면 대조(S20, 에뮬레이터 API 36.1·36.0, `seq` 거꾸로)는 Task 8에서 한 번에 한다. Release APK에서도 표본을 띄울 수 있게, "잠금화면 표본" 줄은 `__DEV__`가 아니라 빌드 시 환경값 `EXPO_PUBLIC_LOCK_SAMPLES=1`일 때만 보인다(운영 빌드에서는 없다).

#### Task 6 결과 (2026-11-14)

- **승격 조건**(developer.android.com "Live Updates"): Standard, `BigTextStyle`, `CallStyle`, `ProgressStyle`, `MetricStyle` 중 하나, `POST_PROMOTED_NOTIFICATIONS` 선언, 승격 요청, ongoing, `contentTitle` 있음, `RemoteViews` 없음, 그룹 요약 아님, `setColorized(true)` 아님, 채널이 `IMPORTANCE_MIN` 아님. 그래서 **`BigTextStyle`로 남은 구간 줄을 넣어도 승격이 유지된다.** 진행 점(`ProgressStyle`)은 쓰지 않는다(2026-11-11 결정으로 진행 표시가 없다).
- **Ruling: 상태바 칩은 남은 분만**(`3분`, `곧`), 남은 분이 없으면 노선 이름. 칩은 최대 96dp이고 7글자 미만일 때만 다 보인다. 계획의 `{노선} · {분}`(예: `2호선 · 12분`, 9글자)은 잘린다. 노선은 알림 제목에 있다. 틀렸을 때 비용: `notification-content.ts` 한 줄.
- **Ruling: 권한은 `app.config.ts`가 아니라 모듈의 `AndroidManifest.xml`에 둔다.** Expo의 `android.permissions`를 처음 적으면 기본 권한 목록이 바뀔 수 있어서다. 모듈 매니페스트는 앱 매니페스트에 합쳐진다. 틀렸을 때 비용: 권한 한 줄 옮기기.
- 머리줄은 `setSubText`, 본문을 누르면 `Betro://commute`(앱 스킴이 대문자다. Android 인텐트 필터의 스킴 비교는 대소문자를 가린다).
- 채널 이름은 `commute.notification.channel` "출퇴근 안내".
- 빌드(2026-11-14): `bun test` 1335 pass / 7 skip / 0 fail, `check-types` 통과, `assembleRelease` 성공(7분, R8 켜짐). 합쳐진 매니페스트에 `POST_PROMOTED_NOTIFICATIONS`, `CommuteActionReceiver`, `CommuteActionTaskService`가 들어 있다. R8 뒤 모듈의 `Record` 필드가 살아 있는지는 Task 8에서 본다.

---

### Task 7: Android 메시지 처리, "종료" 입력, 토큰 등록 (2026-11-14 다시 씀)

**Files:**
- Create: `apps/native/lib/commute/handle-commute-message.ts`, `lib/commute/handle-commute-action.ts`, `lib/commute/app-commute.ts`(expo·모듈 의존 부분)
- Modify: `apps/native/lib/push/background.ts`, `lib/push/push-messaging.ts`(포그라운드 수신도 같은 처리기로), `apps/native/index.ts`(헤드리스 태스크 `CommuteAction` 등록), `app/_layout.tsx`(FCM 토큰 등록과 갱신)
- Test: `apps/native/lib/commute/handle-commute-message.test.ts`, `handle-commute-action.test.ts`

**Interfaces:**
- Consumes: `parseContentState`, `shouldApply`, `lockScreenModel`(Task 2/2A), `notificationContent`·`CommuteNotification`(Task 6), `ServerClient`
- Produces:
  - `handleCommuteMessage(data: Record<string, string>, deps: { client: ServerClient; header: (planId: string) => Promise<string | null>; notifier: { end(sessionId: string): void; show(input: ShowInput): boolean }; now: number; t; timezone: string }): Promise<"shown" | "ended" | "stale" | "ignored">`
    - `data.type`이 `"commute"`가 아니거나 `state`가 파싱되지 않으면 `"ignored"`.
    - `event: "end"`거나 `stage: "ended"`면 `notifier.end` → `"ended"`.
    - `state.sentAt`이 10분보다 오래됐으면 그리지 않고 `"stale"`.
    - 그 밖에는 모델(`platform: "android"`)과 `notificationContent`를 만들어 `notifier.show`. false면 `"stale"`.
    - `event: "start"`로 처음 그렸으면 `POST /v1/commute/sessions/<id>/ack` `{ shownAt }`을 보낸다. `shownAt`은 **ms**(서버 `routes.ts`의 `z.number().int()`, 2-C 기록). 실패해도 던지지 않는다.
    - 머리줄은 2-E가 저장한 `planId`별 머리줄(`app-places.ts`)을 읽는다.
  - `handleCommuteAction(input: { kind: "end"; sessionId: string }, deps: { client: ServerClient; notifier }): Promise<boolean>`. `POST …/input` `{ kind: "end" }`. 204면 `notifier.end`. 실패하면 알림을 그대로 둔다.
  - `registerFcmToken(client: ServerClient, token: string): Promise<boolean>`(`PUT /v1/push-tokens` `{ kind: "fcm", token, env: "production" }`). 앱 시작과 토큰 갱신 이벤트에서 부른다(Android에서만). 이미 있으면 그것을 쓴다.

- [x] **Step 1: 실패하는 테스트**
  - 메시지: `start` → `"shown"`이고 `ack`가 한 번(본문 `shownAt`이 ms). `update` → `"shown"`이고 `ack`가 없다. `end` → `"ended"`.
  - **옛 메시지**: `notifier.show`가 false → `"stale"`. `sentAt`이 11분 전 → `notifier.show`를 부르지 않고 `"stale"`.
  - `type: "other"`나 깨진 `state` → `"ignored"`이고 `notifier`를 부르지 않는다.
  - `ack`가 실패해도 `"shown"`.
  - "종료": 204 → true이고 `notifier.end`. 서버 오류나 네트워크 오류 → false이고 `notifier`를 부르지 않는다.
  - 토큰 등록: 본문의 `kind`가 `"fcm"`.
- [x] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/commute` / Expected: FAIL
- [x] **Step 3: 구현** — 순수 파일은 `react-native`, `expo-*`, 모듈을 import하지 않는다. 헤드리스 태스크는 앱 진입 파일에서 `AppRegistry.registerHeadlessTask("CommuteAction", …)`.
- [x] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [x] **Step 5: 커밋** — `feat(native): handle commute pushes and the end action on Android`
- 기기 확인(앱 프로세스 없는 S20에서 뜨고 갱신, "종료", 강제 종료 뒤 늦은 메시지)은 Task 8에서 한다.

---

### Task 8: 실기기 확인 한 번에 (2026-11-14 다시 씀)

선행: 2-C가 `PUSH_MODE=send`로 배포돼 있다(되어 있음). 경로 등록은 2-E 화면으로 한다. 두 기기에 이 브랜치의 빌드를 설치하고 `EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com`으로 연다. 기기 확인은 이 Task 하나로 모은다(2026-11-14 사용자 피드백: 기기 확인 때문에 개발이 늦어진다).

- [ ] **Step 1: 표본 대조**
  - iOS: "잠금화면 표본"으로 사례를 하나씩 `startLocal` → `xcrun devicectl device capture screenshot`. 문구가 사례의 `expected`와 같고, 빈 값 사례에 빈 칸이나 "nil"이 없으며, 남은 구간 3개 사례가 160pt 안에서 잘리지 않는다. 다이내믹 아일랜드 세 형태가 Figma와 같다.
  - Android: S20(Android 13)에서 사례마다 제목·본문·"종료"가 같고 알림은 하나(ID 4101), 갱신 때 소리가 다시 울리지 않는다. 에뮬레이터 API 36.1에서 상태바 칩과 잠금화면 카드, 36.0에서는 오류 없이 일반 알림. `seq`를 거꾸로 넣으면 바뀌지 않는다.
#### Step 1 기록: iPhone 16 Pro 표본 (2026-11-16)

이 브랜치 Debug 빌드(`d864b6b` 전후), Metro `EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com EXPO_PUBLIC_LOCK_SAMPLES=1`, iPhone 미러링으로 표본을 누르고 `xcrun devicectl device capture screenshot`으로 잠금화면을 찍었다.
- 통과(16개): 지나간 버스·열차와 "약" 변형, 나가기 전, 곧 도착, 위치 확인 중, 하차까지, 이번에 내려요, 이동 중, 회사앞 도착, 지연 태그, 제안 줄, 남은 구간 3개("외 1구간", 카드 약 158pt), 출발 대기 중, 61초. 문구와 태그 색이 사례의 `expected`와 같다(시각은 지금으로 옮겨짐).
- 남은 시간 타이머: 카드에서 "11:59"처럼 초까지 줄고, 화면이 어두워지면 "11:--"로 보인다(iOS가 초를 숨김). macOS 메뉴 막대의 iPhone Live Activity(Compact 모양)에서 "9:46 → 9:37"로 줄고 0:00에서 멈췄다. 도착 사례는 배지만 보인다.
- 고친 것(`d864b6b`): 한 자리 분("9:41") 뒤에 한 자리 빈칸이 생겨 자리 글자를 남은 분의 자릿수에 맞췄다. iOS 표본이 앞의 Activity 아래에 쌓여 맨 위 카드가 바뀌지 않아, 표본을 띄우기 전에 앞의 것을 끝낸다.
- 처음 표본을 띄울 때 잠금화면에 시스템 질문 "Betro의 실시간 현황을 계속 허용하겠습니까?"가 카드 아래에 나왔다(사용자가 고를 일).
- 작은 발견: 설정 화면을 끝까지 내려도 "개발" 칸의 마지막 줄("잠금화면 표본")이 떠 있는 탭 바에 반쯤 가린다(개발 빌드에서만 보이는 줄).
- 다이내믹 아일랜드 Compact(2026-11-16, 미러링 끄고): 맥에서 `xcrun devicectl device process launch --payload-url "Betro://settings/lock-samples?show=17" com.cmu02.betro`로 표본을 띄우고 다른 앱(날씨)을 열어 앱을 뒤로 보냈다. 배지 "146"과 "7:54"가 넘치지 않는다(`1ad84fe`에서 링크를 더함).
- 남은 것: Expanded(아일랜드를 길게 눌러야 해서 손이 필요), Minimal(다른 앱의 Live Activity가 함께 있어야 보인다. 같은 앱의 Activity 둘은 하나만 보인다). 제안 줄의 분은 푸시 때만 바뀐다(타이머 대상 아님).

#### Step 1 기록: Android 에뮬레이터 API 36.1 (2026-11-16)

이 브랜치 `assembleRelease`(R8, `EXPO_PUBLIC_LOCK_SAMPLES=1`, 운영 서버)를 새 AVD `Betro_Check_36_1`(PIN 없음)에 깔고 `adb shell am start -d 'Betro://settings/lock-samples?show=N'`과 `adb exec-out screencap`으로 봤다. 기존 `Betro_API_36_1`은 예전에 건 화면 잠금 PIN 때문에 사용자 저장소가 잠겨(`RUNNING_LOCKED`) 앱이 열리지 않아 손대지 않았다.
- 알림이 승격된다(`flags=…PROMOTED_ONGOING`). extras: `showChronometer`·`chronometerCountDown` true, `showWhen` true, `shortCriticalText` 없음, 본문에 남은 분 없음.
- 상태바 칩이 타이머를 센다("06:43" → 5초 뒤 "06:36"). "곧" 사례는 칩 글자 "곧", 본문 끝 " · 곧".
- 잠금화면 카드: 머리줄 "Betro • 출퇴근 • 07:32"(타이머), 제목 "146 · 2정거장 전", 본문, 남은 구간 두 줄(둘째 끝 "외 1구간"), "종료".
- 잠금화면에서 "종료": 앱이 열리지 않고 알림이 사라진다(표본 세션은 서버가 404, 리뷰 수정대로 지운다).
- 0을 지나면 칩은 아이콘만 남고, 카드 머리의 타이머는 "−00:39"처럼 음수로 센다. 서버가 다음 값을 보낼 때(최대 약 2분)까지만이다. 남김(고치려면 기기에서 도착 시각에 알림을 다시 그리는 예약이 필요하다).
- 고친 것(`267bca1`): 작은 아이콘이 앱 아이콘이라 칩과 알림에서 검은 동그라미로 보였다. 수단에 맞춰 버스·열차 그림(iOS Minimal과 같은 SVG를 벡터 드로어블로)으로 바꿨고, 칩에서 버스·열차 그림을 확인했다.
- iOS와 다른 점: Android 타이머는 "07:52"처럼 분에 0을 붙인다(시스템 형식).
- API 36.0(새 AVD `Betro_Check_36_0`): 승격되지 않고(`flags=ONGOING_EVENT|ONLY_ALERT_ONCE`) 일반 진행 중 알림으로 보인다. 버스 아이콘, 머리 타이머 "07:50", 오류·크래시 없음.

#### Step 2 기록: 실제 세션, 에뮬레이터 API 36.0 (2026-11-16)

에뮬레이터에서 2-E 화면을 `adb shell input`과 `uiautomator dump`로 눌러 "회사"를 등록했다: 6411 정랑고개.양천벤처타운(기점) → 은정초등학교, 평일 21:29 출발. 운영 서버(`5fd71539`), FCM.
- 21:19 예약대로 시작해 21:20에 알림이 떠 있었다. 머리줄 "Betro • 출근 · 회사까지 • 18:58"(타이머), "6411 · 21:29에 나가세요", "정랑고개.양천벤처타운 · 21:40 탑승", "종료".
- 21:30 갱신에서 "6411 · 출발 대기 중", "정랑고개.양천벤처타운 · 약 21:40 도착"으로 바뀌었다. 운영에서 노선 기점 문구가 나온다(2-E에서 본 "위치 확인 중" 해결).
- 나가는 시각(21:29)이 지난 뒤 약 1분은 "21:29에 나가세요"가 남았다. 문구는 받은 때 한 번 그려서 다음 푸시까지 그대로다.
- **발견: 기점의 도착 시각이 1분마다 같이 밀렸다.** 21:30~21:45 내내 "약 21:40 → 21:41 → … → 21:51 도착"(늘 지금 + 약 6분). 차량이 도착판에 없으면 `halfHeadwayAfter(readyAt)`이고 `readyAt`이 지금 + 도보라서다. 고침(`c55dae5`): "출발 대기 중"일 때는 상세에 정류장 이름만 두고 남은 시간·타이머를 보이지 않는다(나가기 전의 고정된 탑승 시각은 그대로). TS·Swift 대조 39/39(사례 하나 추가). 서버는 그동안 1분마다 우선순위 5로 보낸다(도착 예정 시각도 함께 밀려 값이 바뀜). 남김.
- 고친 APK를 덮어 깔자 알림이 지워졌고, 다음 푸시(약 1분 뒤)가 앱을 백그라운드로 깨워 "6411 · 출발 대기 중" / "정랑고개.양천벤처타운"(시각 없음)으로 다시 그렸다.
- 알림의 "종료" → 알림이 사라지고 D1 세션이 `ended`/`user`(시작 21:19:00, 끝 21:53:16).
- 시험 장소는 앱에서 지웠다. 운영 `commute_plan` 0.

#### Step 2 기록: 실제 세션, iPhone 16 Pro (2026-11-16)

이 브랜치 Debug 빌드(`c55dae5` 포함), iPhone 미러링으로 2-E 화면에서 같은 경로를 등록했다(평일 22:28 출발). 운영 서버, APNs 시작 푸시.
- 22:18:00에 시작(D1). 미러링 화면에 다이내믹 아일랜드가 보여서 Compact("6411 · 20:21", 줄어듦)와 Expanded(아일랜드를 길게 누름: "6411 22:28에 나가세요" / "19:52 정랑고개.양천벤처타운 · 22:39 탑승")를 봤다. 넘치거나 잘리지 않는다. 맥 메뉴 막대에도 같은 Compact가 뜬다.
- 22:30 갱신은 "위치 확인 중 · 약 22:39 도착", 태그 "시간표 추정"이었다(21:30 에뮬레이터 때는 "출발 대기 중"). 서버는 서울 버스 응답이 "출발대기"일 때만 표시를 보내므로, 늦은 밤에는 다른 메시지였던 것으로 본다. 확인하려던 로컬 API 키는 401이라 원본은 보지 못했다.
- 아일랜드를 누르면 17이 아니라 출퇴근 탭(15)이 열렸다(2026-11-12 2-E 확인 때는 이미 17에 있던 상태). 원인: iOS에 `widgetURL`이 없고 Android 알림은 `Betro://commute`(탭)만 열었다. 고침(`3f03ff1`): 둘 다 `Betro://commute?plan=<planId>`를 열고 출퇴근 탭이 그 장소의 17을 한 번 연다(`guideLink`, `placeIdForPlan`). iPhone에서 `devicectl … --payload-url "Betro://commute?plan=<D1 plan id>"` → 17 "회사 가는 길", 뒤로 → 탭(다시 열리지 않음). 설정 화면에 있던 앱에서 표본 아일랜드를 누르면 출퇴근 탭으로 온다(표본은 plan이 없어 탭에 머묾). Android 알림 누르기는 S20에서 볼 일. 15 상단 띠 "출근 · 회사까지 안내 중 · 시간표 추정 / 위치 확인 중 · 8분" → 17로 들어가 "안내 종료" → Live Activity가 사라지고(메뉴 막대에서도) D1 `ended`/`user`(22:30:59). 17은 "내일 22:28에 나가요 · 22:18부터 잠금화면에 떠요".
- 시험 장소는 지웠다. 운영 `commute_plan` 0.
- 빌드 환경: 이 워크트리의 `ios/`(gitignore)가 11-10 prebuild라 11-11에 더한 `@react-native-community/datetimepicker`가 빠져 시각 고르기에서 "RNDateTimePicker is not registered"가 떴다. `pod install`로 고쳤다(Homebrew CocoaPods 1.16.2가 `objectVersion = 70`을 못 읽어 잠깐 60으로 바꿨다가 되돌림). 코드 문제는 아니다.
- 못 본 것: Minimal(다른 앱 Live Activity가 함께 있어야 한다), 라이트 모드.

#### Step 1·2 기록: Galaxy S20, Android 13 (2026-11-16)

이 브랜치 `assembleRelease`(`3f03ff1` 포함)를 USB로 덮어 깔았다(데이터 유지). 사용자가 잠금을 풀어 둔 동안 adb로 진행.
- 표본(세 구간): 버스 아이콘, 접힌 줄 "146 · 2정거장 전 · 출퇴근 · 07:41"(타이머), "강남역 · 22:55 도착". 펼치면 남은 구간 두 줄("2호선 잠실역 · 약 23:23 승차", "341 잠실역.롯데월드 · 23:39 승차 · 외 1구간")과 "종료".
- 잠긴 상태에서는 앱 화면이 돌지 않아 표본 링크로 알림이 뜨지 않는다(표본 화면의 한계, 실제 세션은 FCM이라 상관없음). 이 기기의 잠금화면은 알림을 아이콘으로만 보이게 설정돼 있어 잠금화면 카드는 보지 못했다.
- 실제 세션: 2-E 화면을 adb로 눌러 "회사"(6411 정랑고개 → 은정초등학교, 평일 23:04) 등록 → 22:54에 "6411 · 23:04에 나가세요", "출근 · 회사까지", "정랑고개.양천벤처타운 · 23:15 탑승". 알림을 누르면 17 "회사 가는 길"이 열린다(`3f03ff1` 확인).
- 나가는 시각 뒤 "6411 · 위치 확인 중", "정랑고개.양천벤처타운 · 약 23:15 도착"(iPhone 22:30과 같다. 늦은 밤에는 "출발대기"가 아닌 것으로 본다). 펼친 알림의 "종료" → 알림이 사라지고 D1 `ended`/`user`(22:54:00 → 23:06:24).
- 시험 장소는 지웠다. 운영 `commute_plan` 0.

#### 안내는 기기마다 하나 (2026-11-16, 사용자 결정)

잠금화면과 아일랜드의 Betro 안내는 늘 하나다.
- iOS(`477c16f`): 앱 시작 때와 새 Activity가 생길 때 `sentAt`이 가장 늦은 것만 남기고 나머지를 바로 끝낸다(`CommuteTokenReporter.endAllButNewest`). 끝 푸시를 놓친 지난 세션 위에 새 시작 푸시가 쌓이지 않는다. Android는 알림 ID 4101 하나를 덮어써서 원래 하나다.
- 서버(`d25b2fa`): 같은 설치에 새 세션이 열리면 앞의 진행 중 세션에 종료를 보내고 `replaced`로 닫는다(예약 시각이 겹치는 경로 둘). `EndReason`에 `replaced`를 더했다(D1 `end_reason`은 text라 마이그레이션 없음).
- 배포: `betro-server` 버전 `5fd71539`(이 브랜치 `d25b2fa`, 아직 push 전), 되돌릴 버전 `e66711cc`. 배포 뒤 `GET /`, `/v1/ref/subway/lines`, `/v1/ref/bus/routes` 200. 이 배포로 "출발 대기 중"(`awaitingDeparture`)도 함께 나간다.

- [ ] **Step 2: 시나리오**(기기마다, 2-E 화면으로 몇 분 뒤 시작하는 경로를 등록)

  | # | 상태 | 기대 |
  |---|---|---|
  | 1 | 앱을 스와이프로 끄고 기기 잠금 | 예약 시각 10분 전 ±1분에 잠금화면에 뜬다. iOS 시작 알림 문구가 키가 아니라 `locales/ko.json` 문구다 |
  | 2 | 뜬 뒤 그대로 둠 | 정거장 수나 분이 바뀔 때마다 갱신되고, 2분 넘게 멈추지 않는다 |
  | 3 | 버스를 그대로 탐 | 그 차량이 승차 정류장을 지난 다음 갱신에서 "하차까지 N정거장" |
  | 4 | 환승 경로 | 둘째 구간 줄의 시각이 첫 구간 하차 예상에 맞춰 바뀌고, 첫 구간을 내린 뒤 둘째 구간이 지금 구간이 된다 |
  | 5 | 하차 정류장 도착 뒤 | 도착 예정 + 마지막 도보 + 10분 안에 사라진다 |
  | 6 | 재부팅 뒤 한 번 잠금 해제, 다시 잠금 | 1번과 같다 |
  | 7 | iOS 저전력 모드, Android 절전 모드 | 1, 2번과 같다 |
  | 8 | ~~세션 도중 비행기 모드 3분 뒤 해제~~ | 하지 않음(2026-11-16 사용자 결정: 비행기 모드 확인은 시간이 많이 들어 뺀다. 옛 값 거르기와 묵은 표시는 단위 테스트로 본다) |
  | 9 | Android "종료"(잠긴 기기) | 앱이 열리지 않고 알림이 사라지며 D1 세션이 `ended/user` |
  | 10 | Android 강제 종료 중 보낸 메시지 | 다시 열어도 10분 넘은 것은 되살리지 않고, 최신 값을 덮지 않는다 |

- [ ] **Step 3: 함께 볼 남은 것** — 노선 기점에서 시작하는 경로(예: 6411 정랑고개)가 "출발 대기 중"으로 보이는지(서버 배포 뒤), ~~PR #18(앱을 앞에 둔 채 연결이 돌아오면 밀린 저장이 올라간다)~~ 하지 않음(2026-11-16, 비행기 모드 확인 제외), iPhone 재설치 뒤 `ALERT_FCM_TOKEN`이 지금 토큰과 같은지(바꾸려면 사용자에게 먼저 묻는다), Android 승차역 검색칸 안내 글자 정렬. 남은 시간 타이머(2026-11-16): iOS 카드와 아일랜드 Compact에서 "11:42"가 줄어들고 폭이 넘치지 않는지, 0:00에서 멈추는지. Android S20 알림 머리의 타이머, 에뮬레이터 API 36.1 상태바 칩이 타이머를 세는지(칩 글자와 함께 두지 않음), 도착 시각이 지난 뒤 음수로 얼마나 보이는지.
- [ ] **Step 4: 서버 기록 대조** — R2 `commute/summaries/…`의 그 세션 요약에서 `startDelayMs`가 ±60초 안, `maxSendGapMs`가 120초 이하. iOS는 `shownAt` 대신 토큰 도착 시각.
- [ ] **Step 5: 결과와 커밋** — 시나리오별 통과 여부와 캡처, 어긋난 점을 이 문서에 적는다. `docs(plan): record the 2-F device run`
