# @Betro/commute

출퇴근 세션의 순수 로직. 경로 계획 검증, 예약 시작 판단, 도착 시각 추정, 단계(걷기·대기·탑승·도착) 전환, 푸시 값과 전송 판단, APNs·FCM 요청 만들기, 정확도 기록과 요약을 담는다.

- Cloudflare API에 의존하지 않는다. 시계와 상류 응답, 시간표는 모두 인자나 포트로 받는다. 그래서 `bun test`로 전부 테스트한다.
- 이 패키지를 Durable Object, D1, R2에 연결하는 코드는 `apps/server/src/commute`에 있다(`apps/server/README.md`).
- 설계: `docs/superpowers/specs/2026-11-05-mvp-design.md`(4, 5절). 구현 계획: `docs/superpowers/plans/2026-11-10-mvp-2c-commute-server.md`.
- import는 배럴 없이 파일 단위로 한다: `@Betro/commute/plan`, `@Betro/commute/session/stage` 처럼 `exports`가 `./*` → `./src/*.ts`다.

## 모듈 지도

| 파일 | 하는 일 |
|---|---|
| `plan.ts` | `CommutePlan`과 zod 스키마(모두 strict), `parsePlan`. 위반은 `issues`에 `schedule.days`, `routes.0.walkMinutes` 같은 점으로 이은 경로 문자열로 나온다 |
| `refs.ts` | `seoul-bus:<id>`, `seoul-subway:<id>` 형태의 노선·정류장 참조(`parseRef`, `lineRef`, `stopRef`) |
| `config.ts` | `commuteConfig(env)`: `COMMUTE_*` 환경 변수를 읽고 잘못된 값은 기본값으로 돌린다. `DEFAULT_TIMEZONE`, `DEFAULT_LEAD_MINUTES` |
| `calendar.ts` | 시간대별 날짜·시각 분해(`localParts`), 현지 시각 → epoch(`localToEpochMs`), 지금 시작할 계획 판단(`dueStart`, 3분 창) |
| `sources/types.ts` | 도착 판 인터페이스: `StopBoard`, `TransitBoards`, `Progress` |
| `sources/seoul-bus.ts` | 노선별 도착 API 파서(`parseRouteArrivals`), URL, `busBoards` |
| `sources/seoul-subway.ts` | 수집기의 역별 도착 행에서 `stationBoard`, 시간표로 빈 곳 채우기(`fillFromTimetable`) |
| `sources/assemble.ts` | 경로의 구간별로 알맞은 판을 모아 `TransitBoards`로 합침(`assembleBoards`, `legKey`) |
| `session/estimate.ts` | 구간별 차량 고르기와 도착 시각 추정(`estimateRoute`, `selectVehicle`). 방법은 실시간·외삽·시간표·배차 간격 |
| `session/stage.ts` | 세션 상태 `SessionState`와 전환 `startSession`, `advance`. 입력은 `boarded`, `next`, `end` |
| `session/content.ts` | 기기에 보내는 값 `ContentState`(`v: 1`) 만들기(`buildContent`), 보낼지 판단(`decideSend`), iOS `activityAttributes` |
| `push/apns.ts` | APNs 요청(시작·갱신·종료), ES256 JWT 서명과 재사용, 응답 분류 `classifyApns` |
| `push/fcm.ts` | FCM 요청 `fcmCommuteRequest`와 응답 분류 `classifyFcm` |
| `accuracy.ts` | 정확도 기록 `AccuracyRecord`, 세션 요약 `summarize`, 일일 보고서 `dailyReport` |

`src/__fixtures__`에 버스 도착(`arr-all-6411.json`, `arr-all-150.json`)과 지하철 판 표본이 있다.

## 흐름

1. 서버가 5분 cron이 아니라 실행기 tick마다 `dueStart`로 시작할 계획을 찾는다.
2. 세션이 열리면 tick마다 `assembleBoards`로 판을 모으고 `advance`로 상태를 한 단계 진행한다(`estimateRoute` 호출 포함).
3. `buildContent`가 `ContentState`를 만들고 `decideSend`가 보낼지, 우선순위를 5로 할지 10으로 할지 정한다.
4. `push/*`가 요청을 만들고, 서버가 보낸 뒤 응답을 `classify*`로 분류한다.
5. `recordsOf`가 예측과 실제 도착을 기록으로 바꾸고, 끝나면 `summarize`가 요약한다.

## 규칙

- 시간대 문자열은 `config.ts`의 `DEFAULT_TIMEZONE`에만 쓴다. 다른 파일은 이 값을 import한다.
- `ContentState`는 직렬화한 크기가 2048바이트를 넘지 않게 테스트한다(APNs 한도 4KB의 절반).
- 키, 토큰, 설치 ID는 기록과 로그에 넣지 않는다.
- interface의 메서드는 biome `useConsistentMethodSignatures` 때문에 `name: (...) => T` 프로퍼티형으로 쓴다.

## 테스트

```bash
bun test packages/commute
bun run check-types
```
