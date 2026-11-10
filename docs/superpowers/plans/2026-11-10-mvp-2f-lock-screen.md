# MVP 2-F: 잠금화면(iOS Live Activity, Android Live Update) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버가 보내는 출퇴근 푸시로 iOS Live Activity·다이내믹 아일랜드와 Android 진행 중 알림을 띄우고 갱신하고 끝내며, 잠금화면의 "탔어요", "다음 차 탈게요" 버튼이 앱을 열지 않고 서버에 입력을 보내게 만든다.

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

- 작업 위치: 워크트리 `.claude/worktrees/mvp2-lock-screen`, 브랜치 `feat/mvp2-lock-screen`(PR #13이 병합된 develop에서 만듦). PR은 develop으로.
- 커밋 메시지와 PR 본문에 AI 서명이나 출처 표기를 넣지 않는다.
- 커밋 전 `bunx ultracite fix`. 각 Task 끝에 `bun test apps/native`와 `cd apps/native && bun run check-types`가 통과해야 한다. Swift·Kotlin을 고친 Task는 `bun run ios -- --device`와 `bun run android`로 실기기 빌드가 되어야 한다.
- **잠금화면과 그 버튼은 앱을 열지 않는다.** 로그인 요구, 팝업, 광고가 끼어들지 않는다(스펙 실패 기준).
- **위계**: 차량 위치("2정거장 전")가 가장 먼저 읽히고, 도착 시각과 남은 분은 그다음이다. 도착 시각의 확신이 낮아도 위치는 계속 보여 준다(4.3).
- **단정하지 않는다.** 사용자 입력이 없는 동안에는 차량에 대한 사실("지나갔어요")과 조건문("08:10에 나가면")만 쓴다. "놓쳤어요", "늦었어요"는 쓰지 않는다.
- **오래된 값을 그리지 않는다.** 이미 그린 것보다 `seq`가 작거나 같은 값은 버린다. 끝난 세션의 값도 버린다.
- 문구는 코드에 직접 쓰지 않는다. 앱과 Android 알림은 `messages-ko.ts`의 키, iOS 확장은 `Localizable.strings`의 같은 키를 쓴다. Android 알림을 JS가 만들기 때문에 Android 문자열 리소스가 아니라 메시지 묶음을 쓴다(스펙 5.10의 "플랫폼 문자열 리소스"에서 Android만 바꾼 것이다. **[설계 판단]**).
- 서버 주소, 설치 비밀값, 푸시 토큰을 로그에 남기지 않는다(`__DEV__`에서도 토큰은 앞 8자만).
- iOS 최소 버전 17.2. `NSSupportsLiveActivities`와 `NSSupportsLiveActivitiesFrequentUpdates`를 켠다. Android는 `POST_PROMOTED_NOTIFICATIONS` 권한을 선언한다.
- 포그라운드 서비스와 로컬 알림 보조 경로는 만들지 않는다(실험 4, 5 결정).
- 범위 밖: 경로 등록과 출퇴근 안내 화면(2-E), 서버(2-C), 기기 위치로 탑승을 판단하는 기능, Android 16 QPR1 실기기의 상태바 칩 확인(기기가 없다. 에뮬레이터 API 36.1로만 본다).
- 선행: Task 1~3은 바로 할 수 있다. Task 4부터는 2-E의 Figma 수정(18 Live Activity, 19 Dynamic Island, 18 Live Update에 4.3의 위계와 버튼을 반영)이 끝나 있어야 한다. Task 8은 2-C가 배포돼 있어야 한다.

## 잠금화면 문구 표 **[설계 판단]**

`lock-screen-model.ts`와 Swift 구현이 함께 따르는 규칙이다. 키는 `commute.lock.*`이고 값은 한국어다. `{eta}`와 `{leave}`는 기기 시간대의 `HH:mm`, `{n}`은 정거장 수, `{m}`은 분이다.

| 줄 | 조건 | 키 | 문구 |
|---|---|---|---|
| 상태 | `passed`가 있음, `mode: bus` | `status.passedBus` | `{passedLine}번이 지나갔어요 · 다음 차 {eta}` |
| 상태 | `passed`가 있음, `mode: subway` | `status.passedSubway` | `{passedLine} 열차가 지나갔어요 · 다음 열차 {eta}` |
| 상태 | `walk`, 첫 구간, 지금이 `leaveEpoch` 전 | `status.beforeLeave` | `{leave}에 나가면 {line} {eta} 탑승` |
| 상태 | `walk`·`wait`, `stopsAway` ≥ 1 | `status.stopsAway` | `{n}정거장 전` |
| 상태 | `walk`·`wait`, `stopsAway` 0 | `status.arriving` | `곧 도착` |
| 상태 | `walk`·`wait`, `stopsAway` 없음 | `status.unknown` | `위치 확인 중` |
| 상태 | `ride`, `stopsAway` ≥ 1 | `status.ride` | `하차까지 {n}정거장` |
| 상태 | `ride`, `stopsAway` 0 | `status.rideLast` | `이번에 내려요` |
| 상태 | `ride`, `stopsAway` 없음 | `status.rideUnknown` | `이동 중` |
| 상태 | `arrived` | `status.arrived` | `{stop} 도착` |
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
3. **잠긴 기기에서 버튼.** 기기를 켠 뒤 한 번 잠금을 푼 상태에서 잠금화면 버튼을 누른다. 기대: 인증값을 읽어 서버에 보내고, 실패하면 화면을 바꾸지 않는다(서버 응답 전에 "탑승"으로 바꿔 두지 않는다). Task 5·7의 기기 확인으로 고정.
4. **토큰 보고가 빠지는 경우.** 앱이 백그라운드로 깨어난 몇 초 안에 업데이트 토큰을 보내지 못하면 서버가 갱신할 수 없다. 기대: 네이티브 코드가 JS 없이 보내고, 실패하면 1초·3초 뒤 두 번 더 보낸다. 인증값이 아직 없으면(첫 실행 전) 보내지 않는다. Task 3의 기기 확인으로 고정.
5. **구간이 여러 개인 경로.** 진행 표시의 노드 수가 `legCount`에 따라 늘어난다(구간 1개면 4노드, 구간마다 2개씩 늘어난다). 기대: 구간 3개까지 잘리지 않고, `legIndex`에 맞는 노드가 현재 위치로 표시된다. Task 2 테스트와 Task 4·6의 표본 화면으로 고정.

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
- [ ] **Step 3: 빌드** — Run: `cd apps/native && bunx expo prebuild --clean -p ios && bun run ios -- --device` / Expected: 앱과 확장이 함께 빌드되고 설치된다. 새 번들 ID라 처음에는 Xcode 계정 로그인과 `-allowProvisioningUpdates`가 필요하다(실험 3).
- [x] **Step 4: 기기 확인** — 시작 푸시의 알림 문구가 키 그대로(`commute.start.title`) 보이지 않고 `locales/ko.json`의 문구로 나오는지는 Task 8에서 본다. 여기서는 로컬 서버(`apps/server`의 `bun run dev`, `PUSH_MODE=log`)를 `EXPO_PUBLIC_SERVER_URL`로 두고 앱을 연다. Expected: 서버 로그에 설치 등록과 `apns-start` 토큰 등록이 찍힌다. `startLocal`로 Activity를 만들면 `apns-activity` 토큰이 `sessionId`와 함께 등록된다. 서버를 끄고 `startLocal`을 하면 요청이 세 번(0초, 1초, 3초 간격) 나가고 앱은 멈추지 않는다. Xcode 콘솔에 비밀값과 토큰 전체가 없다.
- [x] **Step 5: 커밋** — `feat(native): add the commute Live Activity target and token reporting`

#### Task 3 기기 확인 기록 (2026-11-10, iPhone 16 Pro)

- **Step 3 (부분)**: Debug 빌드가 앱과 확장(`CommuteActivityWidget.appex`)을 함께 만들고 기기에 설치됐다. 다만 Xcode에 Apple 계정이 로그인돼 있지 않아(`No Accounts`) 자동 서명이 앱 그룹(`group.com.cmu02.betro`)이 든 프로파일을 만들지 못했다. 생성된 `ios/`의 권한 파일 두 개에서 앱 그룹만 빼고 기존 프로파일로 서명해 확인했다(저장소 파일은 그대로). **앱 그룹이 든 정식 서명 빌드는 아직 확인하지 못했다.** Xcode 계정 로그인 뒤 `xcodebuild … -allowProvisioningUpdates DEVELOPMENT_TEAM=5JKMP6D4C5`로 다시 빌드해야 한다. `setPlanHeaders`(앱 그룹 `UserDefaults`)는 Task 4에서 처음 쓰인다.
- **Step 4**: 통과. 로컬 서버(2-C 브랜치, `wrangler dev --ip 0.0.0.0`, `PUSH_MODE=log`)를 `EXPO_PUBLIC_SERVER_URL`로 두었다.
  - 첫 실행: `POST /v1/installs` 201, `PUT /v1/push-tokens` 204(`apns-start`, `sandbox`). `startLocal` 뒤 `PUT /v1/push-tokens` 204. 로컬 D1 `push_token`에 `apns-start` 1행과 `apns-activity` 1행(`activity_id`와 `session_id`가 `startLocal`에 넘긴 값과 같다).
  - 503만 답하는 서버: 토큰마다 요청 3번, 첫 요청에서 1.02초, 4.12초 뒤(1초, 3초 간격). 앱은 계속 동작했다.
  - 서버를 끈 상태: 콘솔에 `status=0 attempt=1…3`, 토큰마다 3번에서 멈췄고 앱은 멈추지 않았다(`startLocal` 성공, 프로세스 유지).
  - 서버를 다시 켜고 실행: 밀린 `apns-start`와 `apns-activity`가 모두 204로 전달됐다.
  - 기기 콘솔 4회분(70줄): 64자 이상 hex 0건, `Bearer`·`secret`·`Authorization` 0건, 서버 주소 0건. 토큰은 앞 8자만 찍힌다(`[commute] token kind=… token=808c3b3d… status=… attempt=…`).
- **관찰**
  - 중복 방지(`delivered`)는 프로세스 안에서만 유지된다. 앱을 다시 실행하면 `apns-start`와 살아 있는 Activity의 토큰을 한 번씩 다시 보낸다. 서버는 같은 행을 덮어쓴다.
  - 전달에 실패한 토큰은 다음 토큰 이벤트 때 함께 다시 시도된다.
  - Metro(JS) 로그에는 기존 코드(`components/push-notifications.tsx`)가 `__DEV__`에서 FCM 토큰 전체를 찍는다. Firebase 콘솔 시험 발송용으로 일부러 둔 줄이라 고치지 않았다. Global Constraints의 "토큰은 앞 8자만"과 어긋나므로 어느 쪽을 따를지 정해야 한다.
  - `startLocal`을 부를 화면이 아직 없어(Task 4의 "잠금화면 표본" 줄) 실행 12초 뒤 표본 Activity를 띄우는 임시 코드를 커밋하지 않고 넣어 확인했다. 시험용 Activity는 `endAll`로 지웠다.

---

### Task 4: iOS 잠금화면과 다이내믹 아일랜드 화면

**Files:**
- Create: `apps/native/targets/commute-activity/CommuteCopy.swift`, `CommuteViews.swift`, `ko.lproj/Localizable.strings`
- Modify: `targets/commute-activity/CommuteLiveActivity.swift`, `apps/native/app/settings/`(개발 빌드 전용 "잠금화면 표본" 줄)

**Interfaces:**
- Consumes: Swift `ContentState`(Task 3), `lock-screen-cases.json`(Task 2), Figma `iOS / 18 Live Activity`, `iOS / 19 Dynamic Island`, `Components`의 `LiveActivity`·`CommuteProgress`
- Produces:
  - `CommuteCopy.model(state: ContentState, now: Date, header: String?) -> CommuteLockModel`. 문구 표의 규칙을 그대로 구현하고 문자열은 `Localizable.strings`의 `commute.lock.*`에서 가져온다. `CommuteLockModel`의 필드는 Task 2의 `LockScreenModel`과 같다.
  - 잠금화면 카드, 다이내믹 아일랜드 Expanded·Compact(배지 + 남은 분)·Minimal(수단 아이콘).
  - `context.isStale`이면 태그를 "시간표 추정"으로 바꾼다(서버가 `stale-date`를 보낸다).

- [ ] **Step 1: Figma 읽기** — Figma MCP로 위 프레임의 레이아웃, 색 변수, 글자 크기를 읽는다. 색과 간격은 Figma 변수 값을 Swift 상수로 옮기고(다크·라이트), 임의 값을 쓰지 않는다.
- [ ] **Step 2: 구현** — 위계: 상태 줄이 가장 크고, 상세와 남은 분이 그다음이다. 진행 표시는 `progress.nodes`만큼 노드를 그리고 `current` 위치를 강조한다.
- [ ] **Step 3: 표본으로 대조** — 개발 빌드의 "잠금화면 표본" 줄이 `lock-screen-cases.json`의 사례를 하나씩 `startLocal`로 띄운다. 사례마다 `xcrun devicectl device capture screenshot`으로 잠금화면을 찍는다. Expected: 모든 사례에서 화면의 상태·상세·남은 분·태그·제안 문구가 그 사례의 `expected`와 글자 그대로 같다. 빈 값 사례에서 빈 칸이나 "nil"이 없다. 구간 3개 사례의 진행 표시가 잘리지 않는다. 다이내믹 아일랜드 세 형태가 Figma와 같다.
- [ ] **Step 4: 커밋** — `feat(native): render the commute Live Activity and Dynamic Island`

---

### Task 5: iOS 잠금화면 버튼

**Files:**
- Create: `apps/native/targets/commute-activity/CommuteIntents.swift`(앱 타깃에도 포함되게 모듈 `ios/`에 심볼릭 링크), `apps/native/modules/commute-activity/ios/CommuteInputSender.swift`
- Modify: `CommuteViews.swift`(버튼), `ko.lproj/Localizable.strings`

**Interfaces:**
- Consumes: `CommuteCredentials`(Task 3)
- Produces:
  - `struct CommuteBoardedIntent: LiveActivityIntent`, `struct CommuteNextIntent: LiveActivityIntent`. 매개변수는 `sessionId`. `perform()`은 앱 프로세스에서 돌고 `CommuteInputSender.send(sessionId:kind:)`를 부른다.
  - `CommuteInputSender.send(sessionId: String, kind: String) async -> Bool`. `POST <serverUrl>/v1/commute/sessions/<sessionId>/input` `{ kind }`, 타임아웃 10초. 204면 true.
  - 버튼은 `walk`·`wait` 단계에만 보인다. 화면은 서버의 다음 갱신 푸시로 바뀐다. 누른 직후 미리 바꿔 두지 않는다.

- [ ] **Step 1: 구현**
- [ ] **Step 2: 기기 확인** — 로컬 서버에 시험 세션을 하나 만들고(`curl`로 경로 등록, 2분 뒤 시작) `startLocal`로 그 `sessionId`의 Activity를 띄운다. 기기를 잠근다. Expected: "탔어요"를 누르면 앱이 화면에 뜨지 않고 서버 로그에 `input boarded`가 찍힌다. "다음 차 탈게요"도 같다. 서버를 끄고 누르면 화면이 그대로다. 재부팅 뒤 한 번 잠금을 풀었다 잠근 상태에서도 동작한다.
- [ ] **Step 3: 커밋** — `feat(native): send boarded and next-vehicle input from the lock screen`

---

### Task 6: Android 진행 중 알림 모듈

**Files:**
- Create(실험 브랜치에서 옮겨 와 고침): `apps/native/modules/commute-notification/{expo-module.config.json,index.ts,android/build.gradle,android/src/main/AndroidManifest.xml,android/src/main/java/expo/modules/commutenotification/CommuteNotificationModule.kt,CommuteNotifier.kt,CommuteActionReceiver.kt,CommuteActionTaskService.kt}`
- Modify: `apps/native/app.config.ts`(`android.permissions`에 `android.permission.POST_PROMOTED_NOTIFICATIONS`)

**Interfaces:**
- Consumes: `LockScreenModel`(Task 2), Figma `Android / 18 Live Update`
- Produces:
  - JS 모듈 `CommuteNotification`
    - `interface ShowInput { actionLabels: Record<"boarded" | "next" | "end", string>; channelName: string; chipText: string; model: LockScreenModel; seq: number; sessionId: string }`
    - `show(input: ShowInput): boolean`. 그 세션에서 이미 그린 `seq`보다 크면 알림 ID 4101로 만들거나 덮어쓰고 true, 아니면 아무것도 하지 않고 false. 마지막 `seq`와 끝난 세션 ID는 앱 전용 `SharedPreferences`에 둔다(프로세스가 죽어도 남게).
    - `end(sessionId: string): void`. 알림을 지우고 그 세션을 끝난 것으로 적는다. 그 뒤 같은 세션의 `show`는 false다.
  - 채널 `commute-live`(`IMPORTANCE_HIGH`), `setOngoing(true)`, `setOnlyAlertOnce(true)`. 본문을 누르면 `betro://commute`로 앱을 연다.
  - API 36 이상: `Notification.ProgressStyle`(점은 `progress.nodes`개, 진행은 `current`), extras `android.requestPromotedOngoing = true`, `android.shortCriticalText = chipText`(예: `341 · 3분`). 리플렉션은 쓰지 않는다. 그 아래: `NotificationCompat`의 일반 진행 중 알림.
  - 버튼: `model.actions`마다 `PendingIntent`(브로드캐스트) → `CommuteActionReceiver` → `CommuteActionTaskService`(`HeadlessJsTaskService`, 태스크 이름 `CommuteAction`, 데이터 `{ sessionId, kind }`, 타임아웃 15초). 앱 화면은 열리지 않는다.

- [ ] **Step 1: 옮기기와 구현** — 실험 브랜치의 모듈을 꺼내 위 Interfaces대로 고친다. `CommuteSpike` 로그와 `log` 함수는 지운다.
- [ ] **Step 2: 빌드** — Run: `cd apps/native && bunx expo prebuild --clean -p android && bun run android -- --variant release` / Expected: S20에 설치된다. R8이 켜진 Release에서 알림이 뜬다.
- [ ] **Step 3: 표본으로 대조** — 개발 빌드의 "잠금화면 표본" 줄이 `lock-screen-cases.json`의 사례를 `lockScreenModel(…, platform: "android")`로 바꿔 `show`에 넘긴다. Expected: S20(Android 13)에서 사례마다 제목·본문·버튼이 기대 문구와 같고, 알림은 하나(ID 4101)이며 갱신 때 소리가 다시 울리지 않는다. 에뮬레이터 API 36.1에서 상태바 칩과 잠금화면 카드가 보이고, API 36.0에서는 오류 없이 진행 표시만 보인다. `seq`를 거꾸로 넣으면 화면이 바뀌지 않는다.
- [ ] **Step 4: 커밋** — `feat(native): add the commute ongoing notification module for Android`

---

### Task 7: Android 메시지 처리, 버튼 입력, 토큰 등록

**Files:**
- Create: `apps/native/lib/commute/handle-commute-message.ts`, `lib/commute/handle-commute-action.ts`, `lib/commute/app-commute.ts`(expo·모듈 의존 부분)
- Modify: `apps/native/lib/push/background.ts`, `lib/push/push-messaging.ts`(포그라운드 수신도 같은 처리기로), `apps/native/index.ts`(헤드리스 태스크 `CommuteAction` 등록), `app/_layout.tsx`(FCM 토큰 등록과 갱신)
- Test: `apps/native/lib/commute/handle-commute-message.test.ts`, `handle-commute-action.test.ts`

**Interfaces:**
- Consumes: `parseContentState`, `lockScreenModel`(Task 2), `ServerClient`(Task 1), `CommuteNotification`(Task 6)
- Produces:
  - `handleCommuteMessage(data: Record<string, string>, deps: { client: ServerClient; header: (planId: string) => Promise<string | null>; notifier: { end(sessionId: string): void; show(input: ShowInput): boolean }; now: number; t; timezone: string }): Promise<"shown" | "ended" | "stale" | "ignored">`
    - `data.type`이 `"commute"`가 아니거나 `state`가 파싱되지 않으면 `"ignored"`.
    - `event: "end"`거나 `stage: "ended"`면 `notifier.end` → `"ended"`.
    - `state.sentAt`이 10분보다 오래됐으면 그리지 않고 `"stale"`(강제 종료 뒤 늦게 온 메시지).
    - 그 밖에는 모델을 만들어 `notifier.show`. false면 `"stale"`.
    - `event: "start"`로 처음 그렸으면 `POST /v1/commute/sessions/<id>/ack` `{ shownAt: now }`를 보낸다(실패해도 던지지 않는다).
  - `handleCommuteAction(input: { kind: "boarded" | "next" | "end"; sessionId: string }, deps: { client: ServerClient; notifier }): Promise<boolean>`. `POST …/input`. `kind: "end"`가 204면 `notifier.end`도 부른다. 실패하면 화면을 바꾸지 않는다.
  - `registerFcmToken(client: ServerClient, token: string): Promise<boolean>`(`PUT /v1/push-tokens` `{ kind: "fcm", token, env: "production" }`). 앱 시작과 토큰 갱신 이벤트에서 부른다(Android에서만).

- [ ] **Step 1: 실패하는 테스트**
  - 메시지: `start` → `"shown"`이고 `ack`가 한 번 나간다. `update` → `"shown"`이고 `ack`가 없다. `end` → `"ended"`.
  - **옛 메시지**: `notifier.show`가 false → `"stale"`. `sentAt`이 11분 전 → `notifier.show`를 부르지 않고 `"stale"`. `end` 뒤에 온 같은 세션의 `update`는 `notifier.show`가 false를 주므로 `"stale"`.
  - `type: "other"`나 깨진 `state` → `"ignored"`이고 `notifier`를 부르지 않는다.
  - `ack`가 실패해도 `"shown"`.
  - 버튼: 204 → true. `end`·204 → `notifier.end` 호출. 서버 오류나 네트워크 오류 → false이고 `notifier`를 부르지 않는다.
  - 토큰 등록: 본문의 `kind`가 `"fcm"`.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/commute` / Expected: FAIL
- [ ] **Step 3: 구현** — 순수 파일은 `react-native`, `expo-*`, 모듈을 import하지 않는다. 헤드리스 태스크는 `AppRegistry.registerHeadlessTask("CommuteAction", …)`으로 앱 진입 파일에서 등록한다.
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [ ] **Step 5: 기기 확인** — 로컬 서버에 시험 세션을 만들고, 실험 5의 `spikes/fcm-sender/send.ts`를 고쳐 `type: "commute"` 메시지를 보낸다. Expected: 앱 프로세스가 없는 S20에서 알림이 뜨고 갱신된다. "탔어요"를 누르면 앱이 열리지 않고 서버 로그에 입력이 찍힌다. "종료"를 누르면 알림이 사라진다. 강제 종료 중에 보낸 메시지는 앱을 다시 열어도 알림을 되살리지 않는다(10분 넘은 것) 또는 최신 값을 덮지 않는다(`seq`).
- [ ] **Step 6: 커밋** — `feat(native): handle commute pushes and notification actions on Android`

---

### Task 8: 서버와 이어서 실기기 확인

**Files:**
- Modify: 이 계획 문서("2-F 결과" 절), `apps/native/app/settings/`(임시 "인증값 복사" 줄을 넣었다가 지운다)

선행: 2-C가 `PUSH_MODE=send`로 배포돼 있다. 두 기기에 Release 빌드를 설치하고 `EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com`으로 한 번 연다.

- [ ] **Step 1: 경로 등록** — 2-E가 아직이면 `curl`로 기기의 설치 인증값(개발 빌드 설정 화면에 "인증값 복사" 줄을 임시로 둔다)을 써서 5분 뒤 시작하는 경로를 등록한다(6411 노량진역 → 고속터미널, 대안 150 한 개).
- [ ] **Step 2: 시나리오**(기기마다)

  | # | 상태 | 기대 |
  |---|---|---|
  | 1 | 앱을 스와이프로 끄고 기기 잠금 | 예약 시각 10분 전 ±1분에 잠금화면에 뜬다 |
  | 2 | 뜬 뒤 그대로 둠 | 정거장 수나 분이 바뀔 때마다 갱신되고, 2분 넘게 멈추지 않는다 |
  | 3 | "다음 차 탈게요" | 30초 안에 다음 차량으로 바뀐다 |
  | 4 | "탔어요" | 30초 안에 "하차까지 N정거장"으로 바뀌고 버튼이 사라진다(Android는 "종료"만 남는다) |
  | 5 | 하차 정류장 도착 뒤 | 도착 예정 + 마지막 도보 + 10분 안에 잠금화면에서 사라진다 |
  | 6 | 재부팅 뒤 한 번 잠금 해제, 다시 잠금 | 1번과 같다 |
  | 7 | iOS 저전력 모드, Android 절전 모드 | 1, 2번과 같다 |
  | 8 | 세션 도중 비행기 모드 3분 뒤 해제 | 해제 뒤 다음 갱신에서 최신 값이 보이고 옛 값으로 돌아가지 않는다. 끊긴 동안 iOS는 "시간표 추정" 태그(`stale-date`)가 보인다 |

- [ ] **Step 3: 서버 기록 대조** — R2 `commute/summaries/…`의 그 세션 요약에서 `startDelayMs`가 ±60초 안, `maxSendGapMs`가 120초 이하인지 본다. iOS는 `shownAt` 대신 토큰 도착 시각이 기록된다.
- [ ] **Step 4: 결과와 커밋** — 시나리오별 통과 여부와 캡처, 어긋난 점을 이 문서에 적는다. 임시 "인증값 복사" 줄을 지운다. `docs(plan): record the 2-F device run`
