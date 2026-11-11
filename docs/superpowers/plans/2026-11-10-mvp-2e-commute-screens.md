# MVP 2-E: 출퇴근 화면(내 장소, 장소 설정, 출퇴근 안내) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 앱에서 장소와 그곳으로 가는 경로(기본 1개, 대안 최대 3개), 나가는 시각을 등록하면 서버에 출퇴근 예약이 저장되고, 세션이 도는 동안 17 출퇴근 안내 화면에서 지금 상태와 등록한 경로끼리의 비교를 본다.

**Architecture:** 장소 이름과 종류는 기기에만 두고(`lib/places`), 경로와 예약은 `CommutePlan`(2-C `@Betro/commute/plan`) 그대로 서버에 올린다. 화면이 쓰는 값은 모두 순수 함수(화면 모델)로 만들고 `bun test`로 고정하며, 화면 컴포넌트는 그 모델을 그리기만 한다. 등록 화면의 노선·정류장 선택은 2-D의 조회 API(`/v1/ref/*`)를 부르고, 17의 세션 카드는 2-F의 `lockScreenModel`을 다시 써서 잠금화면과 같은 문구를 보여 준다. Figma 시안은 스펙 4.4대로 먼저 고치고 그 시안을 기준으로 만든다.

**Tech Stack:** Expo SDK 58 / React Native 0.88, expo-router, Uniwind(Tailwind) + 로컬 UI 부품(`components/ui`), `expo-sqlite/kv-store`, `@tanstack/react-query`, zod, `@react-native-community/datetimepicker`(새 의존성 1개), bun test, Figma MCP.

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` 4.1, 4.2, 4.4, 5.2, 5.7, 5.10, 7.2. 서버 계약: `apps/server/README.md` "출퇴근" 절(2-C), 조회 API는 `docs/superpowers/plans/2026-11-10-mvp-2d-static-data.md` Task 4·5. 잠금화면 문구와 모델: `docs/superpowers/plans/2026-11-10-mvp-2f-lock-screen.md`.

## 계획 중 확인한 사실 (2026-11-10)

**앱(`develop` + 2-F Task 1~3, `apps/native`)**

- 하단 탭은 이미 4개(`index`, `favorites`, `commute`, `settings`)이고 `app/(tabs)/commute.tsx`는 제목만 있는 빈 화면이다. 장소(15, 16), 출퇴근 안내(17), 검색 화면은 없다.
- 공용 부품은 모두 로컬이다: `AppText`, `AppButton`(primary/secondary/ghost, large/medium), `ListRow`(trailing: chevron/none/toggle/value), `ListDivider`, `Toggle`, `Screen`, `StatusTag`. 구역 머리(`Section`)와 선택 칸(`ThemeRow`)은 `app/(tabs)/settings.tsx` 안에, 상단 막대는 `app/settings/data-sources.tsx` 안에 따로 들어 있다. 노선 배지, 칩, 입력란, 빈 상태, 시각·요일 고르기는 없다. HeroUI Native는 `cn`과 Provider만 쓴다.
- 색과 글자: `theme/tokens.ts`(`COLOR_TOKENS`, `TRANSIT_COLORS`, `RADII`, `ELEVATION`), `theme/typography.ts`(`TEXT_STYLES`). `bun run theme:css`가 CSS 변수를 만든다. 노선색 변수는 있지만 쓰는 부품이 아직 없다.
- 문구: `lib/i18n/messages-ko.ts`의 키와 `t(key, params)`. 복수형 처리는 없다. `no-hardcoded-copy.test.ts`가 `app`, `components`, `lib`, `contexts`의 한글을 막는다. `places.*`, `favorites.*` 키는 없다.
- 기기 저장: 환경설정만 있다(`lib/preferences/*`, `expo-sqlite/kv-store` 동기 API, 키 `betro.preferences`, 버전 1, zod로 필드별 복구). 장소·즐겨찾기 저장소는 없다.
- 서버 호출: `lib/server/api-client.ts`의 `ServerClient.request(method, path, body?) => Promise<{ json: unknown; status: number }>`(인증 헤더를 붙이고 10초 뒤 끊는다. 예외를 던지지 않고 네트워크 오류는 `status: 0`). `lib/server/app-server.ts`의 `serverClient`, `ensureRegistered()`. 출퇴근 라우트를 부르는 코드는 없다.
- 잠금화면 쪽(2-F): `lib/commute/content-state.ts`(`ContentState`, `parseContentState`), `lib/commute/lock-screen-model.ts`(`lockScreenModel(state, deps): LockScreenModel`), `modules/commute-activity`의 `CommuteActivity.setPlanHeaders(headers: Record<string, string>)`. 2-F Task 7(Android)은 `header: (planId: string) => Promise<string | null>`을 2-E가 준다고 가정한다.
- 테스트는 순수 함수만 있다(`*.test.ts`, 20개). 화면을 그려 보는 테스트 환경은 없다. `@tanstack/react-query`는 연결돼 있지만 쓰는 화면이 없다.
- 앱은 `@Betro/commute`에 의존하지 않는다. 그 패키지는 `"exports": { "./*": "./src/*.ts" }`이고 `plan.ts`는 zod만 쓴다.

**서버**

- `PUT /v1/commute/plans/:planId`는 `CommutePlan`을 받는다. 204, 400 `{ error, issues: string[] }`, 409(설치당 16개 초과), 404(다른 설치의 planId). `GET /v1/commute/plans`는 `{ plans }`, `DELETE`는 204.
- `parsePlan`의 한도: 경로 1~4개(`rank` 0이 정확히 하나), 경로당 구간 1~4개, `walkMinutes` 길이 = 구간 수 + 1이고 값은 0~60, 버스는 `alight.seq > board.seq`, 지하철은 승차역 ≠ 하차역, 요일 1~7개(0~6), `leadMinutes` 5~30, `leaveMinute` 0~1439, `planId`는 UUID.
- `GET /v1/commute/sessions/active`는 `{ session: { sessionId, planId, content } | null }`만 준다. 대안 경로의 도착 예상은 실행기 안(`entry.state.estimates`, `RouteEstimate[]`)에 있지만 응답에 없다.
- `POST /v1/commute/sessions/:id/input` `{ kind: "boarded" | "next" | "end" }`: 204, 404, 409(끝난 세션).
- 조회 API(2-D, 아직 배포 전):
  - `GET /v1/ref/bus/routes?q=&limit=` → `{ batchId, routes: { line, name, shortName, region: "seoul" | "gyeonggi" | "incheon", routeType }[] }`. `q`가 비면 400, 기본 20개, 최대 50개.
  - `GET /v1/ref/bus/routes/:line/stops` → `{ line, name, shortName, region, stops: { stop, name, seq, arsId, directionName }[] }`. 404 `route not found`.
  - `GET /v1/ref/subway/lines` → `{ lines: { line, name }[] }`.
  - `GET /v1/ref/subway/lines/:line/stations` → `{ batchId, branches: { branchKey, stations: { stop, name }[] }[] }`.
  - `GET /v1/ref/subway/direction?line=&from=&to=` → `{ direction: "up" | "down", stops }`. 한 번에 못 가면 404 `{ error: "not-direct" }`.
  - 참조 데이터가 없으면 모두 503 `reference unavailable`.
- 서울 버스 API의 `routeType`: 1 공항, 2 마을, 3 간선, 4 지선, 5 순환, 6 광역, 7 인천, 8 경기.

**Figma(`Betro App UI`, 2026-11-10 조사)**

스펙 4.4의 수정이 아직 들어가 있지 않다. 프레임 이름은 영어다(`iOS / 16 Place Setup` 등). 같은 날 오전의 개편은 디자인 시스템(회색 팔레트, 글꼴, 모서리, 장식 제거)만 고쳤고 PR #13으로 앱에 반영됐다. 개편을 한 세션이 19:45 KST에 파일을 다시 읽어 아래 표와 같은 상태임을 확인했다. 컴포넌트와 변수는 모두 이 파일의 로컬 항목이라 게시가 필요 없다. MCP로는 버전 기록(복원 지점)을 만들 수 없다.

| 4.4 항목 | 지금 시안 | node |
|---|---|---|
| 16: "다시 찾기", "대체 경로 추천" 빼고 직접 고르기 | 둘 다 남아 있고 고르는 흐름이 없다. 주소 입력란이 있다 | iOS 28:31994, Android 28:31722 |
| 16: "출근 알림" → "나가는 시각(요일)" | "출근 알림 · 평일 08:05 · 341번 도착 5분 전" | 28:32129, 28:31850 |
| 17: 등록한 대안만 | 등록하지 않은 3412번, "추천" 표시, "360번으로 안내 시작" 버튼. 레이어 구조가 읽히지 않는다(그림 한 장) | 29:33232, 29:16602 |
| 하단 탭 "알림" → "출퇴근" | "지도 / 즐겨찾기 / 알림 / 설정" | `TabBar` 5:255 |
| 12 설정: "알림 시간대" 빼기 | 게스트 프레임은 있고 줄이 남아 있다 | 43:34987, 43:35154, 43:35335, 43:35404 |
| 02 권한 문구 | "도착 알림과 지연 안내를 보내드려요" | 12:3208, 12:4931 |
| 18·19·18: 위치 먼저, 버튼 | 남은 분이 가장 크다. "탔어요", "다음 차 탈게요"가 없다 | `LiveActivity` 48:1946, `LiveUpdate` 48:2001, 49:18907 |
| 16: 마을버스, 경기·인천 | 버스 고르는 화면이 없다. `BusBadge`에 경기·인천이 없다 | `BusBadge` 4:47 |

15 내 장소(28:31887, 28:31618)는 주소와 "약 31분"을 보여 주고, 빈 상태 프레임이 없다. 시각·요일 고르기는 `10 Alert Setup`(16:11402)에 프레임으로만 있고 컴포넌트가 아니다.

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/mvp2-screens`, 브랜치 `feat/mvp2-commute-screens`. **2-F Task 1~3(PR #16)이 병합된 `develop`에서 만든다.** PR은 develop으로.
- 커밋 메시지와 PR 본문에 AI 서명이나 출처 표기를 넣지 않는다.
- 포맷은 바꾼 파일에만 `bunx biome check --write <파일>`. 각 Task 끝에 저장소 루트에서 `bun test`, `bun run check-types`, `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`가 통과해야 한다(CI와 같은 기준. 루트 `ultracite check`는 옛 파일 때문에 원래 실패한다).
- **서버에 주소, 좌표, 장소 이름을 보내지 않는다**(5.2). 서버로 가는 것은 `CommutePlan`뿐이다.
- **앱은 사용자가 등록한 경로끼리만 비교한다.** 앱이 경로를 찾아 주거나 추천하지 않는다.
- 출퇴근 흐름(15, 16, 17)에 로그인 요구, 팝업, 광고를 넣지 않는다.
- 문구는 `messages-ko.ts`의 키로만 쓴다. 노선과 상태를 색만으로 구분하지 않는다(배지에는 항상 글자가 있다).
- 색, 간격, 글자 크기는 `theme/tokens.ts`와 `theme/typography.ts`의 값만 쓴다. 새 색을 만들지 않는다. Task 1에서 Figma 변수가 바뀌면 토큰 파일을 먼저 맞춘다.
- **2026-11-10 개편의 디자인 규칙**을 새 시안과 화면에 그대로 지킨다.
  - 라임(accent)은 주요 버튼, 토글, 현재 탭에만 쓴다.
  - 선택된 칩과 요일은 `bg/inverse` + `text/inverse`다.
  - 아이콘 뒤에 색 타일을 두지 않는다.
  - 상태 태그는 알약 배경 없이 점 + 글자다.
  - 숫자도 Noto Sans KR(고정폭 숫자)로 쓴다.
  - 시트는 유리 효과 대신 불투명 `bg/surface`다.
- 시간대 문자열을 앱 코드에 쓰지 않는다. `@Betro/commute/config`의 `DEFAULT_TIMEZONE`, `DEFAULT_LEAD_MINUTES`를 가져다 쓴다. 예약의 시간대는 기기 시간대가 아니라 이 값이다(대중교통이 서울 기준이고, 서버가 그 밖의 시간대 예약을 시작하지 않는다). **[설계 판단]**
- 화면 컴포넌트 안에서 값을 계산하지 않는다. 화면에 보이는 글자와 상태는 `lib/**`의 순수 함수가 만들고 테스트가 고정한다.
- 새 의존성은 `@react-native-community/datetimepicker` 하나다(`bunx expo install`). 그 밖에는 더하지 않는다.
- 범위 밖: 주소 입력과 지도 위 경로(지도는 MVP 4단계), 앱이 경로를 찾아 주는 기능, 세션 수동 시작("지금 출발"), 세션 도중 대안으로 갈아타는 입력, 즐겨찾기(09), 검색(05), TAGO·GBIS 노선. 잠금화면 구현은 2-F다.

## 설계 결정 **[설계 판단]**

- **장소 하나에 예약 하나.** 장소는 "그곳으로 가는 경로 + 나가는 시각"을 가진다. 회사에는 출근 경로를, 집에는 퇴근 경로를 등록한다(스펙 4.2 "퇴근도 같은 방식으로 따로 등록").
- **주소 입력란을 뺀다.** 주소를 쓰는 기능이 없고(경로를 직접 고른다), 서버에 보내지도 않는다.
- **소요 시간("약 31분")을 보여 주지 않는다.** 버스에는 시간표가 없어 등록 시점에 낼 근거가 없다. 카드에는 경로 요약과 나가는 시각, 대안 수를 보여 준다.
- **머리줄**: 종류가 회사면 "출근 · {이름}까지", 학교면 "등교 · {이름}까지", 집이면 "퇴근 · 집까지", 기타면 "{이름}까지". 종류가 기타가 아니면 이름은 종류 이름("집", "회사", "학교")이다.
- **도보 시간 기본값**: 출발지 → 첫 승차 5분, 환승 사이 3분, 마지막 하차 → 목적지 5분. 0~60분에서 1분 단위로 고친다.
- **저장 순서**: 기기에 먼저 쓰고 서버에 올린다. 서버에 못 올린 장소는 "아직 서버에 저장되지 않았어요"로 표시하고 앱이 앞으로 올 때마다 다시 올린다. 서버에 올라가기 전에는 그 예약이 동작한다고 말하지 않는다.
- **재설치 뒤 맞추기**(5.2가 2단계로 미룬 것): iOS는 재설치해도 설치 ID가 남아 서버에 예약이 그대로 있다. 앱을 열 때 서버 목록을 받아, 기기가 모르는 예약은 종류 "기타", 이름 "가져온 경로"인 장소로 가져온다. 지우지 않는 이유는 사용자가 등록한 것이고, 보이지 않는 예약이 잠금화면을 띄우면 안 되기 때문이다.
- **17에는 지도를 넣지 않는다.** 세션 카드, 등록한 경로 비교, "안내 종료"만 둔다. "탔어요", "다음 차 탈게요"는 두지 않는다(2026-11-11 사용자 결정).
- **등록 화면의 임시 값**(고르는 중인 경로)은 화면 사이에서 모듈 수준 저장소(`setup-draft.ts`) 하나로 주고받는다. 구간 고르기 화면이 고른 구간을 거기에 쓰고 돌아온다.

## Review Focus

1. **서버에 올라가지 않은 저장**: 비행기 모드에서 장소를 저장하면 기기에는 남고 "아직 서버에 저장되지 않았어요"가 보이며, 네트워크가 돌아온 뒤 앱을 앞으로 가져오면 올라간다. 올라가기 전에 지운 장소가 서버에 다시 생기지 않는다.
2. **재설치·서버 쪽 삭제**: 기기 저장소가 비었는데 서버에 예약이 있으면 가져온다. 기기에는 있는데 서버에 없으면(서버가 설치를 지운 경우) 다시 올린다. 두 경우 모두 같은 예약이 두 번 생기지 않는다.
3. **고를 수 없는 구간**: 버스 하차 정류장이 승차보다 앞이거나 같다. 지하철 두 역이 한 번에 이어지지 않는다(`not-direct`). 지선이 여러 개인 노선에서 다른 지선의 역을 고른다. 이름이 같은 정류장이 한 노선에 두 번 나온다(순환, 왕복).
4. **조회가 안 될 때**: 검색어가 비었다, 결과가 0건이다, 503이다, 응답이 느리다(10초). 번호가 같은 서울·경기·인천 노선이 지역 표시로 구분된다.
5. **한도와 경계**: 구간 4개, 대안 3개, 장소 16개(서버 409), 요일을 하나도 고르지 않음, 00:05에 나가는 예약(잠금화면은 전날 23:55에 뜬다), 17을 보는 중에 세션이 끝남("안내 종료" 409).

각 항목의 테스트는 아래 Task의 Step에 들어 있다.

## 파일 구조

```
apps/native/
  app/(tabs)/commute.tsx              15 내 장소 (수정)
  app/places/new.tsx                  16 장소 설정(새 장소)
  app/places/[placeId].tsx            16 장소 설정(고치기)
  app/places/leg.tsx                  16 구간 고르기
  app/commute/[placeId].tsx           17 출퇴근 안내
  components/ui/{top-bar,section,chip,stepper,text-field,empty-state}.tsx
  components/transit/line-badge.tsx   버스·지하철 노선 배지
  components/places/{place-card,route-card,weekday-picker,time-row,setup-form}.tsx
  components/commute/{session-card,route-compare-row}.tsx
  lib/places/places.ts                장소 형식, 저장 형식, 파싱
  lib/places/places-store.ts          저장소(kv-store)
  lib/places/use-places.ts            훅
  lib/places/route-draft.ts           고르는 중인 경로, CommutePlan으로 바꾸기
  lib/places/setup-draft.ts           등록 화면의 임시 값
  lib/places/plan-sync.ts             서버에 올리기, 지우기, 맞추기
  lib/places/plan-headers.ts          planId → 머리줄
  lib/places/place-card-model.ts      15 카드에 보이는 값
  lib/places/leg-picker-model.ts      구간 고르기에 보이는 값
  lib/ref/ref-client.ts               조회 API 호출
  lib/commute/session-client.ts       진행 중 세션, 입력
  lib/commute/guide-model.ts          17에 보이는 값
apps/server/src/commute/runner-core.ts  진행 중 세션 응답에 경로별 예상 추가
```

---

### Task 1: Figma 시안 고치기 (스펙 4.4)

**Files:**
- Figma `Betro App UI`(`MiS0r5xYKVht3Pc7YXMXpP`)의 `Components`, `iOS`, `Android` 페이지
- Modify: 이 계획 문서(고친 프레임의 node ID 표), `apps/native/theme/tokens.ts`(변수가 바뀐 경우만)

**Interfaces:**
- Produces: 아래 프레임. Task 6~9와 2-F Task 4~7이 이 시안을 기준으로 삼는다. 모든 프레임은 다크·라이트 두 벌, 컴포넌트 인스턴스와 변수로만 만든다(직접 넣은 색·간격 금지).

- [ ] **Step 0: 복원 지점** — Figma를 고치기 전에 사용자에게 파일의 버전 기록에 이름 붙인 버전을 하나 저장해 달라고 한다(File → Save to version history). MCP로는 만들 수 없다. 저장됐다는 답을 받은 뒤에 고친다.
- [x] **Step 1: 읽기** — `figma:figma-use` 스킬을 먼저 읽는다. `create_session` 뒤 위 표의 node와 `Components` 페이지를 읽고, 2026-11-10 조사와 달라진 곳이 있으면 이 문서의 표를 고친다.
- [x] **Step 2: 컴포넌트**
  - `TabBar`(5:255): "알림" 변형을 "출퇴근"(아이콘 route)으로 바꾼다. 인스턴스가 모두 따라오는지 본다.
  - `BusBadge`(4:47): 경기·인천 노선용 표시. 새 색을 만들지 않고, 배지 옆에 붙는 지역 라벨("경기", "인천")을 컴포넌트 속성으로 더한다.
  - 새 컴포넌트: `WeekdayPicker`(월~일, On/Off), `TimeRow`(값 "08:10"), `Stepper`(− 4분 +), `RouteStepRow`(도보 줄 / 탑승 줄), `PlaceCard`(등록됨 / 서버에 저장 안 됨 / 추가), `EmptyState`.
  - `LiveActivity`(48:1946), `LiveUpdate`(48:2001): 상태 문장이 가장 크고(`Title/1`), 남은 분과 도착 시각이 그다음(`Title/3`)이 되게 바꾼다. 탑승 전 변형에 "탔어요", "다음 차 탈게요" 버튼 줄을 더한다. Android는 버튼이 3개까지라 탑승 전 "탔어요 / 다음 차 탈게요 / 종료", 탑승 뒤 "종료"로 둔다. 문구는 2-F 계획의 "잠금화면 문구 표" 그대로 쓴다.
  - `CommuteProgress`(47:2005): 구간 수에 따라 노드가 늘어나는 변형(구간 1개 4노드, 2개 5노드, 3개 6노드)을 더한다.
- [x] **Step 3: 화면** (iOS, Android 각각)
  - `02 Permissions`: 알림 설명을 "출퇴근 시간에 잠금화면에 도착 정보를 띄워요"로.
  - `12 Settings`(게스트 4개): "알림 시간대"와 "푸시 알림" 줄을 지우고 알림 구역을 "출퇴근 잠금화면 안내" 토글 한 줄로. 위쪽 로그인 카드("로그인하고 내 장소 백업하기")도 지운다(로그인은 출시 이후이고 앱에도 없다). 로그인한 상태의 프레임 4개(17:11578, 17:22403, 17:21872, 17:27404)는 03·10·11처럼 그대로 남겨 둔다.
  - `15 My Places`: 탭 화면으로(뒤로 가기 없음, 하단 탭 있음). 안내문 "누르는 즉시 안내해 드려요"는 "장소마다 자주 타는 경로와 나가는 시각을 저장해 두면, 그 시각에 맞춰 잠금화면에 띄워 드려요."로 바꾼다(수동 시작이 없다). 카드에서 주소와 "약 N분"을 빼고 "경로 요약 / 평일 08:10 출발 · 대안 2개"로. 프레임 3개: 등록된 상태, 빈 상태, 진행 중 세션 띠가 있는 상태.
  - `16 Place Setup`: 주소 입력란, "다시 찾기", "대체 경로 추천", "출근 알림"을 지운다. 위에서부터 장소 종류 칩, 이름(기타일 때만), "자주 타는 경로"(도보 줄과 탑승 줄, "구간 추가"), "대안 경로"("대안 경로 추가", 최대 3개), "나가는 시각"(시각 줄 + 요일), "공휴일에도 띄우기" 토글, 안내 "잠금화면 안내는 나가는 시각 10분 전에 떠요", "저장", 고칠 때만 "장소 삭제".
  - 새 프레임 `16a Leg · Mode`(버스 / 지하철), `16b Leg · Bus Route`(검색란, 결과 줄: 배지 + 노선 이름 + 지역 라벨, 결과 없음, 불러오지 못함), `16c Leg · Stops`(승차 고르기 → 하차 고르기. 하차 단계에서는 승차 이전 정류장이 흐리게), `16d Leg · Subway`(노선 → 승차역 → 하차역, "한 번에 갈 수 없어요" 안내).
  - `17 Commute Guide`: 레이어로 다시 만든다(지금은 그림 한 장). 지도 없음. 상단 막대 "{장소} 가는 길", 세션 카드(잠금화면 카드와 같은 내용), 버튼 "탔어요" "다음 차 탈게요" "안내 종료", "같은 곳으로 가는 다른 방법"에는 등록한 대안만(도착 예상과 기본 경로와의 차이). "추천" 표시, 3412번, "360번으로 안내 시작"을 지운다. 프레임 3개: 진행 중(탑승 전), 진행 중(탑승 뒤, 버튼은 "안내 종료"만), 세션 없음("다음 안내 평일 08:00" + 등록한 경로 목록).
  - `18 Live Activity`, `19 Dynamic Island`, `18 Live Update`: 고친 컴포넌트로 바꾸고 탑승 전 프레임에 버튼이 보이게 한다. Compact는 배지 + 남은 분 그대로 둔다(폭이 좁다).
- [x] **Step 4: 확인** — 고친 프레임마다 `get_screenshot`으로 다크·라이트를 찍어 본다. Expected: 4.4의 8개 항목이 모두 반영됐고, 직접 넣은 색이 없으며(`get_variable_defs`), 글자가 잘리지 않는다. 고친 프레임과 새 프레임의 node ID를 이 문서 "Figma 결과" 표에 적는다.
- [ ] **Step 5: 사용자 확인** — 스크린샷을 사용자에게 보이고 확인을 받는다. 화면 구성이 바뀌면 이 계획의 해당 Task를 고친다. **확인 전에는 Task 6 이후로 넘어가지 않는다.** Task 2~5는 시안과 무관하므로 먼저 해도 된다.
- [ ] **Step 6: 커밋** — `docs(plan): record the Figma changes for the commute screens`

---

### Task 2: 서버 — 진행 중 세션에 경로별 예상 싣기

**Files:**
- Modify: `apps/server/src/commute/runner-core.ts`(`ActiveSession`, `activeSession`), `apps/server/src/commute/runner-core.test.ts`, `apps/server/README.md`

**Interfaces:**
- Consumes: `SessionEntry.state.estimates: RouteEstimate[]`, `state.legIndex`
- Produces: `GET /v1/commute/sessions/active` 응답의 `session`에 `routes`가 더해진다.
  ```ts
  interface SessionRouteView {
    rank: number;
    /** 기본 경로는 지금 구간, 대안은 첫 구간의 탑승 예상(초). */
    boardEtaEpoch: number | null;
    destinationEtaEpoch: number | null;
    etaState: "live" | "estimated";
    positionState: "live" | "stale" | "none";
    stopsAway: number | null;
  }
  interface ActiveSession { content: ContentState; planId: string; routes: SessionRouteView[]; sessionId: string }
  ```
  `routes`는 `rank` 오름차순이고 등록한 경로 수만큼 있다. 시각은 `ContentState`와 같이 초 단위다.

- [ ] **Step 1: 실패하는 테스트** — `runner-core.test.ts`: 대안이 하나 있는 경로로 세션을 시작하고 한 tick 돌린 뒤 `activeSession`이 `routes` 2개(`rank` 0, 1)를 주고, `rank` 1의 `destinationEtaEpoch`가 그 대안 추정의 `destinationEtaAt / 1000`(내림)과 같다. 추정이 아직 없으면(첫 tick 전) 각 값이 null이고 `etaState`는 `"estimated"`, `positionState`는 `"none"`이다. 대안이 없는 경로는 `routes`가 1개다.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/server/src/commute/runner-core.test.ts` / Expected: 새 테스트만 FAIL.
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 세 게이트.
- [ ] **Step 5: 커밋** — `feat(server): return per-route estimates with the active commute session`

배포는 Task 10에서 한다(2-D의 조회 API 배포와 같은 `develop`에서).

---

### Task 2A: 남은 구간을 푸시 값에 싣고, 잠금화면 모델에서 버튼과 진행 표시 빼기 (2026-11-11 추가)

스펙 개정(2026-11-11, 4.3·5.3 "푸시 값 v1"의 `nextLegs`)을 코드에 옮긴다. 사용자가 잠금화면과 17의 "탔어요", "다음 차 탈게요" 버튼을 빼고, 카드에 남은 구간의 승차 정보를 모두 보이기로 정했다. 탑승은 서버가 시각으로만 추정한다(`stage.ts` `checkPassed`, 이미 있다). Swift 쪽은 구조체에 필드만 더하고, 그리기는 2-F Task 4다.

**Files:**
- Modify: `packages/commute/src/session/content.ts`, `content.test.ts`, `apps/server/README.md`(푸시 값 절)
- Modify: `apps/native/lib/commute/content-state.ts`, `content-state.test.ts`, `lock-screen-model.ts`, `lock-screen-model.test.ts`, `__fixtures__/lock-screen-cases.json`, `lib/i18n/messages-ko.ts`
- Modify: `apps/native/targets/commute-activity/CommuteActivityAttributes.swift`(모듈 쪽은 심볼릭 링크라 같이 바뀐다)

**Interfaces:**
- Consumes: `RouteEstimate.legs[i].boardEtaAt`, `.etaState`, `Route.legs[i].board.name`, `state.legIndex`, `state.stage`
- Produces:
  ```ts
  // packages/commute/src/session/content.ts 와 apps/native/lib/commute/content-state.ts 에 같은 모양
  interface NextLegContent { boardEtaEpoch: number | null; etaState: "live" | "estimated"; lineName: string; mode: "bus" | "subway"; stopName: string }
  interface ContentState { /* v1 필드 그대로 */ nextLegs: NextLegContent[]; v: 1 }
  // lock-screen-model.ts
  type LockScreenAction = "end";
  interface LockScreenModel {
    actions: LockScreenAction[];          // iOS [], Android ["end"]
    nextLegs: { lineName: string; mode: "bus" | "subway"; text: string }[];   // 최대 2개
    moreLegs: string | null;              // 남은 구간이 3개 이상이면 "외 {n}구간"(n = 남은 수 - 2), 아니면 null
    /* progress 는 지운다. 그 밖의 필드는 그대로 */
  }
  ```
  - 서버 `buildContent`: 기본 경로의 `legIndex + 1`부터 끝까지 순서대로(최대 3개). `stopName`은 그 구간의 `board.name`, `boardEtaEpoch`는 그 구간 추정의 `boardEtaAt`(초, 내림), 없으면 null. `stage`가 `arrived`·`ended`면 `[]`. 서버는 키를 늘 보낸다.
  - 앱 `parseContentState`: `nextLegs`가 없으면 `[]`(배포된 서버와 옛 값). 있는데 배열이 아니거나 항목 하나라도 모양이 틀리면 전체가 null(지금 `suggestion`과 같은 엄격함). `v`는 1 그대로다.
  - Swift: `public struct NextLeg: Codable, Hashable { lineName, mode, stopName: String; boardEtaEpoch: Double?; etaState: String }`, `public var nextLegs: [NextLeg]?`(옵셔널이라 키가 없어도 디코딩된다). `init`에 `nextLegs: [NextLeg]? = nil`.
  - 문구(`commute.lock.*`):
    | 키 | 문구 | 조건 |
    |---|---|---|
    | `nextLeg.eta` | `{stop} · {eta} 승차` | `boardEtaEpoch` 있음, `etaState: live` |
    | `nextLeg.etaEstimated` | `{stop} · 약 {eta} 승차` | `boardEtaEpoch` 있음, `estimated` |
    | `nextLeg.noEta` | `{stop}` | `boardEtaEpoch` 없음 |
    | `nextLeg.more` | `외 {n}구간` | 남은 구간 3개 이상 |
    | `status.beforeLeave` (바꿈) | `{leave}에 나가세요` | 그대로 |
    | `detail.beforeLeave` (새로) | `{stop} · {eta} 탑승` | `status.beforeLeave`를 쓸 때의 상세 |
    `action.boarded`, `action.next` 키는 지운다. `action.end`는 남긴다.
  - `decideSend`: `nextLegs` 길이나 어느 항목의 `lineName`이 바뀌면 높은 우선순위(10). 어느 항목의 `boardEtaEpoch` 분이나 `etaState`가 바뀌면 낮은 우선순위(5).

- [ ] **Step 1: 실패하는 테스트**
  - `content.test.ts`:
    - 구간 3개 경로의 첫 구간 `wait`에서 `nextLegs`가 2개이고, 각각 둘째·셋째 구간의 승차 정류장 이름과 추정 `boardEtaAt / 1000`(내림)이다.
    - 같은 경로 셋째 구간 `wait`에서 `[]`.
    - 1구간 경로에서 `[]`.
    - `arrived`에서 `[]`.
    - 추정이 없으면 `boardEtaEpoch: null`, `etaState: "estimated"`.
    - `decideSend`: 둘째 구간 시각만 1분 바뀌면 `priority: 5`. 남은 구간 수가 바뀌면 `10`. 같은 분 안에서 초만 바뀌면 보내지 않는다.
  - `content-state.test.ts`:
    - `nextLegs` 없는 v1 값 → `nextLegs: []`.
    - 정상 2개 → 그대로.
    - 항목에 `stopName`이 없으면 null.
    - `nextLegs: "x"` → null.
  - `lock-screen-model.test.ts`:
    - iOS `actions`는 모든 단계에서 `[]`, Android는 `["end"]`.
    - 남은 구간 1개 → `nextLegs` 1줄, `moreLegs: null`.
    - 3개 → 2줄과 "외 1구간".
    - 추정 시각 → "잠실역 · 약 08:36 승차".
    - 시각 없음 → "잠실역".
    - 나가기 전 → 상태 "08:10에 나가세요", 상세 "천호역.현대백화점 · 08:15 탑승".
    - `progress` 필드가 없다.
  - `lock-screen-cases.json`에 남은 구간 0·1·3개 사례를 더하고 기대 문구를 고친다. 버튼 기대값을 지운다.
- [ ] **Step 2: 실패 확인** — Run: `bun test packages/commute apps/native/lib/commute` / Expected: 새 테스트가 FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces대로. `lock-screen-model.ts`의 `actionsOf`에서 `boarded`·`next`를 지우고, `progressOf`를 지우고 남은 구간 줄을 만든다. Swift는 구조체만 고친다.
- [ ] **Step 4: 통과 확인** — 세 게이트. 그리고 Swift 타입 검사 — Run: `xcrun --sdk iphoneos swiftc -typecheck -target arm64-apple-ios17.2 apps/native/targets/commute-activity/CommuteActivityAttributes.swift` / Expected: 오류 없음.
- [ ] **Step 5: 커밋** — `feat(commute): send the remaining legs and drop the boarding buttons`

배포는 Task 10에서 Task 2와 함께 한다. 옛 앱은 `nextLegs`를 무시하고, 새 앱은 옛 서버의 값을 `[]`로 읽으므로 배포 순서가 어긋나도 카드는 멈추지 않는다.

---

### Task 3: 조회 API 호출부

**Files:**
- Create: `apps/native/lib/ref/ref-client.ts`, `ref-client.test.ts`

**Interfaces:**
- Consumes: `ServerClient`(2-F Task 1)
- Produces:
  ```ts
  type RefFailure = "offline" | "unavailable" | "not-found" | "invalid";
  type RefResult<T> = { ok: true; value: T } | { ok: false; reason: RefFailure };
  interface BusRouteMatch { line: string; name: string; region: "seoul" | "gyeonggi" | "incheon"; routeType: string; shortName: string }
  interface BusStop { arsId: string | null; directionName: string | null; name: string; seq: number; stop: string }
  interface SubwayBranch { branchKey: string; stations: { name: string; stop: string }[] }
  searchBusRoutes(client, q: string): Promise<RefResult<BusRouteMatch[]>>
  busRouteStops(client, line: string): Promise<RefResult<{ line: string; name: string; shortName: string; region: BusRouteMatch["region"]; stops: BusStop[] }>>
  subwayLines(client): Promise<RefResult<{ line: string; name: string }[]>>
  subwayStations(client, line: string): Promise<RefResult<SubwayBranch[]>>
  subwayDirection(client, line: string, from: string, to: string): Promise<RefResult<{ direction: "up" | "down"; stops: number }> | { ok: false; reason: "not-direct" }>
  ```
  `status` 0 → `offline`, 503 → `unavailable`, 404 → `not-found`(direction의 `not-direct`는 따로), 그 밖과 모양이 맞지 않는 본문 → `invalid`. 응답은 zod로 읽는다. `searchBusRoutes`는 앞뒤 공백을 뗀 `q`가 비면 서버를 부르지 않고 빈 배열을 준다. 경로의 ID는 `encodeURIComponent`로 넣는다.

- [ ] **Step 1: 실패하는 테스트** — 가짜 `ServerClient`로: 각 함수의 정상 응답(위 "확인한 사실"의 모양), 0·503·404·500, 필드가 빠진 본문(`invalid`), `not-direct`, 빈 검색어(호출 0번), `line`에 `:`이 들어간 ID가 인코딩된 경로로 나간다.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/ref` / Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 세 게이트.
- [ ] **Step 5: 커밋** — `feat(native): add the registration lookup client`

---

### Task 4: 장소 저장소와 경로 만들기

**Files:**
- Create: `apps/native/lib/places/{places,places-store,use-places,route-draft,plan-headers}.ts`와 각 `*.test.ts`(`use-places` 제외)
- Modify: `apps/native/package.json`(`@Betro/commute` `workspace:*`), `apps/native/lib/i18n/messages-ko.ts`(머리줄, 종류 이름)

**Interfaces:**
- Consumes: `@Betro/commute/plan`의 `CommutePlan`, `Leg`, `parsePlan`, `@Betro/commute/config`의 `DEFAULT_TIMEZONE`, `DEFAULT_LEAD_MINUTES`, `lib/preferences/preferences-store.ts`의 `SyncKeyValue`
- Produces:
  ```ts
  // places.ts
  type PlaceKind = "home" | "work" | "school" | "other";
  interface Place { id: string; kind: PlaceKind; name: string; plan: CommutePlan; sync: "synced" | "pending"; updatedAt: number }
  interface PlacesState { pendingDeletes: string[]; places: Place[] }   // pendingDeletes는 planId
  parsePlacesState(raw: string | null): PlacesState     // 저장 키 "betro.places", version 1
  // places-store.ts
  createPlacesStore(kv: SyncKeyValue): { get(): PlacesState; subscribe(fn): () => void; upsert(place: Place): void; remove(placeId: string): void; markSynced(placeId: string, updatedAt: number): void; clearPendingDelete(planId: string): void; replace(state: PlacesState): void }
  // route-draft.ts
  interface RouteDraft { legs: Leg[]; walkMinutes: number[] }
  emptyRoute(): RouteDraft
  addLeg(route: RouteDraft, leg: Leg): RouteDraft        // 도보 기본값 5, 3, 5를 맞춘다
  removeLeg(route: RouteDraft, index: number): RouteDraft
  setWalk(route: RouteDraft, index: number, minutes: number): RouteDraft
  type DraftIssue = "no-leg" | "too-many-legs" | "too-many-routes" | "no-day" | "name-required" | "invalid";
  buildPlan(input: { days: number[]; includeHolidays: boolean; leaveMinute: number; planId: string; routes: RouteDraft[] }): { ok: true; plan: CommutePlan } | { ok: false; issues: DraftIssue[] }
  // plan-headers.ts
  headerOf(place: Pick<Place, "kind" | "name">, t): string
  headersOf(places: Place[], t): Record<string, string>   // planId → 머리줄
  planHeaderOf(planId: string, state: PlacesState, t): string | null
  ```
  - `routes[0]`이 기본 경로(`rank` 0), 나머지가 대안(`rank` 1부터)이다. 구간이 없는 대안은 빼고 만든다.
  - `buildPlan`은 마지막에 `parsePlan`을 통과시킨다. 통과하지 못하면 `"invalid"`.
  - `parsePlacesState`는 장소를 하나씩 읽는다. 읽지 못한 장소만 버리고 나머지는 살린다(환경설정처럼 전체를 초기화하지 않는다. 사용자가 등록한 것이기 때문이다). 버전이 다르거나 JSON이 깨졌으면 빈 상태.
  - `remove`는 그 장소의 `planId`를 `pendingDeletes`에 넣는다.

- [ ] **Step 1: 실패하는 테스트**
  - `route-draft.test.ts`: 구간을 더하면 도보가 `[5, 5]` → `[5, 3, 5]`가 된다. 가운데 구간을 빼면 도보 길이가 구간 수 + 1이다. 사용자가 고친 도보 값은 구간을 더해도 남는다. `setWalk`는 0 미만과 60 초과를 0과 60으로 맞춘다. `buildPlan`: 구간 없는 기본 경로 `no-leg`, 구간 5개 `too-many-legs`, 대안 4개 `too-many-routes`, 요일 없음 `no-day`. 정상 입력은 `parsePlan`을 통과하고 `timezone`이 `DEFAULT_TIMEZONE`, `leadMinutes`가 `DEFAULT_LEAD_MINUTES`, `rank`가 0, 1, 2다. 버스 하차 `seq`가 승차보다 작으면 `invalid`.
  - `places.test.ts`: 저장했다 읽으면 같다. 한 장소의 `plan`이 깨졌으면 그 장소만 빠진다. 버전 2면 빈 상태. null이면 빈 상태.
  - `places-store.test.ts`: `upsert`, `remove`(→ `pendingDeletes`), `markSynced`, `subscribe`가 바뀔 때만 불린다. 새 저장소를 같은 kv로 만들면 값이 남아 있다.
  - `plan-headers.test.ts`: 회사 "출근 · 회사까지", 학교 "등교 · 학교까지", 집 "퇴근 · 집까지", 기타(이름 "헬스장") "헬스장까지". 모르는 `planId`는 null.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/places` / Expected: FAIL.
- [ ] **Step 3: 구현** — `@Betro/commute`를 의존성에 더하고 `bun install`. Metro가 워크스페이스 패키지의 `exports`(`./src/*.ts`)를 읽는지 `cd apps/native && bunx expo export --platform ios --output-dir <임시 폴더>`로 본다. 읽지 못하면 `metro.config.js`의 해석 설정을 고치고, 그것도 안 되면 `parsePlan`을 쓰지 않고 타입만 가져온 뒤 한도 검사를 `route-draft.ts`에 둔다(이 경우 이 문서에 적는다).
- [ ] **Step 4: 통과 확인** — 세 게이트와 위 `expo export`.
- [ ] **Step 5: 커밋** — `feat(native): store places and build commute plans from route drafts`

---

### Task 5: 서버에 올리기, 지우기, 맞추기

**Files:**
- Create: `apps/native/lib/places/plan-sync.ts`, `plan-sync.test.ts`, `apps/native/lib/places/app-places.ts`(앱 전체가 쓰는 저장소 하나)
- Modify: `apps/native/app/_layout.tsx`(등록 뒤와 앱이 앞으로 올 때 `reconcile`)

**Interfaces:**
- Consumes: Task 4의 저장소, `ServerClient`, `CommuteActivity.setPlanHeaders`
- Produces:
  ```ts
  interface SyncDeps { client: ServerClient; now: () => number; setHeaders: (headers: Record<string, string>) => Promise<void>; store: PlacesStore; t }
  type SaveResult = "saved" | "pending" | "limit" | { rejected: string[] };
  savePlace(deps: SyncDeps, place: Place): Promise<SaveResult>
  deletePlace(deps: SyncDeps, placeId: string): Promise<"deleted" | "pending">
  reconcile(deps: SyncDeps): Promise<{ imported: number; pushed: number; removed: number } | "offline">
  ```
  - `savePlace`: `sync: "pending"`으로 기기에 쓴 뒤 `PUT`. 204 → `markSynced`, `"saved"`. 400 → `{ rejected: issues }`(기기에는 `pending`으로 남는다). 409(새 장소를 올릴 때만 난다) → 기기에서 그 장소를 지우고 `"limit"`. 0, 401, 5xx → `"pending"`.
  - `deletePlace`: 기기에서 지우고(`pendingDeletes`에 들어감) `DELETE`. 204, 404 → `clearPendingDelete`, `"deleted"`. 그 밖 → `"pending"`.
  - `reconcile` 순서: ① `pendingDeletes`를 하나씩 `DELETE` ② `sync: "pending"`인 장소를 `PUT` ③ `GET /v1/commute/plans` ④ 서버에만 있는 예약(`pendingDeletes`에 없는 것)을 종류 `other`, 이름 ""인 장소로 가져온다(화면에서는 "가져온 경로"로 보인다) ⑤ 기기에 `synced`로 있는데 서버에 없는 장소는 `pending`으로 바꾸고 `PUT` ⑥ `setHeaders(headersOf(...))`. ③이 실패하면 `"offline"`을 주고 ④⑤를 하지 않는다. 같은 `planId`가 두 번 생기지 않는다.
  - 저장·삭제가 끝날 때마다 `setHeaders`를 부른다.

- [ ] **Step 1: 실패하는 테스트** — 가짜 `ServerClient`(요청 기록, 응답 지정)와 메모리 kv로:
  - `savePlace`: 204, 400(문구 배열 그대로), 409(기기에 남지 않음, `pendingDeletes`에도 들어가지 않음), 0(기기에 `pending`).
  - `deletePlace`: 204, 404, 0(→ `pendingDeletes`에 남음).
  - `reconcile`: 밀린 삭제와 밀린 저장을 먼저 보낸다. 서버에만 있는 예약 1개를 가져온다. `pendingDeletes`에 있는 `planId`는 가져오지 않는다(Review Focus 1). 기기에만 있는 `synced` 장소를 다시 올린다(Review Focus 2). 두 번 연달아 돌려도 장소 수가 같다. `GET`이 0이면 `"offline"`이고 기기 상태가 그대로다. 끝에 `setHeaders`가 `planId → 머리줄` 전체로 한 번 불린다.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/places/plan-sync.test.ts` / Expected: FAIL.
- [ ] **Step 3: 구현** — `_layout.tsx`: `createRegistrationFlow`의 `onRegistered` 뒤와 `AppState` `active`에서 `reconcile`을 부른다. 겹쳐 돌지 않게 하고, 실패는 `reportError(appCrashSink, error, "places-sync")`로 남긴다.
- [ ] **Step 4: 통과 확인** — 세 게이트.
- [ ] **Step 5: 커밋** — `feat(native): sync commute plans with the server and reconcile after reinstall`

---

### Task 6: 화면 부품

**Files:**
- Create: `apps/native/components/ui/{top-bar,section,chip,stepper,text-field,empty-state}.tsx`, `components/transit/line-badge.tsx`, `apps/native/lib/transit/line-badge-model.ts`와 테스트
- Modify: `app/(tabs)/settings.tsx`(`Section`을 가져다 쓰게), `app/settings/data-sources.tsx`(`TopBar`를 가져다 쓰게)

**Interfaces:**
- Consumes: Task 1의 컴포넌트 시안, `theme/tokens.ts`의 `TRANSIT_COLORS`
- Produces:
  - `TopBar({ title, onBack?, trailing? })`, `Section({ title, children })`, `Chip({ label, selected, onPress })`, `Stepper({ value, min, max, onChange, label })`, `TextField({ value, onChangeText, placeholder, accessibilityLabel, returnKeyType? })`, `EmptyState({ title, body, action? })`
  - `type LineBadgeInput = { mode: "bus"; routeType: string; region: "seoul" | "gyeonggi" | "incheon"; name: string } | { mode: "subway"; line: string; name: string }`
  - `lineBadgeModel(input: LineBadgeInput): { colorToken: string; label: string; regionKey: MessageKey | null }`
  - 등록된 구간(`Leg`)에는 `routeType`과 `region`이 없다. `Place`의 구간에서 배지를 만들 때 버스는 `routeType` "3"(간선), `region` "seoul"로 두고 이름만 보여 준다. 정확한 색은 조회 결과가 있는 구간 고르기 화면에서만 쓴다.
  - `LineBadge(props)`: 모델을 그린다. 배지에는 항상 글자가 있다.
  - `routeType` → 색: 1 airport, 2 village, 3 trunk, 4 branch, 5 circular, 6 express. 7·8은 express 색에 지역 라벨("인천", "경기")을 붙인다. 모르는 값은 trunk.

- [ ] **Step 1: 실패하는 테스트** — `line-badge-model.test.ts`: `routeType` 1~8과 모르는 값, 지하철 `seoul-subway:line2`와 모르는 노선 키. 경기·인천은 `regionKey`가 있고 서울은 null이다.
- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/transit` / Expected: FAIL.
- [ ] **Step 3: 구현** — 부품은 Task 1의 Figma 컴포넌트를 `get_design_context`로 읽어 기존 부품(`ListRow`, `AppButton`)과 같은 방식으로 만든다. `settings.tsx`와 `data-sources.tsx`는 화면이 그대로 보여야 한다.
- [ ] **Step 4: 통과 확인** — 세 게이트. `bun run theme:css`를 돌려 생성 파일이 바뀌지 않는지 본다(토큰을 고쳤다면 함께 커밋).
- [ ] **Step 5: 커밋** — `feat(native): add shared parts for the commute screens`

---

### Task 7: 15 내 장소

**Files:**
- Create: `apps/native/lib/places/place-card-model.ts`와 테스트, `components/places/place-card.tsx`
- Modify: `app/(tabs)/commute.tsx`, `lib/i18n/messages-ko.ts`(`places.*`)

**Interfaces:**
- Consumes: `usePlaces()`, `lineBadgeModel`, Task 9의 진행 중 세션 조회(`useActiveSession`, 이 Task에서는 띠만 쓴다. Task 9보다 먼저 하면 띠는 Task 9에서 붙인다)
- Produces:
  ```ts
  placeCardModel(place: Place, t): {
    alternatives: string | null;        // "대안 2개", 없으면 null
    legs: { badge: LineBadgeInput; from: string; to: string }[];   // 기본 경로의 구간
    notSynced: boolean;
    schedule: string;                   // "평일 08:10 출발"
    title: string;                      // "회사", 기타는 이름, 가져온 경로는 "가져온 경로"
  }
  scheduleLabel(days: number[], leaveMinute: number, t): string
  ```
  요일 문구: 월~금이면 "평일", 토·일이면 "주말", 7일이면 "매일", 그 밖은 "월·수·금"처럼 월요일부터 순서대로. 시각은 24시간 `HH:MM`.

- [ ] **Step 1: 실패하는 테스트** — 요일 조합 5가지, `leaveMinute` 5(→ "00:05")와 1439, 대안 0·1·3개, 구간 2개인 경로, `sync: "pending"`, 이름이 빈 기타 장소.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 화면: 장소가 없으면 `EmptyState`("자주 가는 곳을 등록해 보세요" + "장소 추가"). 있으면 카드 목록과 "장소 추가". 카드를 누르면 `/commute/<placeId>`(17), 연필을 누르면 `/places/<placeId>`(16). 서버에 올라가지 않은 장소에는 "아직 서버에 저장되지 않았어요"를 보인다. 진행 중 세션이 있으면 맨 위에 그 장소로 가는 띠를 둔다.
- [ ] **Step 4: 통과 확인** — 세 게이트. 시뮬레이터에서 빈 상태와 카드 2개 상태를 다크·라이트로 열어 Task 1의 `15 My Places` 프레임과 맞는지 본다.
- [ ] **Step 5: 커밋** — `feat(native): list places on the commute tab`

---

### Task 8: 16 장소 설정과 구간 고르기

**Files:**
- Create: `apps/native/lib/places/setup-draft.ts`, `leg-picker-model.ts`와 각 테스트, `app/places/{new,[placeId],leg}.tsx`, `components/places/{setup-form,route-card,weekday-picker,time-row}.tsx`
- Modify: `app/_layout.tsx`(Stack에 `places/*` 추가, 온보딩 뒤에만), `lib/i18n/messages-ko.ts`(`placeSetup.*`, `legPicker.*`), `apps/native/package.json`(`@react-native-community/datetimepicker`)

**Interfaces:**
- Consumes: Task 3(조회), Task 4(`RouteDraft`, `buildPlan`), Task 5(`savePlace`, `deletePlace`), Task 6(부품)
- Produces:
  ```ts
  // setup-draft.ts — 등록 화면이 열려 있는 동안만 사는 값
  interface SetupDraft { days: number[]; includeHolidays: boolean; kind: PlaceKind; leaveMinute: number; name: string; placeId: string; planId: string; routes: RouteDraft[] }
  createSetupDraft(): { get(): SetupDraft | null; start(place: Place | null, ids: { placeId: string; planId: string }): void; update(patch: Partial<SetupDraft>): void; setRoute(index: number, route: RouteDraft): void; clear(): void; subscribe(fn): () => void }
  // 새 장소의 기본값: kind "work", days [1,2,3,4,5], leaveMinute 490(08:10), includeHolidays false, routes [emptyRoute()]
  // leg-picker-model.ts
  boardChoices(stops: BusStop[]): { disabled: boolean; label: string; stop: BusStop; sub: string | null }[]   // 마지막 정류장은 승차 불가
  alightChoices(stops: BusStop[], board: BusStop): 같은 모양   // seq <= board.seq 는 disabled
  busLeg(route: BusRouteMatch, board: BusStop, alight: BusStop): Leg
  subwayAlightChoices(branches: SubwayBranch[], board: string): { branchKey: string; stations: { disabled: boolean; name: string; stop: string }[] }[]   // 승차역이 없는 지선은 통째로 disabled, 승차역 자신도 disabled
  subwayLeg(line: { line: string; name: string }, board, alight, direction: "up" | "down"): Leg
  ```
  `sub`는 같은 이름이 한 노선에 두 번 나올 때 구분하는 글자(`directionName` 방면, 없으면 정류장 번호 `arsId`)다.

- [ ] **Step 1: 실패하는 테스트**
  - `leg-picker-model.test.ts`: 하차 후보에서 승차와 그 앞 정류장이 `disabled`다(Review Focus 3). 같은 이름 두 정류장의 `sub`가 다르다. 지선이 둘인 노선에서 승차역이 없는 지선은 고를 수 없다. `busLeg`와 `subwayLeg`가 만든 구간으로 `buildPlan`이 통과한다. 경기 노선의 `lineName`은 `shortName`이다(지역이 붙은 `name`이 아니다).
  - `setup-draft.test.ts`: 새 장소 기본값, 있는 장소로 시작하면 그 값, `update`와 `setRoute`, `clear` 뒤 `get()`은 null.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
  - 16: 장소 종류 칩 → 이름(기타일 때만, 비면 저장 불가 `name-required`) → 기본 경로 카드(도보 `Stepper`와 탑승 줄, 줄마다 지우기, 구간 4개 미만이면 "구간 추가") → 대안 경로(3개 미만이면 "대안 경로 추가") → 나가는 시각(`TimeRow`가 플랫폼 시각 고르기를 띄운다) + 요일 → "공휴일에도 띄우기" → 안내 문구 → "저장". 고칠 때는 "장소 삭제"(한 번 더 묻는다).
  - 저장: `buildPlan`이 실패하면 사유별 문구를 해당 구역 아래에 보이고 서버를 부르지 않는다. 성공하면 `savePlace`. `"saved"`와 `"pending"`은 15로 돌아가고(`pending`이면 15의 카드에 표시가 보인다), `"limit"`은 "장소는 16개까지 등록할 수 있어요", `rejected`는 "저장하지 못했어요. 경로를 다시 확인해 주세요"를 보인다.
  - 구간 고르기(`leg.tsx`, 한 화면 안에서 단계가 바뀐다): 수단 → (버스) 검색 → 결과 → 승차 → 하차 / (지하철) 노선 → 승차역 → 하차역 → `subwayDirection`. `not-direct`면 "이 두 역은 한 번에 갈 수 없어요. 구간을 나눠서 등록해 주세요"를 보이고 하차역을 다시 고르게 한다. 조회는 `useQuery`로 하고(검색은 입력이 300ms 멈춘 뒤), `offline`·`unavailable`이면 "불러오지 못했어요" + "다시 시도", 결과 0건이면 "찾는 노선이 없어요"를 보인다(Review Focus 4). 다 고르면 `setRoute`로 임시 값에 쓰고 돌아간다.
  - 검색 결과 줄: `LineBadge` + 노선 이름 + 지역 라벨. 번호가 같은 노선이 지역으로 구분된다.
- [ ] **Step 4: 통과 확인** — 세 게이트. `bunx expo prebuild --clean -p ios` 뒤 시뮬레이터 빌드가 된다(새 네이티브 의존성). 로컬 서버(2-D 데이터가 든 로컬 D1)로 6411 "노량진역 → 고속터미널" 경로와 2호선 "강남 → 교대" 경로를 등록해 본다. Expected: `PUT /v1/commute/plans/<id>` 204, 다시 열면 같은 값이 보인다.
- [ ] **Step 5: 커밋** — `feat(native): register places with hand-picked routes and a leave time`

---

### Task 9: 17 출퇴근 안내

**Files:**
- Create: `apps/native/lib/commute/session-client.ts`, `guide-model.ts`와 각 테스트, `lib/commute/use-active-session.ts`, `app/commute/[placeId].tsx`, `components/commute/{session-card,route-compare-row}.tsx`
- Modify: `app/_layout.tsx`(Stack에 `commute/[placeId]`), `app/(tabs)/commute.tsx`(진행 중 띠), `lib/i18n/messages-ko.ts`(`commuteGuide.*`)

**Interfaces:**
- Consumes: Task 2의 응답, `parseContentState`, `lockScreenModel`, Task 4의 `Place`
- Produces:
  ```ts
  // session-client.ts
  interface ActiveSessionView { content: ContentState; planId: string; routes: SessionRouteView[]; sessionId: string }
  fetchActiveSession(client): Promise<{ ok: true; session: ActiveSessionView | null } | { ok: false; reason: "offline" | "invalid" }>
  endSession(client, sessionId: string): Promise<"ok" | "ended" | "failed">   // POST …/input { kind: "end" }. 204, 404·409, 그 밖
  // guide-model.ts
  guideModel(input: { now: number; place: Place; session: ActiveSessionView | null; t; timezone: string }): {
    kind: "active"; card: LockScreenModel;   // card.nextLegs·moreLegs 도 그대로 그린다
    others: { arrival: string | null; badge: LineBadgeInput[]; diff: string | null; tag: "live" | "estimated" }[];
  } | {
    kind: "idle"; next: string;        // "평일 08:10에 나가요 · 08:00부터 잠금화면에 떠요"
    routes: { badge: LineBadgeInput[]; summary: string }[];
  }
  ```
  - 세션의 `planId`가 이 장소의 것이 아니면 `idle`이다.
  - `others`는 등록한 대안만, `rank` 순서로 넣는다. `arrival`은 목적지 도착 예상("08:41 도착"), 없으면 null. `diff`는 기본 경로와의 차이("6분 빨리", "3분 늦게")이고 둘 중 하나라도 예상이 없거나 차이가 1분 미만이면 null이다.
  - 버튼은 "안내 종료" 하나이고 모든 단계에서 보인다. `card.actions`는 17에서 쓰지 않는다.
  - `next`의 두 번째 시각은 나가는 시각에서 `leadMinutes`를 뺀 것이고, 자정을 넘으면 "전날 23:55부터"로 쓴다(Review Focus 5).

- [ ] **Step 1: 실패하는 테스트**
  - `session-client.test.ts`: `session: null`, 정상, `content`가 파싱되지 않는 응답(`invalid`), `status` 0. `endSession` 204 / 409 / 404 / 500, 본문 `kind`가 `"end"`.
  - `guide-model.test.ts`: 세션 없음 → `idle`과 `next` 문구(08:10 → "08:00부터", 00:05 → "전날 23:55부터"). 다른 장소의 세션 → `idle`. 진행 중 → `card`가 `lockScreenModel`과 같고, 대안 2개가 `rank` 순서로, `diff`가 "6분 빨리" / "3분 늦게" / null(예상 없음) / null(30초 차이). 구간 2개 경로의 첫 구간에서 `card.nextLegs`가 1줄이다.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — `useActiveSession`은 `useQuery`로 화면이 보이는 동안 15초마다 다시 받는다. "안내 종료"를 누르면 `endSession` 뒤 바로 다시 받는다. `"ended"`면 세션 없음 상태로 바꾸고, `"failed"`면 "보내지 못했어요. 다시 눌러 주세요"를 보인다. 누른 직후 화면을 미리 바꾸지 않는다(서버 값만 그린다). `offline`이면 마지막 값을 그대로 두고 "연결을 확인하고 있어요"를 보인다.
- [ ] **Step 4: 통과 확인** — 세 게이트. 로컬 서버(`UPSTREAM_MODE=fixture`, `PUSH_MODE=log`)에 2분 뒤 시작하는 경로를 등록하고 17을 연다. Expected: 시작 전 `idle`, 시작 뒤 세션 카드(환승 경로면 남은 구간 줄)와 "안내 종료"만 보이고 "탔어요", "다음 차 탈게요"는 없다. "안내 종료" 뒤 `idle`.
- [ ] **Step 5: 커밋** — `feat(native): show the active commute and compare registered routes`

---

### Task 10: 배포, 실기기 확인, 문서

선행: 2-D의 조회 API가 데이터와 함께 배포돼 있다(2-D Task 6). 2-F Task 4 이후가 끝났으면 잠금화면까지 함께 보고, 아니면 앱 화면까지만 본다.

**Files:**
- Modify: `apps/native/README.md`(화면과 저장 구조), `apps/server/README.md`(Task 2의 응답), 이 계획 문서("2-E 결과")

- [ ] **Step 1: 서버 배포** — Task 2·2A가 병합된 `develop`에서 `apps/server`의 `bun run deploy`. Expected: `/v1/snapshot/subway` 200, 인증 없는 `/v1/commute/sessions/active` 401.
- [ ] **Step 2: iPhone** — `EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com`으로 빌드해 설치한다. 스펙 7.2의 뒷부분을 끝까지 간다: 내 장소 등록(버스 1구간, 지하철 1구간, 환승 2구간, 경기 노선 1개) → 15에 카드 → 3분 뒤 시작하는 예약 → 17에서 세션 카드와 비교 → "안내 종료". Expected: 각 단계가 시안과 같고, 서버 D1 `commute_plan`에 장소 이름과 주소가 없다.
- [ ] **Step 3: 오프라인과 재설치(Review Focus 1, 2)** — 비행기 모드에서 장소를 저장한다 → 표시가 보인다 → 네트워크를 켜고 앱을 다시 연다 → 표시가 사라지고 서버에 예약이 있다. 앱을 지우고 다시 설치한다 → "가져온 경로" 카드가 예약 수만큼 보인다.
- [ ] **Step 4: Android(S20)** — Step 2와 같은 흐름. 시각 고르기와 뒤로 가기 동작을 본다.
- [ ] **Step 5: 문서와 결과** — README를 고치고 이 문서에 "2-E 결과"(확인한 흐름, 스크린샷 위치, 남은 일)를 적는다.
- [ ] **Step 6: 커밋** — `docs: document the commute screens and record the 2-E run`

---

## Figma 결과 (2026-11-10)

Task 1을 Opus 서브에이전트가 Figma에서 직접 했다. 4.4의 8개 항목이 모두 반영됐고, 지운 문구("다시 찾기", "대체 경로 추천", "출근 알림", "3412", "안내 시작", "도착 알림과 지연 안내", "추천", "약 N분")는 iOS·Android 페이지에 없다. "알림 시간대"는 손대지 않기로 한 로그인 상태 설정 프레임 4개에만 남아 있다. 새 프레임과 컴포넌트에 직접 넣은 색·모서리·글자 크기는 없고 변수도 새로 만들지 않았다(`tokens.ts` 변경 없음). 고치기 전 원본은 `Archive · before 4.4 (2026-11-10)` 페이지(85:18870)에 복제해 두었다. 이름 붙인 버전은 저장하지 못했다(Step 0). **사용자 확인(Step 5)은 아직이다.**

캡처 98장: 세션 임시 폴더 `figma-2e/`(`<platform>-<frame>-<dark|light>.png`).

### 컴포넌트 (`Components` 2:3)

| 컴포넌트 | node | 내용 |
|---|---|---|
| `TabBar` | 5:255 | "알림" → "출퇴근"(route 아이콘), 변형 8개 |
| `BusBadge` | 4:47 | `Show Region`, `Region`("경기"·"인천") 속성. 배지 옆 글자 라벨 |
| `CommuteProgress` | 47:2005 | `Legs=1/2/3`(4·5·6노드) × 단계 4 = 12개. 환승 노드는 arrow-right-left 아이콘 |
| `LiveActivity` | 87:2420 (`탑승 전` 87:2386, `탑승 뒤` 48:1946) | 상태 문장 Title/1, 남은 분 Title/3. 탑승 전에 "탔어요 / 다음 차 탈게요" |
| `LiveUpdate` | 87:19468 (`탑승 전` 87:19405, `탑승 뒤` 48:2001) | 같은 위계. 탑승 전 "탔어요 / 다음 차 탈게요 / 종료", 탑승 뒤 "종료" |
| `Stepper` | 89:2293 | |
| `Weekday`, `WeekdayPicker` | 89:2308, 89:2309 | 선택된 요일은 `bg/inverse` + `text/inverse` |
| `TimeRow` | 89:2324 | |
| `RouteStepRow`(Walk/Ride) | 90:2341 | |
| `PlaceCard`(Registered / Not Synced / Add) | 91:2391 | |
| `EmptyState` | 92:2349 | |
| `RouteResultRow`, `StopRow`(Default/Selected/Disabled) | 92:2366, 92:2392 | 구간 고르기 |
| `RouteCompareRow`, `SessionStrip`, `InlineNotice` | 93:2367, 93:2382, 93:2397 | 17 비교 줄, 15 진행 중 띠, 안내 상자 |

### 화면 (다크 / 라이트)

| 프레임 | iOS | Android |
|---|---|---|
| 02 Permissions | 12:3140 / 100:40467 | 12:4888 / 100:42741 |
| 12 Settings (게스트) | 43:34948 / 43:35115 | 43:35335 / 43:35404 |
| 15 My Places | 28:31887 / 100:40493 | 28:31618 / 100:42769 |
| 15 빈 상태 | 95:19643 / 100:40506 | 100:37986 / 100:42782 |
| 15 안내 중(띠) | 95:19680 / 100:40514 | 100:38066 / 100:42790 |
| 16 Place Setup(새 장소) | 28:31994 / 100:40527 | 28:31722 / 100:42803 |
| 16 고치기(아래쪽, 장소 삭제) | 96:24698 / 100:40572 | 100:38387 / 100:42848 |
| 16 기타(이름 입력) | 96:24780 / 100:40601 | 100:38457 / 100:42877 |
| 16a Leg · Mode | 97:19439 / 100:40639 | 100:38536 / 100:42915 |
| 16b Bus Route(결과) | 97:19573 / 100:40653 | 100:38908 / 100:42929 |
| 16b 결과 없음 | 97:19658 / 100:40668 | 100:38964 / 100:42944 |
| 16b 불러오지 못함 | 97:19720 / 100:40675 | 100:39012 / 100:42951 |
| 16c Stops 승차 | 98:19645 / 100:40682 | 100:39060 / 100:42958 |
| 16c Stops 하차 | 98:19744 / 100:40719 | 100:39138 / 100:42995 |
| 16d Subway 노선 | 98:19891 / 100:40754 | 100:39366 / 100:43030 |
| 16d Subway 승차역 | 99:19860 / 100:40790 | 100:39443 / 100:43066 |
| 16d Subway 하차역(한 번에 갈 수 없어요) | 99:19958 / 100:40830 | 100:39524 / 100:43106 |
| 17 Commute Guide(탑승 전) | 29:33232 / 100:40873 | 29:16602 / 100:43149 |
| 17 탑승 뒤 | 100:20190 / 100:40891 | 100:39667 / 100:43167 |
| 17 세션 없음 | 100:20395 / 100:40907 | 100:39724 / 100:43183 |
| 18 Live Activity 정류장 대기 / 탑승 중 / 대안 제안 / 나가기 전 | 49:18579, 49:18700, 49:18832, 100:20690 (라이트 100:42362, 100:42369, 100:42376, 100:42383) | — |
| 19 Dynamic Island | 49:18907 / 100:42390 | — |
| 18 Live Update 대기 / 탑승 중 / 대안 제안 / 나가기 전 | — | 49:35786, 49:35918, 49:36048, 100:40350 (라이트 100:43204, 100:43211, 100:43221, 100:43228) |

### 계획과 달라진 것

- 16은 한 화면에 다 들어가지 않아 프레임 3개다(새 장소 위쪽, 고치기 아래쪽, 기타). "저장"은 아래에 붙어 있다.
- 16의 대안 경로는 접힌 줄(배지, 정류장, 도보 시간, 화살표)로 보이고, 누르면 기본 경로와 같은 카드로 고친다.
- 17의 세션 카드는 `LiveActivity` 인스턴스(버튼 줄 숨김)다. 앱의 큰 버튼은 카드 아래에 있다.
- 잠금화면 카드의 상세 줄은 Body/M이다(남은 분만 Title/3). 순서는 상태 → 남은 분 → 상세다.
- **iOS 잠금화면 카드가 버튼을 넣으면 212~262px로, Live Activity 높이 한도(160pt)를 넘는다.** 2-F Task 4에서 탑승 전 카드를 줄여야 한다(진행 표시나 제안 줄을 빼는 식). 사용자 결정이 필요하다.
- 고정폭 숫자 설정은 Figma에 넣지 않았다. 코드에서 `data*` 글자 모양(`tabular-nums`)을 쓴다.
- "계획 중 확인한 사실" 표의 43:34987, 43:35154는 게스트 설정 프레임이 아니라 그 안의 "알림 시간대" 줄이었다. 프레임은 위 표의 node다.
- 2-F 계획의 Review Focus 5는 구간이 늘 때 노드가 2개씩 는다고 적었지만, 시안은 이 계획대로 4·5·6노드(환승 정류장이 노드 하나)다. 2-F Task 2의 `progress.nodes`와 맞는지 2-F Task 4에서 확인한다.
