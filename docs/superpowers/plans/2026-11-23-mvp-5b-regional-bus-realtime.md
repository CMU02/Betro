# MVP 5-B 경기·인천 버스 실시간 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5-A에서 "실시간 정보 없음"으로 둔 GBIS(경기)·TAGO(인천) 버스 구간에 실시간을 붙입니다. 출퇴근 세션은 공식 도착 예측으로 ETA를 내고, 지도는 그 경로를 보는 동안 차량을 그립니다.

**Architecture:** 두 갈래로 나뉩니다. 서울 버스와 같은 분담입니다.
- **출퇴근 실행기(Part A).** 도착 오퍼레이션과 실행기 몫의 위치 오퍼레이션을 직접 부릅니다. 받은 값을 서울과 같은 `RouteStopArrival[]` 꼴로 바꿔 기존 `busBoards`에 넣습니다.
- **수집기(Part B).** 지도에서 보는 동안만(heartbeat) 위치 오퍼레이션을 부릅니다. 받은 값은 기존 `BusObservation` 스냅샷에 출처 키를 붙여 싣습니다.

Part A만으로도 배포할 수 있고, 출시 조건(7.1)이 걸린 쪽이라 먼저 합니다.

**Tech Stack:** TypeScript, Bun test, Cloudflare Workers + Durable Objects, D1, Expo(React Native, Hermes).

**Spec:** 별도 설계 문서는 없습니다. 근거는 다음 문서이고, 이 계획의 "설계 결정"이 그 사이를 메웁니다.
- `docs/superpowers/specs/2026-11-05-mvp-design.md` 3장 "버스 범위"
- `docs/superpowers/specs/2026-11-20-mvp4-map-design.md` 2.7, 8장 순서 2
- `docs/research/2026-11-06-mvp2-experiments.md` 1절
- 이 계획의 Task 2가 연구 문서에 옮기는 "5-B 확인" 절
- 앞 단계 계획: `docs/superpowers/plans/2026-11-20-mvp-5a-regional-bus-static.md`

## 5-B 확인 (2026-11-23 17:32~17:38 KST 프로브)

GBIS는 수원 13번(`200000037`), TAGO는 인천 82번(`ICB361000005`)으로 확인했습니다. 승차 순번은 15, 하차 순번은 35로 두고 50초 간격으로 6번 불렀습니다. 원본은 `/private/tmp/claude-501/-Users-choehyeonjun-Project-Betro/b9e08893-d299-484f-9778-9b58664e5477/scratchpad/probe5b/out/`에 있고, 키는 가려 두었습니다.

1. **GBIS 도착의 차량 위치가 위치 목록과 맞습니다.** `getBusArrivalItemv2`의 `staOrder − locationNoN`이 같은 `vehIdN`의 `getBusLocationListv2` `stationSeq`와 24건 모두 같았습니다. 도착 응답에는 `vehId1/2`, `plateNo1/2`, `predictTimeSec1/2`, `locationNo1/2`, `flag`, `turnSeq`가 있습니다.
2. **하차 정류소 도착에는 탄 차가 나오지 않습니다.** 도착 응답은 그 정류소에 가장 가까운 두 대만 줍니다. 승차 정류소의 첫 차(순번 12)는 하차 정류소(35)의 도착 응답에 6번 모두 없었습니다(그 사이에 다른 차가 있었습니다). 그래서 **탄 뒤의 진행은 위치 목록으로** 따라갑니다.
3. **GBIS 차량이 5분 동안 그대로인 경우가 있습니다.** `vehId 200011170`은 6번 모두 순번 12, `stateCd 0`, 예측 491~507초였습니다. 원천이 멈춘 것인지 실제 정체인지 응답만으로는 가릴 수 없습니다. 이 계획은 "멈춘 차량" 기준으로 다룹니다(설계 결정 6).
4. **TAGO는 게이트웨이 오류가 잦습니다.**
   - 프로브 18번 중 11번이 약 6~9초 뒤 `OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode "04"`(`HTTP_ERROR`)였습니다.
   - 따로 http와 https를 10번씩 번갈아 불렀을 때 http 4/10, https 2/10이 같은 오류였습니다. https로 바꾼 탓은 아닙니다.
   - 2026-11-09 실험(40번 중 1번)보다 훨씬 잦습니다. 이 계획은 이것을 일시 오류로 다룹니다(설계 결정 5).
5. **TAGO 도착에는 차량 식별자가 없습니다.**
   - `arrprevstationcnt`(몇 정거장 전)와 `arrtime`(초)만 옵니다.
   - `정류장 nodeord − arrprevstationcnt`를 위치 목록의 `nodeord`와 맞춰 보면, 같은 시각에 받은 6쌍 중 정확히 맞은 것이 3쌍이고 나머지는 1~2 정거장 차이였습니다. 위치가 늦게 갱신되기 때문입니다(실험 1절).
6. **TAGO 위치 응답:** `gpslati`, `gpslong`(문자열일 때가 있음), `nodeid`, `nodeord`, `vehicleno`. 수신 시각은 없습니다.
7. **차량이 없는 TAGO 노선(강화 마을 `ICB169000021`):** 이번에는 게이트웨이 오류 `04`가 왔습니다. 빈 응답(`items: ""`)은 5-A 파서처럼 `no-data`로 봅니다.

## 설계 결정

[설계 판단]으로 표시한 것은 이 계획이 정한 것입니다. 사용자가 검토 때 바꿀 수 있습니다.

1. **오퍼레이션마다 쓰는 쪽과 몫을 정합니다. [설계 판단]** 개발 계정 한도는 오퍼레이션마다 하루 GBIS 1,000건, TAGO 10,000건입니다. 두 Durable Object가 같은 오퍼레이션을 부르면 몫을 나눠 합이 한도 밑이 되게 합니다.

   | 오퍼레이션 | 실행기 | 수집기 | 합 |
   |---|---|---|---|
   | GBIS `getBusArrivalItemv2` | 900 | - | 900 |
   | GBIS `getBusLocationListv2` | 600 | 300 | 900 |
   | TAGO `getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList` | 9,000 | - | 9,000 |
   | TAGO `getRouteAcctoBusLcList` | 6,000 | 3,000 | 9,000 |

   모든 값은 환경 변수로 바꿀 수 있게 하고, 운영 계정으로 바꾸면 늘립니다. 지도 용도(`map`)의 실행기 호출은 서울과 같은 규칙으로 세션 몫(3분의 1)을 남깁니다.

2. **세션 용량(개발 계정).** 실행기는 GBIS·TAGO 구간 하나에 대해 poll마다 다음을 부릅니다.
   - 승차 전: 승차 정류소 도착 1건(TAGO는 차량 번호를 붙이려고 위치 목록 1건을 더 부릅니다)
   - 탄 뒤: 하차 정류소 도착 1건과 위치 목록 1건
   - poll 간격은 서울과 같습니다(`busPollMs` 60초, 가까우면 `busNearPollMs` 30초).

   30분짜리 세션 구간 하나는 약 40 poll이라, 도착 약 40건과 위치 약 20건을 씁니다. 그래서 GBIS는 하루에 세션 구간 약 22개(도착 900 ÷ 40)를 받칩니다. 개발과 혼자 하는 실사용 검증에는 충분하고, 출시 전에는 운영 계정이 필요합니다. 같은 구간을 보는 세션이 여럿이어도 같은 노선·정류소 호출은 한 번만 합니다(서울과 같은 캐시).

3. **출처마다 따로 멈춥니다. [설계 판단]**
   - GBIS의 한도 초과나 인증 실패는 그날 GBIS 호출만 멈춥니다. 서울 버스와 TAGO는 계속 돕니다(실행기 `stopped:<source>:<day>`, 수집기 예산 종류별 stop).
   - 멈춘 출처의 구간은 5-A의 배차간격 추정("시간표 추정")으로 돌아갑니다. 실시간으로 표시하지 않습니다.

4. **서울 키는 그대로 두고, 지역 노선만 출처를 붙인 키를 씁니다. [설계 판단]**
   - 서울은 지금처럼 맨 ID(`100100290`)를 씁니다. DO 상태와 앱이 읽는 스냅샷을 옮기지 않기 위해서입니다.
   - GBIS·TAGO는 `gbis:<routeId>`, `tago:<routeId>`를 씁니다. 이 키가 수집기 감시, 스케줄 키 `bus:gbis:…`, `LatestState`, 스냅샷 `routeId`, 실행기 원자료에 그대로 쓰입니다.
   - GBIS 노선 ID는 서울 ID와 같은 값일 수 있습니다. 그래서 겹치는 경우를 테스트로 막습니다.

5. **TAGO 게이트웨이 오류 `04`는 일시 오류입니다. [설계 판단]**
   - 재시도는 서울과 같은 백오프로 한 번만 하고, 예산은 시도마다 셉니다.
   - 실패한 poll은 직전 원자료를 지우지 않습니다. 실행기와 지도는 직전 값을 기존 묵음(stale) 기준까지 씁니다.
   - 호출마다 8초 제한을 둡니다(`REGIONAL_FETCH_TIMEOUT_MS = 8_000`). 오류가 약 8초 뒤에 오므로, 한 tick이 늘어지지 않게 하려는 것입니다.

6. **멈춘 차량. [설계 판단]** GBIS·TAGO에는 출처 수신 시각이 없습니다. 그래서 "얼어붙은 원천이 신선해 보이는" 실패(MVP 설계 실패 기준)를 차량별 마지막 변화 시각으로 막습니다.
   - **실행기:** 차량의 `seqNow`가 `FROZEN_VEHICLE_MS = 300_000`(5분)보다 오래 그대로면 그 차량을 도착판에서 뺍니다. 다음 차량이 있으면 그 차량을, 없으면 배차간격 추정을 씁니다.
   - **수집기:** 위치(순번과 좌표)가 5분보다 오래 그대로인 차량은 스냅샷에서 뺍니다.
   - 예측 초는 보지 않습니다. 프로브의 멈춘 차량도 예측 초는 491~507초로 흔들렸기 때문입니다.
   - 실험의 최대 변화 간격(GBIS 120초, TAGO 좌표 419초)보다 짧지 않은 값으로 잡았습니다. TAGO도 좌표가 아니라 순번 변화로 봅니다.

7. **TAGO 차량 식별. [설계 판단]**
   - 도착의 차량 위치 `seqNow = nodeord − arrprevstationcnt`를 같은 poll의 위치 목록과 맞춥니다. `seqNow` 이하이면서 차이가 2 이하인 가장 가까운 차량의 `vehicleno`를 `vehicleId`로 씁니다. 가까운 순서대로, 한 차량은 한 번만 씁니다.
   - 맞는 차량이 없으면 `vehicleId = "tago-pos:<seqNow>"`입니다. 이 ID는 poll마다 바뀔 수 있습니다. 그래서 그 차량으로는 진행을 따라가지 못하고, 승차 ETA만 공식 값으로 씁니다.

8. **GBIS 지도 위치. [설계 판단]** GBIS 위치에는 좌표가 없습니다.
   - `stationSeq` 구간의 시작 거리(`segmentsBySeq.get(seq).startM`)에서 노선 모양 위의 좌표를 구합니다.
   - `qualityFlags`에 `position-from-stop`을 붙입니다. `stateCd`는 쓰지 않습니다.
   - 두 출처 모두 `no-source-time`을 붙이고 `sourceAt`은 마지막 변화 시각입니다.

9. **방향 이름. [설계 판단]** 5-A 적재는 GBIS·TAGO 정류장의 `directionName`을 null로 둡니다. 그래서 왕복 노선에서 차량 시트의 방향이 틀립니다(서울에서 고친 문제와 같습니다). 열은 이미 있으므로 마이그레이션 없이 적재만 고칩니다.
   - **GBIS:** `seq < turnSeq`인 정류장은 회차 정류장 이름을 씁니다. 나머지는 마지막 정류장 이름을 씁니다.
   - **TAGO:** `updowncd`가 같은 연속 구간마다 그 구간의 마지막 정류장 이름을 씁니다.
   - `turnSeq`나 `updowncd`가 없으면 지금처럼 null입니다.

   이 작업은 5-A 브랜치에서 11/24 적재 전에 합니다(Task 1).

10. **지도의 "실시간 정보 없음".**
    - 5-B 뒤에는 GBIS·TAGO 구간도 차량을 그립니다.
    - 버스 스냅샷에 `stoppedSources: ("gbis" | "tago")[]`를 더합니다. 그날 멈춘 출처의 구간에만 `map.noRealtime`을 띄웁니다.
    - 접두사만 보고 막던 `NO_LIVE_PREFIXES`는 없앱니다.
11. **상시 관측은 하지 않습니다.** 수집기의 `prod` 상시 목록은 그대로 `source = 'seoul'`입니다. GBIS·TAGO 노선은 지도 감시(heartbeat)로만 부릅니다(지도 설계 2.7).

## Global Constraints

- 커밋 메시지와 PR 본문에 AI 서명·출처 표기(`Claude-Session:`, `Co-Authored-By: Claude`, 세션 URL)를 넣지 않습니다.
- `DATA_GO_KR_API_KEY`, `SEOUL_OPEN_API_KEY`를 화면, 로그, R2, 문서, 픽스처, 테스트 이름에 남기지 않습니다. URL을 로그에 쓸 때는 `maskKey`나 `redactKeys`를 거칩니다.
- 앱(`apps/native`)에는 ES2023 배열 메서드(`toSorted`, `toReversed`, `toSpliced`, `findLast`, `findLastIndex`)를 쓰지 않습니다. 기기의 Hermes에 없습니다(`lib/hermes-compat.test.ts`).
- 린트 게이트: `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`. 루트에서 `bunx ultracite fix/check`는 돌리지 않습니다.
- 브랜치: Task 1은 `feat/regional-bus-static`에 커밋합니다. Task 2부터는 그 위에서 만든 `feat/regional-bus-realtime`에 커밋합니다.
- 서울 버스의 동작, 키, 스냅샷 모양을 바꾸지 않습니다. 기존 서울 테스트가 그대로 통과해야 합니다.
- 주석과 테스트 이름은 기존 코드처럼 한국어로 씁니다.

## Review Focus

1. **멈춘 차량:** GBIS 차량이 5분 넘게 같은 순번이면(예측 초가 조금씩 흔들려도), 실행기는 그 ETA를 계속 약속하지 않고 다음 차량이나 배차간격 추정으로 넘어가야 합니다. 지도는 그 차량을 지워야 합니다. 테스트는 Task 5, Task 8에 있습니다.
2. **TAGO 게이트웨이 `04`:** 출처를 멈추지 않고 일시 오류로 셉니다. 직전 도착판은 묵음 기준까지 남깁니다. 테스트는 Task 3(분류), Task 6(실행기)에 있습니다.
3. **출처 격리:** GBIS 한도 초과가 서울 버스와 TAGO를 멈추지 않아야 합니다. 테스트는 Task 6(실행기), Task 9(수집기)에 있습니다.
4. **ID 충돌:** `gbis:100100290`과 서울 `100100290`(6411)이 실행기 원자료, 수집기 감시·스냅샷, 앱 `busVehiclesForLeg`에서 섞이지 않아야 합니다. 테스트는 Task 5, Task 9, Task 10에 있습니다.
5. **물러섬:** 지역 원자료가 없거나 출처가 멈추면, 그 구간은 `method: "headway"`("시간표 추정")가 되고 실시간으로 표시하지 않아야 합니다. 지도는 그 출처만 `map.noRealtime`입니다. 테스트는 Task 5, Task 10에 있습니다.

---

## Part A: 정적 보완과 출퇴근 실행기

### Task 1: 지역 노선의 방향 이름 (5-A 브랜치, 11/24 적재 전)

**Files:**
- Modify: `packages/transit-static/src/sources/tago-api.ts`. `parseTagoRouteStations`가 `updowncd`를 `RegionalStopRow.upDown: number | null`로 읽습니다.
- Modify: `packages/transit-static/src/sources/regional-bus-types.ts`. `RegionalStopRow`에 `upDown: number | null`을 더합니다. GBIS 파서는 null을 넣습니다.
- Modify: `packages/transit-static/src/bus/regional.ts:150`. `directionName: null` 대신 `regionalDirectionNames(stops, turnSeq)`를 씁니다.
- Test: `packages/transit-static/src/bus/regional.test.ts`, `packages/transit-static/src/sources/tago-api.test.ts`

**Interfaces:**
- Produces: `export function regionalDirectionNames(stops: readonly { seq: number; name: string; upDown: number | null }[], turnSeq: number | null): (string | null)[]`. 결과는 seq 순으로 정렬된 입력과 같은 순서입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("GBIS는 회차 순번 앞은 회차 정류장, 뒤는 마지막 정류장 이름이다", () => {
	const stops = [1, 2, 3, 4].map((seq) => ({ name: `s${seq}`, seq, upDown: null }));
	expect(regionalDirectionNames(stops, 3)).toEqual(["s3", "s3", "s4", "s4"]);
});
it("TAGO는 updowncd 구간마다 그 구간의 마지막 정류장 이름이다", () => {
	const stops = [[1, 0], [2, 0], [3, 1], [4, 1]].map(([seq, upDown]) => ({ name: `s${seq}`, seq, upDown }));
	expect(regionalDirectionNames(stops, null)).toEqual(["s2", "s2", "s4", "s4"]);
});
it("회차 순번도 updowncd도 없으면 null이다", () => {
	const stops = [1, 2].map((seq) => ({ name: `s${seq}`, seq, upDown: null }));
	expect(regionalDirectionNames(stops, null)).toEqual([null, null]);
});
```

tago-api.test.ts에는 `tago-route-stations.json` 첫 정류장이 `upDown: 0`인지 보는 단언을 더합니다. 그 픽스처에 `updowncd`가 있는지 먼저 확인하고, 없으면 인라인 JSON으로 대신합니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `cd packages/transit-static && bun test src/bus/regional.test.ts src/sources/tago-api.test.ts`
Expected: FAIL. `regionalDirectionNames`가 export되지 않았다는 오류가 나옵니다.

- [ ] **Step 3: 구현합니다.** GBIS 회차 순번은 노선 정보(`RegionalRouteInfo.turnSeq`)에서 받습니다. 경유 정류장 행에도 `turnSeq`가 있으면 노선 정보 값을 먼저 씁니다.

- [ ] **Step 4: 통과를 확인하고, 실제 원본으로 dry-run해 방향 이름이 채워지는지 봅니다**

Run: `cd packages/transit-static && bun test && BETRO_DATA_DIR=/Users/choehyeonjun/Project/Betro/data bun --env-file=/Users/choehyeonjun/Project/Betro/packages/transit-static/.env run src/cli.ts build:bus-routes --dry-run | grep -E '적재 가능'`
Expected: 테스트가 전부 통과합니다. dry-run의 적재 가능 수는 2026-11-23 보고서(서울 674/674, tago 325/325)와 같습니다. GBIS가 아직 모자라 `ok: false`인 것은 정상입니다.

- [ ] **Step 5: 커밋합니다** (`feat/regional-bus-static`)

```bash
git add packages/transit-static/src
git commit -m "fix(static): name regional bus directions from turnSeq and updowncd"
git switch -c feat/regional-bus-realtime
```

### Task 2: 프로브 기록과 픽스처

**Files:**
- Modify: `docs/research/2026-11-06-mvp2-experiments.md`. 1절 끝에 "5-B 확인 (2026-11-23)" 절을 더합니다. 내용은 이 계획의 "5-B 확인" 1~7을 측정값 그대로 옮깁니다.
- Create: `packages/commute/src/sources/__fixtures__/regional/`. 프로브 원본에서 아래 파일을 `{ at, status, body }` 꼴 그대로 복사합니다. 이름은 다음과 같습니다.
  - `gbis-arrival-board.json` (r0-gArrBoard)
  - `gbis-arrival-alight.json` (r0-gArrAlight)
  - `gbis-location.json` (r0-gLoc)
  - `tago-arrival-board.json` (r0-tArrBoard)
  - `tago-arrival-alight.json` (r0-tArrAlight)
  - `tago-location.json` (r0-tLoc)
  - `tago-gateway-04.json` (r1-tLoc)
- Create: `packages/realtime/src/__fixtures__/regional/`. `gbis-location.json`, `tago-location.json`, `tago-gateway-04.json`을 같은 원본에서 복사합니다.
- Create: `packages/commute/src/sources/__fixtures__/regional/stops.json`. 픽스처 노선의 순번 15·35 정류장 ID를 담습니다(GBIS `stationId`, TAGO `nodeid`). 원본은 `data/raw/gbis-route-stations/200000037.json`, `data/raw/tago-route-stations/ICB361000005.json`입니다.

- [ ] **Step 1: 복사한 픽스처에 키가 없는지 확인합니다**

Run: `grep -rlF "$(grep '^DATA_GO_KR_API_KEY=' /Users/choehyeonjun/Project/Betro/packages/transit-static/.env | cut -d= -f2- | head -c 12)" packages/commute/src/sources/__fixtures__/regional packages/realtime/src/__fixtures__/regional; echo "matches=$?"`
Expected: `matches=1`. 파일 목록 없이 이 한 줄만 나옵니다. 명령은 키 앞 12자를 화면에 찍지 않습니다.

- [ ] **Step 2: 커밋합니다** (`feat/regional-bus-realtime`, Task 1 끝에 만든 브랜치)

```bash
git add docs/research/2026-11-06-mvp2-experiments.md packages/commute/src/sources/__fixtures__/regional packages/realtime/src/__fixtures__/regional
git commit -m "docs(research): record 5-B realtime probe of GBIS and TAGO"
```

### Task 3: 지역 실시간 파서 (commute 패키지)

**Files:**
- Create: `packages/commute/src/sources/regional-bus.ts`
- Test: `packages/commute/src/sources/regional-bus.test.ts`

**Interfaces:**
- Produces:

```ts
export type RegionalSource = "gbis" | "tago";
export type RegionalFail = "no-data" | "temporary" | "quota" | "auth" | "malformed";
export type RegionalResult<T> = { ok: true; value: T } | { ok: false; reason: RegionalFail };
export interface RegionalStop { seq: number; stopId: string }
export interface RegionalPosition { vehicleId: string; plate: string; seq: number }
export function gbisArrivalUrl(key: string, routeId: string, stop: RegionalStop): string;
export function gbisLocationUrl(key: string, routeId: string): string;
export function tagoArrivalUrl(key: string, cityCode: string, routeId: string, stop: RegionalStop): string;
export function tagoLocationUrl(key: string, cityCode: string, routeId: string): string;
export function parseGbisArrival(json: unknown, stop: RegionalStop, fetchedAt: number): RegionalResult<RouteStopArrival>;
export function parseGbisLocations(json: unknown): RegionalResult<RegionalPosition[]>;
/** vehicleId는 비워 둔다(""). `matchTagoVehicles`가 채운다. */
export function parseTagoArrival(json: unknown, stop: RegionalStop, fetchedAt: number): RegionalResult<RouteStopArrival>;
export function parseTagoLocations(json: unknown): RegionalResult<RegionalPosition[]>;
export function matchTagoVehicles(arrival: RouteStopArrival, positions: readonly RegionalPosition[]): RouteStopArrival;
export const TAGO_MATCH_TOLERANCE = 2;
```

- 주소는 `https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalItemv2`(`routeId`, `stationId`, `staOrder`, `format=json`)와 `…/buslocationservice/v2/getBusLocationListv2`(`routeId`, `format=json`)입니다. TAGO는 `https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList`(`cityCode`, `nodeId`, `routeId`, `numOfRows=20`, `_type=json`)와 `…/BusLcInfoInqireService/getRouteAcctoBusLcList`(`cityCode`, `routeId`, `numOfRows=200`, `_type=json`)입니다.
- GBIS 도착 차량은 `vehicleId = String(vehIdN)`, `plate = plateNoN`, `etaSec = predictTimeSecN`, `seqNow = staOrder − locationNoN`, `isArrived = locationNoN === 0`, `lastOfDay = false`입니다. 정류장 값은 `madeAt = fetchedAt`, `headwayMin = null`입니다. 차량은 `etaSec` 오름차순입니다.
- TAGO 도착 차량은 `etaSec = arrtime`, `seqNow = stop.seq − arrprevstationcnt`, `plate = ""`입니다. 항목이 객체 하나로 오면 배열로 감쌉니다.
- 실패 봉투:
  - `OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode`가 `"22"`면 quota, `"20"`·`"30"`~`"33"`이면 auth, 그 밖(`"04"` 포함)은 temporary입니다. 5-A `readGatewayFailure`와 같은 표를 이 파일에 둡니다. commute 패키지는 transit-static에 의존하지 않습니다.
  - GBIS `resultCode` 4와 TAGO `"03"` 또는 `items: ""`는 no-data입니다.
  - 모양이 다르면 malformed입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다.** 픽스처는 Task 2의 `__fixtures__/regional/*.json`(`body`를 JSON.parse)을 씁니다.

```ts
it("GBIS 도착의 차량 순번은 staOrder − locationNo이고 위치 목록과 같다", () => {
	const arrival = ok(parseGbisArrival(body("gbis-arrival-board.json"), { seq: 15, stopId: "202000224" }, AT));
	expect(arrival.vehicles.map((v) => [v.vehicleId, v.seqNow, v.etaSec])).toEqual([["200011170", 12, 491], ["200010795", 8, 734]]);
	const positions = ok(parseGbisLocations(body("gbis-location.json")));
	expect(positions.find((p) => p.vehicleId === "200011170")?.seq).toBe(12);
});
it("TAGO 도착은 차이 2 이하의 가장 가까운 위치 차량 번호를 붙이고, 없으면 tago-pos다", () => {
	const arrival = ok(parseTagoArrival(body("tago-arrival-board.json"), { seq: 15, stopId: "ICB364000528" }, AT));
	const matched = matchTagoVehicles(arrival, ok(parseTagoLocations(body("tago-location.json"))));
	expect(matched.vehicles.map((v) => [v.seqNow, v.vehicleId])).toEqual([[13, "tago-pos:13"], [3, "인천71바6272"]]);
});
it("TAGO 게이트웨이 04는 temporary, 22는 quota, 30은 auth다", () => {
	expect(parseTagoLocations(body("tago-gateway-04.json"))).toEqual({ ok: false, reason: "temporary" });
	expect(parseTagoLocations(gateway("22"))).toEqual({ ok: false, reason: "quota" });
	expect(parseTagoLocations(gateway("30"))).toEqual({ ok: false, reason: "auth" });
});
it("주소는 https이고 키는 serviceKey로만 들어간다", () => { /* 네 URL 모두 startsWith("https://apis.data.go.kr/") */ });
```

기대값의 근거: 2정거장 전 차량은 seqNow 13이고, 위치 목록의 이웃(3, 15) 중 13 이하이면서 차이 2 이내인 것이 없습니다. 12정거장 전 차량은 seqNow 3이고, 위치 목록의 3과 맞습니다. 정렬은 `etaSec` 오름차순입니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `cd packages/commute && bun test src/sources/regional-bus.test.ts`
Expected: FAIL. 모듈을 찾지 못한다는 오류가 나옵니다.

- [ ] **Step 3: `regional-bus.ts`를 구현합니다.** zod 스키마를 쓰는 `seoul-bus.ts`의 방식을 따릅니다.

- [ ] **Step 4: 통과를 확인합니다**

Run: `cd packages/commute && bun test src/sources`
Expected: PASS. 기존 테스트도 모두 통과합니다.

- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/sources/regional-bus.ts packages/commute/src/sources/regional-bus.test.ts
git commit -m "feat(commute): parse GBIS and TAGO arrivals and bus locations"
```

### Task 4: 위치 목록을 받는 도착판

**Files:**
- Modify: `packages/commute/src/sources/seoul-bus.ts`. `busBoards`에 네 번째 인자를 더합니다.
- Test: `packages/commute/src/sources/seoul-bus.test.ts`

**Interfaces:**
- Produces: `busBoards(prev: RouteStopArrival[] | null, now: RouteStopArrival[], fetchedAt: number, positions?: ReadonlyMap<string, number>): BusBoards`
  - `positions`는 차량 ID에서 지금 순번으로 가는 맵입니다. 도착에서 얻은 `seqNowOf`보다 우선합니다.
  - `progress`에서 `farthestFirst`가 null이면, `seqNow`를 알고 `pacePerStopMs`가 있을 때 `etaAt = fetchedAt + (alightSeq − seqNow) × pacePerStopMs`, `method: "extrapolated"`로 냅니다.
  - `positions`를 넘기지 않으면 동작은 지금과 똑같습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("도착판에 없는 차량도 위치 목록의 순번으로 하차까지 남은 정거장과 외삽 ETA를 낸다", () => {
	// 승차 정류장(15) 도착에는 차량 A가 순번 12, 3정거장 전 180초로 나온다(정거장당 60초).
	// 하차 정류장(35) 도착에는 A가 없다. 위치 목록에서 A는 순번 20이다.
	const boards = busBoards(null, [stopAt(15, [veh("A", 12, 180)]), stopAt(35, [veh("B", 30, 120)])], T0, new Map([["A", 20], ["B", 30]]));
	expect(boards.progress("A", 35)).toEqual({ etaAt: T0 + 15 * 60_000, method: "extrapolated", stopsAway: 15 });
});
it("positions가 없으면 지금과 같다", () => { /* 기존 progress 테스트 하나를 positions 없이 그대로 다시 단언 */ });
```

`pacePerStopMs`(`routePacePerStopMs`)가 이 입력에서 60초를 내는지 먼저 확인합니다. 다르게 계산되면 기대값을 그 값으로 맞추고, 어떤 값을 쓰는지 테스트 주석에 적습니다.

- [ ] **Step 2: 실패를 확인합니다** `cd packages/commute && bun test src/sources/seoul-bus.test.ts`. Expected: FAIL. 첫 테스트에서 null이 나옵니다.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd packages/commute && bun test`. Expected: PASS.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(commute): let bus boards follow vehicles from a location list"`

### Task 5: 지역 버스 어댑터와 멈춘 차량 (assemble)

**Files:**
- Modify: `packages/commute/src/sources/assemble.ts`
- Create: `packages/commute/src/sources/frozen.ts`
- Test: `packages/commute/src/sources/assemble.test.ts`, `packages/commute/src/sources/frozen.test.ts`

**Interfaces:**
- Consumes: `busBoards(…, positions)` (Task 4), `RouteStopArrival`, `RegionalPosition` (Task 3)
- Produces:

```ts
// RawBoards에 더한다. 키는 전체 노선 ID(`gbis:200000037`). 서울 `bus`와 섞이지 않는다.
regionalBus?: Record<LineRef, { fetchedAt: number; now: RouteStopArrival[]; prev: RouteStopArrival[] | null; positions: Record<string, number> }>;
// frozen.ts
export const FROZEN_VEHICLE_MS = 300_000;
export interface VehicleSeen { seqNow: number; since: number }
/** 차량 ID → 순번이 마지막으로 바뀐 시각. 예측 초는 보지 않는다. */
export function updateSeen(prev: Readonly<Record<string, VehicleSeen>>, arrivals: readonly RouteStopArrival[], now: number): Record<string, VehicleSeen>;
/** since가 FROZEN_VEHICLE_MS보다 오래된 차량을 도착에서 뺀다. */
export function dropFrozen(arrivals: readonly RouteStopArrival[], seen: Readonly<Record<string, VehicleSeen>>, now: number): RouteStopArrival[];
```

- `Adapter`의 `scheduled-bus`는 `regional-bus`로 바꿉니다. `raw.regionalBus?.[leg.line]`가 있으면 `busBoards(prev, now, fetchedAt, new Map(Object.entries(positions)))`로 `board`·`progress`·`rideMs`를 냅니다. 없으면 지금의 `scheduled-bus`처럼 board는 null이고 `scheduledHeadwayMs`만 냅니다.
- 캐시 키는 `leg.line`입니다(서울 `busCache`와 따로 둡니다).

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("gbis 구간은 서울 원자료에 같은 ID가 있어도 regionalBus만 본다", () => {
	// raw.bus["100100290"]에는 서울 6411 도착, raw.regionalBus["gbis:100100290"]에는 다른 차량
	const boards = assembleBoards(rawWith({ seoul6411: seoulArrivals, regional: { "gbis:100100290": regionalArrivals } }), config);
	expect(boards.board(regionalLeg("gbis:100100290"), "board")?.approaching[0]?.vehicleId).toBe("G1");
});
it("regionalBus가 없으면 board는 null이고 배차간격 추정만 남는다", () => {
	const boards = assembleBoards(rawWith({ schedules: { "gbis:1": tenMinute } }), config);
	expect(boards.board(regionalLeg("gbis:1"), "board")).toBeNull();
	expect(boards.scheduledHeadwayMs?.(regionalLeg("gbis:1"), NOON)).toBe(600_000);
});
// frozen.test.ts
it("예측 초가 흔들려도 순번이 5분 넘게 그대로인 차량은 빠지고 다음 차량이 남는다", () => {
	let seen = updateSeen({}, [stop15([v("A", 12, 491), v("B", 8, 734)])], T0);
	seen = updateSeen(seen, [stop15([v("A", 12, 507), v("B", 9, 650)])], T0 + 301_000);
	expect(dropFrozen([stop15([v("A", 12, 507), v("B", 9, 650)])], seen, T0 + 301_000)[0]?.vehicles.map((x) => x.vehicleId)).toEqual(["B"]);
});
```

- [ ] **Step 2: 실패를 확인합니다** `cd packages/commute && bun test src/sources`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** `dropFrozen`은 실행기(Task 6)가 원자료를 저장하기 전에 부릅니다. assemble은 이미 걸러진 원자료만 봅니다.
- [ ] **Step 4: 통과를 확인합니다** `cd packages/commute && bun test`. Expected: PASS.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(commute): board GBIS and TAGO legs from regional arrivals"`

### Task 6: 실행기가 지역 도착·위치를 모읍니다

**Files:**
- Modify: `apps/server/src/commute/ports.ts`. `BoardSource`에 메서드를 더하고, `UpstreamStoppedError`에 `source`를 더합니다.
- Modify: `apps/server/src/commute/cf-ports.ts`. 구현과 `regionalRouteCities`(D1 `bus_route.source_city`)를 둡니다.
- Modify: `apps/server/src/commute/runner-core.ts`. 다음 부분을 고칩니다.
  - `#boardTargets`(L1011)
  - 새 `#collectRegionalBus`
  - 출처별 예산과 멈춤 키
  - `#routeView` 경로(L677)
- Modify: `packages/commute/src/config.ts`. 출처별 예산 값을 더합니다. 기본값은 설계 결정 1을 따릅니다.
- Modify: `apps/server/src/worker-env.ts`, 실행기 설정을 읽는 곳. 아래 환경 변수를 선택 값으로 읽습니다.
  - `DAILY_BUDGET_GBIS_ARRIVAL`
  - `DAILY_BUDGET_GBIS_LOCATION_RUNNER`
  - `DAILY_BUDGET_TAGO_ARRIVAL`
  - `DAILY_BUDGET_TAGO_LOCATION_RUNNER`
- Test: `apps/server/src/commute/runner-core.test.ts`, `apps/server/src/commute/cf-ports.test.ts`

**Interfaces:**
- Consumes: Task 3 URL·파서, Task 5 `RawBoards.regionalBus`·`updateSeen`·`dropFrozen`
- Produces:

```ts
// ports.ts
export interface RegionalRouteRef { source: RegionalSource; routeId: string; cityCode: string | null }
// BoardSource에 더한다. 상류를 한 번만 부른다. 일시 오류면 null, 그날 멈출 오류면 UpstreamStoppedError(outcome, source).
regionalArrival: (route: RegionalRouteRef, stop: RegionalStop) => Promise<RouteStopArrival | null>;
regionalLocations: (route: RegionalRouteRef) => Promise<RegionalPosition[] | null>;
// RunnerPorts에 더한다.
regionalRouteCities: (lines: LineRef[]) => Promise<Record<LineRef, string | null>>;
// UpstreamStoppedError
constructor(outcome: "auth" | "quota-exhausted", source: "seoul-bus" | RegionalSource = "seoul-bus")
```

- 예산 키는 `budget:<source>-<op>:<day>`입니다(`op` = `arrival` | `location`). 멈춤 키는 `stopped:<source>:<day>`입니다. 서울의 `budget:<day>`, `stopped:<day>`는 그대로 둡니다.
- poll마다 승차 전 구간은 승차 정류장 도착을, 탄 구간(따라가는 차량이 있는 구간)은 하차 정류장 도착과 위치 목록을 부릅니다. 간격과 near 판단은 서울과 같습니다(`busPollMs`, `busNearPollMs`, `busNearWindowMs`).
- 같은 노선·정류장은 tick 안에서 한 번만 부릅니다.
- TAGO는 도착을 저장하기 전에 같은 poll의 위치로 `matchTagoVehicles`를 거칩니다. 위치 호출이 실패하면 모두 `tago-pos:`가 됩니다.
- 저장 전에 `dropFrozen`을 거칩니다. `VehicleSeen`은 `regionalSeen:<line>`에 둡니다.
- 일시 오류(null)면 직전 원자료를 그대로 둡니다. 호출마다 `REGIONAL_FETCH_TIMEOUT_MS = 8_000`으로 끊습니다(`AbortSignal.timeout`).
- `cityCode`가 null인 TAGO 노선은 부르지 않고 배차간격 추정으로 둡니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다** (runner-core.test.ts. `FakeBoards`에 `regionalArrival`·`regionalLocations` 핸들러와 호출 기록을 더합니다)

```ts
it("gbis 구간 세션은 승차 정류장 도착을 부르고 ETA가 official이다", async () => { /* regionalLeg() 세션 → regionalCalls에 {source:"gbis", stop seq 15}; 추정 method "official" */ });
it("GBIS 한도 초과는 GBIS만 그날 멈추고 서울 버스 구간은 계속 부른다", async () => {
	// regionalArrival이 UpstreamStoppedError("quota-exhausted","gbis")를 던진다
	// 다음 tick: regionalCalls 0, busCalls(서울 6411) ≥ 1, gbis 구간 method "headway"
});
it("TAGO 일시 오류(null)는 멈추지 않고 직전 도착판을 남긴다", async () => { /* 첫 tick ok, 둘째 tick null → 둘째 tick 추정 method "official" 유지, stopped 키 없음 */ });
it("출처별 하루 예산을 다 쓰면 그 출처만 부르지 않는다", async () => { /* config.dailyBudgetGbisArrival = 1 → 둘째 poll에서 gbis 호출 없음, 서울은 계속 */ });
it("탄 뒤에는 하차 정류장 도착과 위치 목록을 부른다", async () => { /* 탑승 판정된 세션 → stop seq 35 도착 + locations 1 */ });
```

cf-ports.test.ts:

```ts
it("regionalRouteCities는 tago 노선의 source_city를 읽는다", async () => { /* 시드된 tago 행 → "23" */ });
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/commute`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd apps/server && bun test src/commute && cd ../../packages/commute && bun test`. Expected: PASS.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(commute): poll GBIS and TAGO arrivals for regional bus legs"`

Part A가 끝나면 서버 배포만으로 출퇴근 카드의 GBIS·TAGO 구간이 실시간 ETA를 씁니다. 지도는 Part B 전까지 "실시간 정보 없음"을 유지합니다.

---

## Part B: 지도 차량

### Task 7: 수집기용 지역 위치 파서 (realtime 패키지)

**Files:**
- Create: `packages/realtime/src/upstream/regional-position.ts`
- Test: `packages/realtime/src/upstream/regional-position.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RegionalPositionRow { vehId: string; plate: string; seq: number; lat: number | null; lng: number | null }
export type RegionalOutcome = "ok" | "no-data" | "temporary" | "rate-limited" | "quota-exhausted" | "auth" | "malformed";
export function gbisPositionUrl(key: string, routeId: string): string;
export function tagoPositionUrl(key: string, cityCode: string, routeId: string): string;
export function parseRegionalPositions(source: "gbis" | "tago", status: number, body: string): { outcome: RegionalOutcome; rows: RegionalPositionRow[] };
```

- 게이트웨이 코드는 Task 3과 같은 표를 씁니다. 23은 rate-limited, HTTP 429는 quota-exhausted, 401은 auth입니다. 수집기의 기존 `classify.ts` 결과 이름에 맞춥니다.
- GBIS 행은 `lat`·`lng`가 null입니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다.** Task 2의 `packages/realtime/src/__fixtures__/regional/` 세 파일을 씁니다. GBIS 행 15개 중 첫 행이 `{ vehId: "200011171", seq: 3, lat: null }`, TAGO 첫 행의 `lat`이 숫자, 게이트웨이 04는 `temporary`인지 봅니다.
- [ ] **Step 2: 실패를 확인합니다** `cd packages/realtime && bun test src/upstream`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다.** Expected: PASS.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(realtime): parse GBIS and TAGO bus locations"`

### Task 8: 지역 위치 정규화와 멈춘 차량

**Files:**
- Create: `packages/realtime/src/bus/regional-normalize.ts`
- Modify: `packages/realtime/src/reference.ts`. 아래 함수가 없으면 더합니다.
- Test: `packages/realtime/src/bus/regional-normalize.test.ts`

**Interfaces:**
- Produces:

```ts
export const REGIONAL_FROZEN_MS = 300_000;
export interface RegionalPrev { seq: number; lat: number | null; lng: number | null; since: number }
export function normalizeRegionalPositions(routeKey: string, source: "gbis" | "tago", rows: RegionalPositionRow[], ref: BusRouteRef, prev: ReadonlyMap<string, RegionalPrev>, observedAt: number): { observations: BusObservation[]; prev: Map<string, RegionalPrev> };
export function pointAlong(coords: readonly [number, number][], distanceM: number): { lat: number; lng: number } | null; // reference.ts
```

- `routeKey`는 `gbis:200000037`처럼 출처를 붙인 키이고, `BusObservation.routeId`에 그대로 넣습니다.
- `sectOrd = seq`이고, `shapeDistanceM = ref.segmentsBySeq.get(seq)?.startM ?? null`입니다.
- GBIS의 `lat`·`lng`는 `pointAlong(ref.coords, startM)`로 구하고, 플래그 `position-from-stop`을 붙입니다.
- TAGO는 받은 좌표를 그대로 쓰고, `gpsProjectedDistanceM`은 null입니다.
- `sourceAt`은 `since`(마지막 변화 시각)입니다. `sourceAtRaw`는 `""`, `plainNo = plate`이고, 플래그 `no-source-time`을 붙입니다. 좌표를 못 구하면 그 차량을 뺍니다.
- `since`는 seq가 바뀌면 `observedAt`으로 갱신합니다. TAGO는 seq만 보고 좌표 변화는 보지 않습니다(설계 결정 6). `observedAt − since > REGIONAL_FROZEN_MS`인 차량은 결과에서 뺍니다(prev에는 남깁니다).

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("GBIS 차량은 정류장 구간 시작 거리의 노선 좌표에 놓이고 position-from-stop이다", () => { /* 두 정류장 짜리 ref, seq 1 → lat/lng = 첫 좌표, flags ⊇ ["position-from-stop","no-source-time"], routeId "gbis:1" */ });
it("순번이 5분 넘게 그대로인 차량은 빠진다", () => { /* prev since T0, observedAt T0+301_000, 같은 seq → observations 0 */ });
it("순번이 바뀌면 since가 새로워져 남는다", () => { /* seq 바뀜 → observations 1, sourceAt = observedAt */ });
```

- [ ] **Step 2: 실패를 확인합니다** `cd packages/realtime && bun test src/bus`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다** `cd packages/realtime && bun test`. Expected: PASS. 기존 서울 정규화 테스트도 그대로 통과합니다.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(realtime): place GBIS and TAGO vehicles on the route shape"`

### Task 9: 수집기가 지역 노선을 감시합니다

**Files:**
- Modify: `packages/realtime/src/budget.ts`. `BudgetKind`에 `"gbis-position" | "tago-position"`을 더하고 `used`에도 넣습니다. 저장된 옛 상태에 이 키가 없으면 0으로 읽습니다.
- Modify: `packages/realtime/src/schedule.ts`. 다음을 고칩니다.
  - `CollectorConfig.dailyBudget`에 `gbisPosition`·`tagoPosition`을 더합니다(기본 300, 3,000).
  - `CallPlan`에 `{ kind: "regional-bus"; source: "gbis" | "tago"; routeId: string; cityCode: string | null }`을 더합니다.
  - `planKey`는 `bus:gbis:<id>`·`bus:tago:<id>`입니다.
  - 지역 노선은 `extraBusRouteIds`(감시)로만 들어옵니다.
- Modify: `packages/realtime/src/state.ts`. `BusSnapshot`에 `stoppedSources: ("gbis" | "tago")[]`를 더합니다.
- Modify: `apps/server/src/collector/core.ts`. 다음을 고칩니다.
  - `BUS_ROUTE_ID`(L67) 검사를 `^\d+$|^gbis:\d+$|^tago:[A-Z]{3}\d+$`로 바꿉니다.
  - 지역 호출을 처리하고, auth·quota면 그 예산 종류만 `state.stop`합니다.
- Modify: `apps/server/src/collector/upstream-call.ts`. `urlOf`와 `parseCall`에 지역 분기를 더합니다.
- Modify: `apps/server/src/collector/cf-ports.ts`. `loadBus`(L295)가 출처를 붙인 키를 받아 `source`별로 읽고, `source_city`를 싣습니다. `currentBusRouteIds`(L329)는 그대로 둡니다. `fixtureUpstream`(L461)은 `regional/` 픽스처를 돌려줍니다.
- Modify: `apps/server/src/collector/apply-call.ts`. 지역 결과를 `normalizeRegionalPositions`로 넘기고, `RegionalPrev`를 상태에 둡니다.
- Test: `apps/server/src/collector/core.test.ts`, `apps/server/src/collector/cf-ports.test.ts`, `packages/realtime/src/schedule.test.ts`, `packages/realtime/src/budget.test.ts`

**Interfaces:**
- Consumes: Task 7 `parseRegionalPositions`·URL, Task 8 `normalizeRegionalPositions`
- Produces: 스냅샷 `vehicles[].routeId`가 지역 노선이면 `gbis:<id>`/`tago:<id>`이고, 새 필드 `stoppedSources`가 있습니다. 서울 차량은 지금과 같습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("gbis:100100290 감시는 서울 100100290과 다른 스케줄 키와 차량 키를 쓴다", async () => { /* 둘 다 감시 → 호출 URL 하나는 ws.bus.go.kr, 하나는 6410000; 스냅샷 routeId "100100290"과 "gbis:100100290"이 모두 있다 */ });
it("GBIS 한도 초과는 gbis-position만 멈추고 서울 버스는 다음 tick에도 부른다", async () => { /* stoppedSources ["gbis"] */ });
it("숫자가 아닌 tago 키도 감시를 받는다", async () => { /* watchBusRoutes(install, ["tago:ICB361000005"]) → 거절 없음 */ });
it("prod 상시 목록에는 지역 노선이 들어가지 않는다", async () => { /* currentBusRouteIds 결과에 gbis·tago 없음(기존 테스트 확장) */ });
it("옛 예산 상태(gbis-position 없음)를 읽어도 0으로 시작한다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/collector && cd ../../packages/realtime && bun test`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.**
- [ ] **Step 4: 통과를 확인합니다.** 같은 명령에서 Expected: PASS.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(collector): watch GBIS and TAGO routes while a map views them"`

### Task 10: 지도 감시 경로와 앱

**Files:**
- Modify: `apps/server/src/map/routes.ts`. `busRouteIdsOf`(L45)가 `seoul-bus:` 참조는 맨 ID로, `gbis:`·`tago:` 참조는 그대로 넘깁니다(`NUMERIC_ID` 검사는 서울에만 씁니다).
- Modify: `apps/native/lib/map/regional-legs.ts`. `NO_LIVE_PREFIXES`를 없앱니다. `mapLegFlags(route, hidden, stoppedSources)`는 그 출처가 멈췄을 때만 `realtime: false`입니다. `watchRefsOf`는 `gbis:`·`tago:` 노선도 냅니다.
- Modify: `apps/native/lib/map/map-client.ts`. 스냅샷 스키마에 `stoppedSources: z.array(z.enum(["gbis","tago"])).default([])`를 더합니다.
- Modify: `apps/native/lib/map/leg-vehicles.ts:35`. `busVehiclesForLeg`가 `vehicleRouteKey(leg.line)`와 비교합니다. 서울은 맨 ID, 지역은 전체 참조입니다.
- Modify: `apps/native/lib/map/use-map-data.ts:391`. `mapLegFlags`에 스냅샷의 `stoppedSources`를 넘깁니다.
- Test: `apps/server/src/map/routes.test.ts`, `apps/native/lib/map/regional-legs.test.ts`, `apps/native/lib/map/leg-vehicles.test.ts`, `apps/native/lib/map/map-client.test.ts`

**Interfaces:**
- Produces: `export function vehicleRouteKey(line: LineRef): string`(`leg-vehicles.ts`), `mapLegFlags(route, hidden, stoppedSources: readonly ("gbis" | "tago")[])`

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("watch는 gbis·tago 참조를 출처 키로 수집기에 넘긴다", async () => { /* body {busRoutes:["seoul-bus:100100290","gbis:100100290","tago:ICB361000005"]} → watchBusRoutes ids ["100100290","gbis:100100290","tago:ICB361000005"] */ });
it("gbis 구간에는 같은 숫자의 서울 차량이 붙지 않는다", () => { /* vehicles routeId "100100290"(서울)과 "gbis:100100290" → gbis 구간은 뒤의 것만 */ });
it("gbis가 멈춘 날에만 gbis 구간이 noRealtime이고 tago는 차량을 그린다", () => {});
it("stoppedSources가 없는 옛 스냅샷도 읽는다", () => {});
```

- [ ] **Step 2: 실패를 확인합니다** `cd apps/server && bun test src/map && cd ../native && bun test lib/map`. Expected: FAIL.
- [ ] **Step 3: 구현합니다.** 앱에는 ES2023 배열 메서드를 쓰지 않습니다.
- [ ] **Step 4: 통과를 확인합니다** `cd apps/native && bun test lib`. Expected: PASS. `hermes-compat` 테스트도 통과합니다.
- [ ] **Step 5: 커밋합니다** `git commit -m "feat(map): draw GBIS and TAGO vehicles while a route is open"`

### Task 11: 전체 확인, 배포, 기기 확인

- [ ] **Step 1: 전체 테스트와 린트를 돌립니다**

Run: 각 패키지에서 `bun test`(`packages/commute`, `packages/realtime`, `packages/transit-static`, `apps/server`(`src`), `apps/native`(`lib`)), 그리고 `bunx biome ci --changed --since=origin/develop --no-errors-on-unmatched`, `bun run check-types`.
Expected: 실패 0, 린트 오류 0.

- [ ] **Step 2: 원격 배포는 사용자 확인 뒤에 합니다.** 순서는 다음과 같습니다.
  - 5-A의 원격 반영(migration 0008, `publish:d1 --remote`)이 먼저입니다.
  - 그다음 `wrangler deploy`입니다.
  - 배포 뒤 `COLLECTOR_MODE=dev`에서 GBIS 노선 하나를 지도에서 열어, Worker에서 GBIS가 불리는지 확인합니다(Worker 출구로 GBIS를 부른 적이 아직 없습니다).
- [ ] **Step 3: 기기에서 확인합니다.** iOS는 시뮬레이터, Android는 S20 실기기입니다. Metro는 `EXPO_PUBLIC_SERVER_URL=https://betro.cmu02-studio.com`으로 띄웁니다.
  - 경기 노선(예: 수원 13)이 들어간 테스트 장소를 등록합니다. 출퇴근 카드가 "시간표 추정"이 아니라 실시간 ETA를 내는지 봅니다.
  - 지도에서 그 경로를 열면 차량이 그려지는지, "실시간 정보 없음"이 사라졌는지 봅니다. 인천 노선도 같은 방식으로 봅니다.
  - 확인이 끝나면 테스트 장소를 지웁니다.
- [ ] **Step 4: 확인 결과를 이 계획 끝에 적고 커밋합니다.**
