# MVP 2-A: 출퇴근 기능 사전 실험 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MVP 설계 9장의 실험 6개를 해서, 출퇴근 세로 조각(2-C~2-F)의 설계가 갈리는 질문에 측정값으로 답한다.

**Architecture:** 실험 코드는 모두 버리는 코드입니다. Task마다 작업 브랜치에서 `spike/mvp2-<이름>` 브랜치를 만들어 그 위에서 만들고, 병합하지 않습니다(참고용으로 로컬에 남김). 작업 브랜치에는 결과 문서 `docs/research/2026-11-06-mvp2-experiments.md`만 커밋합니다. 각 실험은 통과 기준을 미리 정해 두고, 결과·측정값·재현 방법·2-C~2-F에 미치는 결정을 같은 형식으로 적습니다. 실험 코드에는 테스트를 쓰지 않습니다. 대신 각 Task의 확인 단계가 기준입니다.

**Tech Stack:** Cloudflare Workers(wrangler, workers.dev 임시 배포), WebCrypto(ES256·RS256 JWT), APNs HTTP/2, FCM HTTP v1, ActivityKit(iOS 17.2+ push-to-start), `@bacons/apple-targets`(위젯 확장, 1순위), Expo 로컬 모듈(Swift·Kotlin), `@react-native-firebase/messaging` 27.1, Android `Notification.ProgressStyle`(API 36), curl `--http2`, bun 스크립트.

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` 9장(실험 표 6행), 3장 "버스 범위", 5.3, 5.5, 5.6, 6장, 7.1

## Global Constraints

- 작업 브랜치는 develop에서 만든 `docs/mvp2-experiments`(워크트리 `.claude/worktrees/mvp2-experiments`)이고, PR은 develop으로 보낸다. 실험 브랜치는 `spike/mvp2-<이름>`이고 push하거나 병합하지 않는다.
- 커밋 메시지에 AI 서명이나 출처 표기를 넣지 않는다.
- **비밀값**
  - `~/Documents/Betro-APNs/`의 파일만 쓴다: `AuthKey_HFSD7YXX9N.p8`, `betro-a77a2-fcm-service-account.json`.
  - API 키는 `/Users/choehyeonjun/Project/Betro/packages/transit-static/.env`의 `SEOUL_OPEN_API_KEY`와 `DATA_GO_KR_API_KEY`를 쓴다.
  - 내용을 화면이나 로그, 결과 문서에 출력하지 않는다. `wrangler secret put`에는 표준입력으로 넣는다. 저장소에 커밋하지 않는다.
- **APNs 값**: 키 ID `HFSD7YXX9N`, 팀 ID `5JKMP6D4C5`, 번들 `com.cmu02.betro`, Live Activity 토픽 `com.cmu02.betro.push-type.liveactivity`. 개발 빌드는 sandbox(`api.sandbox.push.apple.com`)다.
- **FCM**: 프로젝트 `betro-a77a2`.
- **Cloudflare**
  - 임시 Worker 이름은 `betro-spike-<이름>`이고 workers.dev에만 둔다. 실험이 끝나면 `wrangler delete`로 지운다.
  - `betro-server`, DNS, Access 앱은 건드리지 않는다.
- **API 한도**
  - 4단계 수집기가 `dev` 키 한도(오퍼레이션별 하루 1,000건)를 쓰고 있다.
  - 실험은 수집기가 쓰는 오퍼레이션(서울 지하철 `realtimePosition`·`realtimeStationArrival`, 버스 `getBusPosByRtid`)을 직접 부르지 않는다. 그 값이 필요하면 수집기 기록(R2)을 쓴다.
  - 다른 오퍼레이션도 실험마다 호출 수를 세어 결과에 적는다.
- 실기기
  - iPhone 16 Pro(iOS 27.2, UDID `00008140-00145C103CBB001C`)를 쓴다.
  - Android 실기기는 Galaxy S20 Ultra(Android 13, 시리얼 `R3CN20S850J`)다. Android 16 전용 기능(ProgressStyle, promoted 알림)은 에뮬레이터(API 36)로 따로 본다(Task 5).
- 앱 빌드는 로컬(`cd apps/native && bun run ios -- --device`, `bun run android`)로 한다. `eas.json`이 없으므로 EAS 빌드는 이번 범위 밖이다.
- 결과 문서의 각 실험 절은 같은 순서로 쓴다: `질문 / 기준 / 결과(통과·실패·부분) / 측정값 / 재현 방법 / 2-C~2-F에 주는 결정`.

## Review Focus

이 실험들이 놓치기 쉬운 조건입니다. 각 Task의 시나리오 표에 넣어 두었습니다.

- **앱을 스와이프로 종료했거나 재부팅 뒤 아직 한 번도 잠금을 풀지 않은 iPhone**에서 push-to-start가 뜨는지, 그리고 그 뒤 업데이트 토큰이 서버에 오는지. 출퇴근 아침의 흔한 상태다. Task 4 시나리오로 확인한다.
- **푸시 토큰이 바뀌는 경우.** 앱 재설치, push-to-start 토큰 회전, 새 Activity마다 다른 업데이트 토큰이 해당한다. 서버가 옛 토큰으로 보내면 어떻게 되는지(APNs 응답 코드) 확인한다. Task 2와 Task 4로 확인한다.
- **Android 절전.** Doze, 앱 대기 버킷 "rare", 삼성 "절전 앱"에서 높은 우선순위 FCM 데이터 메시지가 30분 동안 2분 넘게 끊기지 않는지 본다. Task 5 시나리오로 확인한다.
- **경기 버스 위치의 해상도.** GBIS가 정류장 단위 위치만 준다면 "몇 정거장 전"은 되지만 지도 보간과 도착 시각 측정이 달라진다. Task 1에서 필드와 갱신 간격으로 확인한다.
- **같은 정류장의 ID가 서울과 경기에서 다른 경우.** 환승 경로 등록과 정확도 측정에서 같은 정류장으로 묶을 수 있어야 한다. Task 1로 확인한다.

## 실행 순서

2-B(문구 키)를 먼저 끝낸다. 외부 승인이 필요 없고 작업량이 작다. 그동안 Task 1 Step 2의 활용신청을 사용자에게 먼저 요청해 승인 대기 시간을 겹친다. 그 뒤 Task 1 → 2 → 3 → 4 → 5 → 7을 하고, Task 6은 4단계(`feat/phase4-realtime-collector`)가 develop에 병합된 뒤에 한다. Task 3이 Task 4의 선행이다. 나머지는 서로 독립이다. Task 1의 활용신청 승인(Step 2)을 기다리는 동안 Task 2부터 진행한다.

2-B(문구 키, `2026-11-06-mvp-2b-message-catalog.md`)와는 파일이 겹치지 않는다. 다만 Task 3·5의 실험 브랜치는 2-B 이전 코드에서 갈라져도 된다(병합하지 않으므로).

---

### Task 1: 경기·인천 버스 데이터 (9장 6행)

**Files:**
- Create: `docs/research/2026-11-06-mvp2-experiments.md` (문서 머리말과 "1. 경기·인천 버스" 절)
- 실험 코드: `spike/mvp2-gyeonggi` 브랜치의 `spikes/gyeonggi/probe.ts` (커밋하지 않아도 됨)

**질문**
1. 서울 버스 API가 경기·인천 면허 노선의 차량 위치를 주는가?
2. 안 주면 경기 GBIS와 인천 버스정보 API로 위치·도착 정보를 받을 수 있는가?
3. 정류장 ID를 서울 정류장과 맞출 수 있는가?
4. 한도와 갱신 간격은 얼마인가?

**기준**
- "전체 범위 가능": 경기(마을 포함)와 인천 모두 차량별 위치(최소 정류장 순번)를 30초 이하 간격으로 받을 수 있고, 서울 정류장과 ID를 기계적으로 맞출 수 있다.
- "최소 범위만 가능": 서울을 오가는 노선만 위와 같다.
- 둘 다 안 되면 "위치 없음(도착 예측만)"이다.

- [ ] **Step 1: 서울 쪽 근거 정리(API 호출 없음)**
  - `packages/transit-static/src/bus/scope.ts` 주석("7·8·9 값이 2026-09 데이터에 없다")을 확인한다.
  - 최신 OA-1095 노선 마스터(`jobs/fetch-bus-route-xlsx.ts`가 받고 `bus/assemble.ts`가 읽는 파일)에서 서울을 오가는 경기 노선 번호 3개를 찾는다. 예: M버스 1개, 직행좌석 1개, 경기 시내버스 1개.
  - Expected: 마스터에 없음. 결과 문서에 "서울 API로는 경기·인천 노선 ID를 얻을 수 없음"을 근거와 함께 적는다. 있으면 그 ID로 질문 1을 다시 판단한다.
- [ ] **Step 2: 활용신청(사용자)**
  - 공공데이터포털에서 다음 데이터셋을 찾아 ID와 오퍼레이션 목록, 개발계정 한도를 적는다.
    - 경기도: 버스위치정보, 버스도착정보, 버스노선, 정류소
    - 인천광역시: 버스위치정보, 버스도착정보, 버스노선·정류소
  - 사용자에게 `DATA_GO_KR_API_KEY` 계정으로 활용신청을 해 달라고 요청한다.
  - Expected: 승인 후 각 오퍼레이션이 `resultCode 00`(또는 해당 기관의 정상 코드)으로 응답한다.
- [ ] **Step 3: 탐침 스크립트**
  - `probe.ts`를 bun으로 실행한다. 키는 `.env`에서 읽고, 출력에서 키를 가린다.
  - 표본 노선 네 종류:
    - (a) 서울을 오가는 경기 광역 노선
    - (b) 경기 안에서만 다니는 시내버스
    - (c) 경기 마을버스
    - (d) 인천 노선(서울을 오가는 것 1개 포함)
  - 각 노선마다 노선 검색(번호로 ID 찾기) → 정류장 목록 → 위치 → 도착 예측을 한 번씩 부르고, 응답 필드 이름과 예시 값을 기록한다. 좌표, 정류장 순번, 차량번호, 잔여석, 혼잡, 수신 시각이 있는지 본다.
  - 위치 오퍼레이션을 표본 노선 하나에 15초 간격으로 10분 부르고(40회), 같은 차량의 값이 바뀌는 간격을 잰다.
  - Expected: 표본 노선마다 필드 표 하나와 갱신 간격(중앙값, 최대)이 나온다.
- [ ] **Step 4: 정류장 ID 맞추기**
  - (a) 노선의 서울 구간 정류장 5곳을 고른다.
  - GBIS 정류장의 ID와 모바일 번호(5자리)를 서울 `arsId`, `stId`와 비교한다. 좌표 거리도 계산한다.
  - Expected: "모바일번호 = arsId로 맞음" 같은 규칙 하나, 또는 "좌표 30m 안 최근접으로 맞춰야 함"이라는 결론과 일치율이 나온다.
- [ ] **Step 5: Cloudflare에서 접근 확인**
  - 임시 Worker `betro-spike-gbis`를 배포한다. 위치 오퍼레이션 하나를 부르는 `GET /probe`를 두고, 키는 secret으로 넣는다.
  - 결과를 확인한 뒤 Worker를 지운다.
  - Expected: Cloudflare 출구에서 200과 정상 본문이 온다. 막히면 상태 코드와 본문 앞부분을 적는다.
- [ ] **Step 6: 결과와 권고**
  - 결과 문서에 질문 1~4의 답, 오퍼레이션별 한도와 실험 호출 수, 권고를 적는다. 권고는 "전체 / 최소 / 위치 없음" 중 하나다.
  - 2-C에 주는 결정도 적는다: 어댑터 수, 정류장 ID 연결 방식, 위치 해상도에 따른 "몇 정거장 전" 계산 방식.
  - 3장 "버스 범위"는 사용자와 정하기로 했으므로, Task 7에서 사용자에게 묻는다.
- [ ] **Step 7: 커밋**

```bash
git switch docs/mvp2-experiments
git add docs/research/2026-11-06-mvp2-experiments.md
git commit -m "docs(research): record Gyeonggi and Incheon bus data experiment"
```

---

### Task 2: Worker에서 APNs 직접 발송 (9장 1행)

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md` ("2. APNs 발송 경로")
- 실험 코드(`spike/mvp2-apns`):
  - `spikes/apns-worker/src/index.ts`, `spikes/apns-worker/wrangler.jsonc`
  - `apps/native/lib/push/push-messaging.ts`에 APNs 기기 토큰 로그 한 줄을 추가한다(`getAPNSToken(getMessaging())`).

**질문**
- Cloudflare Worker의 `fetch`로 APNs(HTTP/2 전용, ES256 JWT)에 직접 보낼 수 있는가?
- 안 되면 FCM HTTP v1로 iOS 알림을 보낼 수 있는가? Live Activity 경로는 Task 4에서 본다.

**기준**: Worker가 보낸 알림이 iPhone에 5초 안에 도착하고, 응답이 200과 `apns-id`이면 통과다.

- [ ] **Step 1: 기기 토큰 얻기**
  - 실험 브랜치에서 로그 한 줄을 넣고 iPhone에 개발 빌드를 설치한다.
  - Expected: Metro 로그에 `[push] APNs token <64자 hex>`가 나온다(앞 8자만 결과 문서에 적음).
- [ ] **Step 2: 로컬 기준선**
  - `spikes/apns-worker/sign.ts`(bun)로 JWT를 만든다. 헤더는 `{alg:"ES256", kid:"HFSD7YXX9N"}`, 클레임은 `{iss:"5JKMP6D4C5", iat}`다.
  - `curl --http2 -H "authorization: bearer <jwt>" -H "apns-topic: com.cmu02.betro" -H "apns-push-type: alert" -d '{"aps":{"alert":{"title":"spike","body":"local"}}}' https://api.sandbox.push.apple.com/3/device/<token>`
  - Expected: `HTTP/2 200`과 알림 도착. 실패하면 키·토큰 문제이므로 Step 3 전에 해결한다.
- [ ] **Step 3: Worker 배포와 발송**
  - `POST /send`를 만든다.
    - 요청 본문: `{token, topic, pushType, priority, payload}`
    - 헤더 `x-spike-secret`를 확인한다.
    - JWT는 WebCrypto `importKey("pkcs8", …, {name:"ECDSA", namedCurve:"P-256"})`로 서명한다.
    - 응답: `{status, apnsId, body}`
  - `wrangler deploy`로 `betro-spike-apns`에 배포한다. secret은 `APNS_KEY_P8`(표준입력), `SPIKE_SECRET`이다.
  - curl로 `/send`를 부른다.
  - Expected: 통과 기준대로 200과 알림 도착. 실패하면 Worker가 돌려준 상태·본문·예외 메시지를 그대로 적는다(예: 연결 종료, 프로토콜 오류).
- [ ] **Step 4: 대안 경로(Step 3 실패 시 필수, 성공 시에도 1회)**
  - 같은 Worker에 `POST /send-fcm`을 만든다.
    - 서비스 계정 JSON으로 RS256 JWT를 만들고 `https://oauth2.googleapis.com/token`에서 액세스 토큰을 받는다.
    - `https://fcm.googleapis.com/v1/projects/betro-a77a2/messages:send`에 `{message:{token:<FCM 토큰>, apns:{headers:{"apns-priority":"10"}, payload:{aps:{alert:{title,body}}}}}}`를 보낸다.
  - Expected: 200과 알림 도착.
- [ ] **Step 5: 오류 응답 수집**
  - 잘못된 토큰(1글자 바꿈), 만료된 JWT(`iat`를 2시간 전으로), 잘못된 토픽으로 각 1회 보내고 상태와 `reason`을 적는다.
  - 2-C의 "토큰 무효면 등록 삭제" 규칙이 쓸 값이다.
- [ ] **Step 6: 정리와 결과**
  - `wrangler delete --name betro-spike-apns`
  - 결과 문서에 다음을 적는다.
    - 직접 발송 가능 여부
    - JWT 재사용 규칙(APNs는 20분~1시간마다 새로 만들라고 권고함)
    - 2-C에 주는 결정: 직접, FCM, 중계 서버 중 무엇을 쓸지
- [ ] **Step 7: 커밋** — `docs(research): record APNs delivery from Workers experiment`

---

### Task 3: Expo 앱에 Live Activity 위젯 확장 넣기 (9장 3행)

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md` ("3. 위젯 확장 빌드")
- 실험 코드(`spike/mvp2-live-activity`):
  - `apps/native/targets/commute-activity/`: SwiftUI, `expo-target.config.js`
  - `apps/native/modules/commute-activity/`: Expo 로컬 모듈(Swift). 배치와 설정 파일은 `modules/system-bars`와 같은 방식이다.
  - `app.config.ts`: `plugins`에 플러그인, `ios.infoPlist`에 `NSSupportsLiveActivities`, `NSSupportsLiveActivitiesFrequentUpdates`

**질문**: 지금 앱(Expo 58, RN 0.88, `useFrameworks: dynamic`, Firebase)에 ActivityKit 위젯 확장을 넣고, prebuild와 기기 빌드가 반복해서 되는가?

**기준**
- `npx expo prebuild --clean` 뒤 기기 빌드가 성공한다.
- 앱에서 시작한 Live Activity가 잠금화면과 다이내믹 아일랜드에 보인다.
- prebuild를 다시 해도 확장이 유지된다.

- [ ] **Step 1: 도구**
  - 1순위는 `@bacons/apple-targets`다(`npx create-target widget`).
  - 막히면 `expo-live-activity`(Software Mansion Labs)로 바꾼다. 막힌 지점과 오류를 결과에 적는다.
- [ ] **Step 2: Activity 정의**
  - `CommuteActivityAttributes: ActivityAttributes`
    - 정적 값: `routeLabel: String`
    - `ContentState`: `stage: String`, `stopsAway: Int`, `etaEpoch: Double`, `status: String`
  - 앱 타깃과 확장 타깃이 같은 Swift 파일을 공유해야 한다(push-to-start의 `attributes-type` 이름이 둘에서 같아야 함).
  - UI는 텍스트 네 줄이면 충분하다.
- [ ] **Step 3: 로컬 모듈**
  - `CommuteActivity` 모듈을 만든다.
    - `startLocal(routeLabel, state): Promise<string>`: activity id를 돌려준다.
    - 이벤트 `onPushToStartToken({token})`: `Activity<CommuteActivityAttributes>.pushToStartTokenUpdates`(iOS 17.2+)
    - 이벤트 `onActivityToken({activityId, token})`: `Activity.activityUpdates`에서 받은 각 Activity의 `pushTokenUpdates`
  - JS에서는 실험 화면 버튼 하나로 `startLocal`을 부르고, 두 이벤트를 로그로 찍는다.
- [ ] **Step 4: 빌드와 확인**
  - Run: `cd apps/native && npx expo prebuild --clean && bun run ios -- --device`
  - Expected: 빌드가 성공한다. 버튼을 누르면 잠금화면과 다이내믹 아일랜드에 Activity가 보이고, 로그에 push-to-start 토큰과 Activity 토큰이 나온다.
  - prebuild를 한 번 더 하고 다시 빌드해서 같은 결과가 나오는지 본다.
- [ ] **Step 5: 결과**
  - 결과 문서에 다음을 적는다.
    - 도구 이름과 버전, 막힌 점, Firebase 및 `useFrameworks: dynamic`과의 충돌 여부, 빌드 시간
    - 2-F에 주는 결정: 확장 도구, 공유 파일 배치, 모듈 API 모양
  - 실험 브랜치는 Task 4가 이어 쓴다.
- [ ] **Step 6: 커밋**(작업 브랜치, 문서만) — `docs(research): record Live Activity extension build experiment`

---

### Task 4: push-to-start와 업데이트 토큰 (9장 2행)

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md` ("4. push-to-start")
- 실험 코드(`spike/mvp2-live-activity` 이어서):
  - `spikes/apns-worker`에 `POST /token`을 추가한다. 받은 시각과 함께 `console.log`로 남기고 `wrangler tail`로 본다. Task 2 Worker를 다시 배포한다.
  - 앱 모듈 이벤트에서 토큰을 이 엔드포인트로 POST한다.

**질문**
- 앱이 꺼진 상태에서 서버가 정한 시각에 Live Activity가 뜨는가?
- 업데이트 토큰이 서버에 제때 오는가?

**기준**
- 아래 시나리오 각 2회, 합계 10회 모두 시작 푸시 뒤 10초 안에 잠금화면에 뜬다(출시 기준 7.1의 20/20을 위한 사전 확인).
- 업데이트 토큰이 10회 모두 시작 뒤 60초 안에 `/token`에 도착한다(첫 갱신이 30~60초 뒤이므로).

**시나리오**

| # | 상태 |
|---|---|
| A | 앱 스와이프 종료, 기기 잠김 |
| B | 재부팅 직후, 한 번 잠금 해제 뒤 다시 잠금 |
| C | 저전력 모드 켬 |
| D | 집중 모드(방해 금지) 켬 |
| E | 앱을 마지막으로 연 지 8시간 이상 지남(전날 밤 종료, 아침에 시험) |

- [ ] **Step 1: 시작 푸시**
  - 경로: Task 2에서 통과한 경로를 쓴다. 직접 발송이 실패했으면 FCM v1의 `apns.live_activity_token`을 쓴다. 기준선으로 로컬 curl도 쓴다.
  - 헤더: `apns-push-type: liveactivity`, `apns-topic: com.cmu02.betro.push-type.liveactivity`, `apns-priority: 10`
  - 본문: `{"aps":{"timestamp":<now>,"event":"start","attributes-type":"CommuteActivityAttributes","attributes":{"routeLabel":"341"},"content-state":{"stage":"walk","stopsAway":5,"etaEpoch":<now+900>,"status":"live"},"alert":{"title":"출근","body":"341번 08:15"}}}`
  - Expected: 기준 1
- [ ] **Step 2: 토큰 도착**
  - 각 시도마다 시작 푸시 시각과 `/token` 도착 시각의 차이를 적는다.
  - Expected: 기준 2. 오지 않으면 그 시나리오를 적고 넘어간다.
- [ ] **Step 3: 갱신과 종료**
  - 받은 업데이트 토큰으로 `event:"update"`를 30초 간격 10회 보낸다(우선순위 5와 10을 번갈아). 이어서 `event:"end"`와 `dismissal-date: now`를 보낸다.
  - Expected: 갱신 10회가 모두 반영되고, 종료 뒤 잠금화면에서 사라진다. 우선순위 5의 반영 지연을 적는다.
- [ ] **Step 4: 토큰 회전**
  - push-to-start 토큰이 바뀌는 조건(재설치, 재부팅)에서 이벤트가 다시 오는지 본다.
  - 옛 토큰으로 보냈을 때의 APNs 응답을 적는다.
- [ ] **Step 5: 결과**
  - 시나리오별 표(시작 성공, 지연, 토큰 도착 지연)를 만든다.
  - 기준에 미달하면 9장의 대안("시작 직전 로컬 알림으로 앱을 깨우는 보조 경로")이 필요한지 적는다.
  - 2-C와 2-F에 주는 결정도 적는다: 토큰 등록 API 모양, 토큰이 늦을 때 서버가 할 일.
  - Worker를 지운다.
- [ ] **Step 6: 커밋** — `docs(research): record push-to-start and token timing experiment`

---

### Task 5: Android 절전 상태에서 FCM 데이터 메시지로 Live Update 갱신 (9장 4행)

**선행**: 절전 시나리오(Step 3)는 Galaxy S20 Ultra(Android 13)로 한다. 이 기기는 Android 16이 아니므로 Step 1의 API 36 분기와 Step 4 화면 확인은 에뮬레이터(API 36)로 한다. 결과 문서에 기기별로 나눠 적고, Android 16 실기기가 생기면 Step 4를 다시 한다.

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md` ("5. Android 갱신")
- 실험 코드(`spike/mvp2-android-update`):
  - `apps/native/modules/commute-notification/`: Expo 로컬 모듈(Kotlin). `show(json)`, `cancel()`
  - `apps/native/index.ts`: `setBackgroundMessageHandler`에서 `show`를 호출
  - `spikes/fcm-sender/send.ts`(bun): 서비스 계정으로 60초마다 보냄

**질문**: 앱이 꺼지고 Doze나 절전 상태일 때도 높은 우선순위 FCM 데이터 메시지로 진행 중 알림을 만들고 갱신할 수 있는가?

**기준**: 각 시나리오 30분 동안 60초 간격 메시지의 기기 반영 시각 사이 간격이 2분을 넘지 않는다. 출시 기준 7.1 "끊김 0"을 위한 사전 확인이다.

**시나리오**

| # | 상태 |
|---|---|
| A | 앱 백그라운드, 화면 켜짐 |
| B | 앱 스와이프 종료, 화면 꺼짐 30분(실제 대기) |
| C | `adb shell dumpsys deviceidle force-idle`(Doze 강제) |
| D | `adb shell am set-standby-bucket com.cmu02.betro rare` |
| E | 기기 절전 모드 켬. 삼성이면 "절전 앱"에 넣은 경우도 확인 |
| F | 설정에서 강제 종료. FCM이 막히는 것이 정상이므로 동작만 기록 |

- [ ] **Step 1: 알림 모듈**
  - `show(json)`:
    - API 36 이상이면 `Notification.ProgressStyle`, 진행 점 4개(집, 승차, 하차, 회사), `setRequestPromotedOngoing(true)`, `setShortCriticalText("341 · 21분")`를 쓴다.
    - 그 아래에서는 일반 ongoing 알림이다.
  - 채널은 `commute-live`, 중요도 HIGH. 같은 알림 ID로 갱신한다.
  - 매니페스트에 `POST_PROMOTED_NOTIFICATIONS`를 넣는다.
- [ ] **Step 2: 보내는 스크립트**
  - `send.ts --token <FCM> --minutes 30`
  - 메시지는 `{message:{token, android:{priority:"HIGH"}, data:{seq, sentAt, stopsAway, etaEpoch}}}`이다.
  - 기기에서는 처리할 때마다 `logcat` 태그 `CommuteSpike`로 `seq`, `sentAt`, `receivedAt`을 찍는다.
- [ ] **Step 3: 시나리오 A~F 실행**
  - Run: `adb logcat -s CommuteSpike > runs/<시나리오>.log`
  - 끝나면 최대 간격과 누락 seq를 계산한다.
  - Expected: A~E는 기준 통과, F는 기록만 한다.
- [ ] **Step 4: 화면 확인**
  - 에뮬레이터(API 36)에서 상태바 칩과 잠금화면 표시를 확인한다(스크린샷). S20 Ultra에서는 일반 ongoing 알림이 같은 ID로 갱신되는지만 본다.
  - promoted ongoing 승격 조건(채널 중요도, 권한)이 막히면 그 이유를 적는다.
- [ ] **Step 5: 결과**
  - 시나리오별 표(최대 간격, 누락, 지연 중앙값)를 만든다.
  - 기준에 미달하면 9장의 대안("시작 후 포그라운드 서비스로 갱신 유지")이 필요한지와, 그때 필요한 권한(`FOREGROUND_SERVICE_*`, 스토어 신고)을 적는다.
  - 2-F에 주는 결정을 적는다.
- [ ] **Step 6: 커밋** — `docs(research): record Android Live Update delivery experiment`

---

### Task 6: `dev` 한도로 맞출 수 있는 도착 정확도 (9장 5행)

**선행**(2026-11-06 기준 미충족: 4단계 브랜치 `feat/phase4-realtime-collector`는 로컬에만 있고 develop에 병합되지 않았다): 4단계가 develop에 병합되고, 이 워크트리가 develop을 받아 수집기 코드(`packages/realtime`)와 문서(`packages/realtime/README.md`, `apps/server/README.md`)를 볼 수 있어야 한다.

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md` ("6. 도착 정확도 기준선")
- 실험 코드(`spike/mvp2-accuracy`):
  - `spikes/accuracy/collect-bus-arrivals.ts`: 버스 도착 예측 15000314를 30초마다 호출하고 ndjson으로 저장
  - `spikes/accuracy/evaluate.ts`: 예측과 실제 도착을 맞춰 오차 분포를 계산

**질문**: 공식 도착 예측만으로 7.1 기준(5분 전 예측 ±1분 80%, ±2분 95%)을 맞추는가? 출퇴근 세션 하나에 시간당 몇 건의 호출이 필요한가?

**기준**: 기준선을 재는 실험이라 통과와 실패가 없다. 다만 결과가 7.1을 넘으면 "공식 예측 + 보정"을, 못 넘으면 "자체 예측 필요"를 2-C에 권고한다.

- [ ] **Step 1: 표본**
  - 사용자의 실제 출근 경로에서 다음을 고른다.
    - 지하철 구간 1개(승차역, 방향)
    - 서울 시내버스 구간 1개(승차 정류장)
    - 마을버스 구간 1개가 있으면 함께
  - 평일 2일, 07:30~09:30에 잰다.
- [ ] **Step 2: 예측 수집**
  - 지하철: 수집기가 이미 받는 `realtimeStationArrival` 원본(R2 `raw/`)에서 해당 역·방향의 `barvlDt`와 `recptnDt`를 꺼낸다. 직접 호출하지 않는다.
  - 버스: 15000314 도착 예측을 해당 정류장·노선에 30초마다 부른다(2시간 × 2일 = 최대 480회. 오퍼레이션 한도 1,000 안).
- [ ] **Step 3: 실제 도착**
  - 수집기 이벤트 기록(R2 `events/`)에서 같은 차량이 해당 역·정류장에 도착한 시각을 찾는다. 지하철은 도착 이벤트, 버스는 `stopFlag=1`이나 구간 전이다.
  - 맞출 수 없는 표본은 이유와 함께 센다.
- [ ] **Step 4: 평가**
  - `evaluate.ts`로 "실제 도착 5분 전(±30초)에 나온 예측"의 오차를 계산한다.
  - ±1분 이내 비율, ±2분 이내 비율, 중앙값, 꼬리(최대)를 수단별로 낸다.
  - 세션 1시간당 필요한 호출 수도 계산한다.
- [ ] **Step 5: 결과**
  - 수단별 표와 권고를 적는다.
  - 2-C에 주는 결정을 적는다: 도착 계산 방식, 세션 노선 우선 폴링 간격, `dev` 한도로 검증할 수 있는 인원 수.
- [ ] **Step 6: 커밋** — `docs(research): record arrival accuracy baseline experiment`

---

### Task 7: 결과 요약과 사용자 결정

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md` (맨 앞 "요약" 절)
- Modify: `docs/superpowers/specs/2026-11-05-mvp-design.md` (9장 표에 결과 열 추가, 3장 "버스 범위" 결정 반영)

- [ ] **Step 1: 요약표**
  - 실험별로 결과(통과·실패·부분), 한 줄 결론, 2-C~2-F에 주는 결정을 표로 만든다. Task 6이 아직이면 "대기"로 둔다.
- [ ] **Step 2: 사용자 결정 받기**
  - 한 메시지로 묻는다.
    - 경기·인천 범위(전체 / 최소 / 위치 없음, Task 1 권고와 근거)
    - 실패한 실험이 있으면 그 대안 채택 여부(APNs 경로, 로컬 알림 보조, 포그라운드 서비스)
- [ ] **Step 3: 반영**
  - 답을 스펙 3장과 9장에 **[사용자 결정]**으로 적는다.
  - Expected: 2-C~2-F 계획을 쓸 때 열린 질문이 실험으로 닫혀 있다.
- [ ] **Step 4: 커밋** — `docs(spec): record MVP step 2 experiment results and decisions`
