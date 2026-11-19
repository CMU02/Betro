# 여유를 담은 출발 시각 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 잠금화면에 등록한 나가는 시각을 그대로 두고, 빠듯할 때만 "08:08에 나가면 여유 있어요"를 보여 준다. 그 판단을 기록해 실제 도착과 비교한다.

**Architecture:**
- **서버 세션(`packages/commute`)**: 매 tick `advance`가 여유 판단(`LeaveView`)을 세션 상태에 남깁니다. `buildContent`가 그것을 푸시 값 두 필드로 옮깁니다.
- **보낼지 판단**: "지금 화면에 남은 문장"과 "새 문장"을 비교합니다.
- **실행기(`apps/server`)**: 보낸 뒤 조기 탑승 기준과 `leave` 기록을 남기고, 경계 시각에 알람을 맞춥니다.
- **앱 JS**: 같은 문구 규칙으로 그립니다.
- **여유 폭**: 수집기 기록을 오프라인 스크립트로 계산해 설정값에 넣습니다.

**Tech Stack:** TypeScript, Bun test, Cloudflare Workers/Durable Objects, Expo(React Native), Biome(Ultracite), Figma MCP

**Spec:** [`docs/superpowers/specs/2026-11-16-accuracy-first-design.md`](../specs/2026-11-16-accuracy-first-design.md)(이하 "스펙"). MVP 설계 [`2026-11-05-mvp-design.md`](../specs/2026-11-05-mvp-design.md) 4.3·5.3·5.4·7.1도 함께 읽습니다.

## Global Constraints

**문구**
- `commute.lock.status.beforeLeaveSafe` = `{safeLeave}에 나가면 여유 있어요`
- `commute.lock.status.beforeLeaveTight` = `{leave}에 나가면 빠듯해요`
- 기존 `beforeLeave` = `{leave}에 나가세요`, `detail.beforeLeave` = `{stop} · {eta} 탑승`은 그대로 둡니다.
- "놓쳤어요", "늦었어요", "놓쳐요", "넉넉해요"는 쓰지 않습니다.

**경계와 값**
- 부등호: 화면이 `safe`인 조건은 어디서나 `now < safeLeaveEpoch`입니다. 나가는 시각이 보이는 조건은 `now < leaveEpoch`입니다(JS, 서버, 이후 Swift 모두).
- `ContentState.v`는 1 그대로입니다. 새 필드 `leaveSlack`, `safeLeaveEpoch`는 선택 필드이고, 없으면(`undefined`) `null`과 같습니다.

**설정 기본값**

| 설정 | 기본값 |
|---|---|
| `leaveMarginSec` | `{ bus: 180, subway: 120 }`(임시값, 주석에 "사전 수집 전 임시값" 명시) |
| `leaveMarginByLine` | `{}`(키는 `LineRef`) |
| `leaveMarginMaxSec` | 300 |
| `leaveSlackHysteresisSec` | 30 |

**판정과 사전 수집**
- 깜빡임 방지 중 `safeLeave` 상한은 `leaveAt − 60초`입니다.
- 사전 수집: 예측 시점 창 도착 5~15분 전, 표본 100건 이상, 최소 여유 30초, 95번째 백분위수(nearest-rank)입니다.

**작업 규칙**
- 커밋 메시지에 attribution·trailer 줄을 넣지 않습니다.
- 커밋 전에 `bunx ultracite fix`를 돌립니다.
- 작업 브랜치는 worktree `E:/project/Betro-accuracy`의 새 브랜치 `feat/accuracy-leave-margin`(develop 기준)입니다. 스펙 커밋(`docs/accuracy-first`)을 먼저 develop에 넣거나 이 브랜치에 합칩니다.
- Swift(iOS 확장)는 이 계획에서 고치지 않습니다. 2-F Task 4가 Task 8의 "2-F에 넘길 것"을 따릅니다.

## Review Focus

1. **배포 중간에 이미 돌던 세션**: 저장된 `SessionState`에 `leave`·`earlyBoardFrom`이 없고, `lastContent`에 새 필드가 없습니다. 던지지 않고 `null`로 보고 이어 가야 합니다(Task 2, Task 3 테스트).
2. **늦게 시작한 세션**: 첫 tick에 이미 `now ≥ leaveAt`이면 끝까지 `leaveSlack: null`이고, "여유 있어요"가 한 번도 뜨지 않아야 합니다(Task 2 테스트).
3. **시계가 정확히 `safeLeaveEpoch`인 순간**: 서버의 `leaveShownAt`과 JS 모델이 모두 `tight`(빠듯해요)를 내야 합니다(Task 3, Task 7 테스트).
4. **업데이트 토큰 전, 시작 푸시가 `safe`를 실은 iOS 세션**: 시작 푸시에도 `stale-date`가 `safeLeaveEpoch`로 붙어야 합니다(Task 6 테스트).
5. **일찍 탄 뒤의 진행**: `boardedBy: "early"`도 탄 구간으로 세어(`by !== null`) 다음 tick에 탑승 단계가 유지되고, 대안 계산을 멈춰야 합니다(Task 4 테스트).

---

### Task 1: 여유 폭 설정

**Files:**
- Modify: `packages/commute/src/config.ts`
- Test: `packages/commute/src/config.test.ts`

**Interfaces:**
- Produces:
  - `CommuteConfig`에 필드 넷: `leaveMarginSec: { bus: number; subway: number }`, `leaveMarginByLine: Record<string, number>`, `leaveMarginMaxSec: number`, `leaveSlackHysteresisSec: number`
  - `export function marginSecFor(config: CommuteConfig, mode: "bus" | "subway", line: LineRef): number`

- [ ] **Step 1: 실패하는 테스트를 씁니다**

```ts
it("여유 폭 기본값은 임시값 bus 180·subway 120, 상한 300, 깜빡임 30", () => {
	const config = commuteConfig({});
	expect(config.leaveMarginSec).toEqual({ bus: 180, subway: 120 });
	expect(config.leaveMarginByLine).toEqual({});
	expect(config.leaveMarginMaxSec).toBe(300);
	expect(config.leaveSlackHysteresisSec).toBe(30);
});
it("환경 변수 JSON으로 덮어쓰고, 깨진 JSON이면 기본값", () => {
	const config = commuteConfig({
		COMMUTE_LEAVE_MARGIN_SEC: '{"bus":200,"subway":90}',
		COMMUTE_LEAVE_MARGIN_BY_LINE: '{"seoul-subway:line2":75}',
	});
	expect(config.leaveMarginSec).toEqual({ bus: 200, subway: 90 });
	expect(config.leaveMarginByLine).toEqual({ "seoul-subway:line2": 75 });
	expect(commuteConfig({ COMMUTE_LEAVE_MARGIN_SEC: "{" }).leaveMarginSec).toEqual({ bus: 180, subway: 120 });
});
it("marginSecFor: 노선 키가 수단 기본값보다 먼저이고, 상한으로 자른다", () => {
	const config = commuteConfig({ COMMUTE_LEAVE_MARGIN_BY_LINE: '{"seoul-subway:line2":75,"seoul-bus:1":900}' });
	expect(marginSecFor(config, "subway", "seoul-subway:line2")).toBe(75);
	expect(marginSecFor(config, "subway", "seoul-subway:line7")).toBe(120);
	expect(marginSecFor(config, "bus", "seoul-bus:1")).toBe(300);
});
```

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test packages/commute/src/config.test.ts`
Expected: FAIL(`leaveMarginSec` undefined, `marginSecFor` 없음)

- [ ] **Step 3: 구현합니다**

`config.ts`에 다음을 둡니다.
- **환경 변수**: `COMMUTE_LEAVE_MARGIN_SEC`(JSON `{bus, subway}`, 두 키가 모두 유한한 0 이상 숫자일 때만), `COMMUTE_LEAVE_MARGIN_BY_LINE`(기존 `biasFrom`과 같은 방식, 기본 `{}`), `COMMUTE_LEAVE_MARGIN_MAX_SEC`, `COMMUTE_LEAVE_SLACK_HYSTERESIS_SEC`.
- **`marginSecFor`**: 노선 키를 찾고, 없으면 수단 기본값을 씁니다. 그다음 `Math.min(값, leaveMarginMaxSec)`로 자릅니다. 방향 키는 1차 출시에서 찾지 않습니다(스펙 4.3).
- **주석**: 기본값 옆에 "사전 수집(스펙 4.3) 전 임시값. 차량 오차만 덮고 도보 오차는 덮지 않음"을 적습니다.

- [ ] **Step 4: 통과를 확인합니다**

Run: `bun test packages/commute/src/config.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/config.ts packages/commute/src/config.test.ts
git commit -m "feat(commute): add leave margin settings"
```

---

### Task 2: 세션의 여유 판단(`LeaveView`)

**Files:**
- Create: `packages/commute/src/session/leave.ts`
- Create: `packages/commute/src/session/leave.test.ts`
- Modify: `packages/commute/src/session/stage.ts`(`SessionState`, `startSession`, `advance`)
- Test: `packages/commute/src/session/stage.test.ts`

**Interfaces:**
- Consumes: `marginSecFor`(Task 1)
- Produces:

```ts
export interface LeaveView {
	vehicleId: string;
	slack: "roomy" | "tight";
	/** 밀리초. slack이 tight이고 당기는 폭이 상한 안일 때만 값. 분 단위 내림, leaveAt − 60초 이하. */
	safeLeaveAt: number | null;
}
export function nextLeaveView(
	prev: LeaveView | null,
	state: SessionState,
	plan: CommutePlan,
	now: number,
	config: CommuteConfig
): LeaveView | null;
```

- `SessionState`에 선택 필드 둘을 더합니다(옛 저장값 호환). 기본은 `startSession`이 `null`로 채웁니다.
  - `leave?: LeaveView | null`
  - `earlyBoardFrom?: { vehicleId: string; at: number } | null`

- [ ] **Step 1: 실패하는 테스트를 씁니다**

`leave.test.ts` 준비:
- `content.test.ts`의 `at(minute, second)`와 6411 버스 구간을 가져와 씁니다(08:00 = `at(0)`).
- 경로: 첫 도보 5분, `leaveAt = at(10)`, `config = commuteConfig({})`(bus 여유 180초).
- 상태: `stage: "walk"`, `legIndex: 0`, `fixed[0] = "A"`, `passed: null`.
- 기본 경로의 첫 구간 추정: `{ vehicleId: "A", boardEtaAt, etaState: "live", positionState: "live" }`.

| 테스트 이름 | prev | now | boardEtaAt | 기대 |
|---|---|---|---|---|
| 여유 있음 | null | at(5) | at(18) | `{ vehicleId: "A", slack: "roomy", safeLeaveAt: null }` |
| 빠듯, 당긴 시각 | null | at(5) | at(16) | `slack: "tight", safeLeaveAt: at(8)` |
| 분 단위 내림 | null | at(5) | at(16, 30) | `safeLeaveAt: at(8)` |
| 깜빡임 방지로 tight 유지, 상한 leaveAt−60초 | `{A, tight, at(9)}` | at(5) | at(18, 20) | `slack: "tight", safeLeaveAt: at(9)` |
| 30초 넘게 늦어지면 roomy | `{A, tight, at(9)}` | at(5) | at(18, 40) | `slack: "roomy"` |
| 차량이 바뀌면 깜빡임 방지 초기화 | `{B, tight, at(9)}` | at(5) | at(18, 20) | `slack: "roomy"` |
| 당기는 폭 5분 초과면 safeLeaveAt null | null | at(3) | at(12) | `slack: "tight", safeLeaveAt: null` |

`null`을 기대하는 경우(테스트 하나에 묶어도 됩니다):
- `now = at(10)`(= `leaveAt`)
- `etaState: "estimated"`
- `positionState: "stale"`
- `passed: { lineName: "6411" }`
- `boardEtaAt: null`
- `vehicleId: null`
- `stage: "wait"`
- `legIndex: 1`
- `COMMUTE_LEAVE_MARGIN_SEC: '{"bus":0,"subway":0}'`

`stage.test.ts` 추가:
- "늦게 시작한 세션은 끝까지 leave가 null": `leaveAt = at(10)`에 첫 `advance(now = at(11))`, 다음 `advance(at(12))` 모두 `state.leave === null`.
- "옛 저장 상태(leave·earlyBoardFrom 없음)도 advance가 던지지 않는다": 두 키를 지운 상태로 `advance` 한 번, `leave`가 계산됩니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test packages/commute/src/session/leave.test.ts packages/commute/src/session/stage.test.ts`
Expected: FAIL(`leave.ts` 없음)

- [ ] **Step 3: `nextLeaveView`를 구현합니다**

입력:
- 구간 정보: `primaryRoute(plan).legs[0]`의 `mode`와 `line`, 첫 도보 `walkMinutes[0]`
- 추정: `state.estimates.find(rank === 0)?.legs[0]`

계산(스펙 4.2):

```
raw   = boardEtaAt − margin·1000 − firstWalkMs
floor = raw를 분 단위로 내림
rawSlack = leaveAt ≤ raw ? roomy : tight
slack = (prev가 같은 차량의 tight && rawSlack = roomy && raw − leaveAt ≤ 깜빡임·1000) ? tight : rawSlack
tight이면:  leaveAt − floor > 상한·1000 ? null : min(floor, leaveAt − 60_000)
```

- [ ] **Step 4: `advance`에 연결합니다**

`advance`의 마지막 `endIfArrived` 전에 `leave: nextLeaveView(state.leave ?? null, next, plan, now, config)`를 넣습니다. ended·arrived로 가는 길에서는 `leave: null`입니다. `startSession`은 `leave: null`, `earlyBoardFrom: null`로 시작합니다.

- [ ] **Step 5: 통과를 확인합니다**

Run: `bun test packages/commute/src/session/`
Expected: PASS(기존 테스트 포함)

- [ ] **Step 6: 커밋합니다**

```bash
git add packages/commute/src/session/leave.ts packages/commute/src/session/leave.test.ts packages/commute/src/session/stage.ts packages/commute/src/session/stage.test.ts
git commit -m "feat(commute): judge leave slack each tick"
```

---

### Task 3: 푸시 값 두 필드와 보낼지 판단

**Files:**
- Modify: `packages/commute/src/session/content.ts`
- Test: `packages/commute/src/session/content.test.ts`

**Interfaces:**
- Consumes: `SessionState.leave`(Task 2)
- Produces:

```ts
// ContentState에 더함(옛 저장값 호환을 위해 선택 필드)
leaveSlack?: "roomy" | "tight" | null;
safeLeaveEpoch?: number | null;

export type LeaveShown = "roomy" | "safe" | "tight" | "none";
/** atSec(epoch 초)에 기기가 고르는 나가기 전 문장. 스펙 4.5 표. */
export function leaveShownAt(content: ContentState, atSec: number): LeaveShown;
/** now 뒤의 가장 이른 경계(safeLeaveEpoch, leaveEpoch) 밀리초. 없으면 null. */
export function nextLeaveBoundaryMs(content: ContentState, now: number): number | null;
/** iOS stale-date 밀리초. safe를 싣는 값이면 safeLeaveEpoch로 당긴다. */
export function staleAtFor(content: ContentState, now: number, config: CommuteConfig): number;
// SendDecision.reason에 "boundary" 추가
```

- [ ] **Step 1: 실패하는 테스트를 씁니다**

**`buildContent`**
- `state.leave = { A, tight, at(8) }`, `now = at(5)`이면 `leaveSlack: "tight"`, `safeLeaveEpoch: epoch(at(8))`입니다.
- `now = at(10)`이면 두 필드가 `null`입니다.
- `state.leave`가 `undefined`이면 두 필드가 `null`입니다.

**`leaveShownAt`**(`leaveEpoch = at(10)`, walk, 첫 구간)

| `leaveSlack` | `safeLeaveEpoch` | at | 기대 |
|---|---|---|---|
| `tight` | at(8) | at(7, 59) | `"safe"` |
| `tight` | at(8) | **at(8)** | `"tight"`(Review Focus 3) |
| `tight` | `null` | at(5) | `"tight"` |
| `roomy` | - | at(5) | `"roomy"` |
| `null` | - | - | `"none"` |
| `tight` | at(8) | at(5), `etaState: "estimated"` | `"none"` |
| 아무 값 | - | at(10) | `"none"` |
| 아무 값 | - | at(5), `passed`가 있음 | `"none"` |

**`decideSend`**(`config.heartbeatMs` 안, 다른 값은 같다고 둡니다)

| 경우 | 직전 값(보낸 시각) | 새 값(now) | 기대 |
|---|---|---|---|
| 경계: 시계만 넘어감 | tight, safe at(8)(sentAt at(7, 30)) | 같은 값(at(8)) | `{ send: true, priority: 10, reason: "boundary" }` |
| 나가는 시각 경계 | roomy, leaveEpoch at(10)(sentAt at(9, 40)) | 같은 값(at(10)) | `reason: "boundary"`, `priority: 10` |
| 차가 빨라져 safe가 now 앞으로 | safe at(8)(sentAt at(6, 30)) | safe at(7)(at(7, 30)) | `priority: 10`, `reason: "stage"` |
| safe의 분만 바뀜 | safe at(8)(sentAt at(6)) | safe at(7)(at(6, 10)) | `priority: 5`, `reason: "change"` |
| tight가 보이는 동안 분만 바뀜 | tight, safe at(6)(sentAt at(7)) | tight, safe at(5)(at(7, 20)) | `{ send: false }` |
| roomy → safe | roomy | tight, safe at(8)(at(5)) | `priority: 10` |
| 옛 직전 값 | 두 키가 없음 | 두 필드 `null` | `{ send: false }`(Review Focus 1) |

**`nextLeaveBoundaryMs`**(tight, safe at(8), leave at(10))

| now | 기대 |
|---|---|
| at(7) | `at(8)` |
| at(8, 10) | `at(10)` |
| at(10) | `null` |

roomy이면 `leaveEpoch`만 봅니다.

**`staleAtFor`**
- safe at(8), `now = at(6)`이면 `at(8)`입니다. `now + heartbeatMs + tickMs` = at(8, 20)보다 이르기 때문입니다.
- roomy이면 `now + heartbeatMs + tickMs`입니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test packages/commute/src/session/content.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현합니다**

**`leaveShownAt`**: `none`이 되는 경우는 다음과 같습니다.
- `stage !== "walk"`이거나 `legIndex !== 0`
- `leaveEpoch === null`이거나 `atSec ≥ leaveEpoch`
- `passed !== null`
- `etaState === "estimated"`이거나 `positionState !== "live"`
- `leaveSlack`이 `null` 또는 `undefined`

나머지는 표대로입니다. `undefined`는 `null`로 봅니다.

**`decideSend`** 순서:
1. `prev === null`이면 `"stage"`입니다.
2. 기존 `isStageChange`면 `"stage"`입니다.
3. **경계**: 직전 값이 시계만으로 달라지면 `"boundary"`, 10입니다. 판단 기준은 `leaveShownAt(prev, prev.sentAt) ≠ leaveShownAt(prev, nowSec)`, 또는 나가는 시각의 보임(`leaveEpoch !== null && t < leaveEpoch`)이 `prev.sentAt`과 `nowSec`에서 다른 경우입니다.
4. `leaveShownAt(prev, prev.sentAt) ≠ leaveShownAt(next, nowSec)`, 또는 보임이 다르면 `"stage"`, 10입니다.
5. 기존 `isValueChange`, 또는 (`leaveShownAt(next, nowSec) === "safe"`이고 `safeLeaveEpoch`의 분이 다름)이면 `"change"`, 5입니다.
6. heartbeat입니다.

- [ ] **Step 4: 통과를 확인합니다**

Run: `bun test packages/commute/src/session/`
Expected: PASS

- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/session/content.ts packages/commute/src/session/content.test.ts
git commit -m "feat(commute): send leave slack and push at leave boundaries"
```

---

### Task 4: 일찍 나가서 탄 경우의 탑승 판정

**Files:**
- Modify: `packages/commute/src/session/stage.ts`(`checkPassed`, `boardedBy` 타입)
- Modify: `packages/commute/src/session/leave.ts`
- Test: `packages/commute/src/session/stage.test.ts`, `packages/commute/src/session/leave.test.ts`

**Interfaces:**
- Consumes:
  - `LeaveView`, `SessionState.earlyBoardFrom`(Task 2)
  - `leaveShownAt`(Task 3)
- Produces:
  - `SessionState.boardedBy: ("time" | "user" | "early" | null)[]`
  - `export function earlyBoardAfterSend(state: SessionState, sent: ContentState, plan: CommutePlan): SessionState`(`leave.ts`)

- [ ] **Step 1: 실패하는 테스트를 씁니다**

`stage.test.ts`. 준비: `readyAt = at(15)`, `fixed[0] = "A"`, `earlyBoardFrom = { vehicleId: "A", at: at(13) }`. `"A"`가 승차 정류장을 지난 시각에 따라 다음을 기대합니다.

| 지난 시각 | 기대 |
|---|---|
| at(14) | `stage: "ride"`, `boardedBy[0] === "early"`, `readyAt === at(14)` |
| at(16) | `boardedBy[0] === "time"` |
| at(12) | `passed: { lineName: "6411" }`, `fixed[0] === null`, `skip`에 `"A"` |

같은 판정에 대한 두 경우를 더 둡니다.
- `earlyBoardFrom.vehicleId === "B"`이고 `"A"`가 at(14)에 지나면 지금처럼 놓침입니다.
- "early로 탄 뒤 다음 advance에서도 ride가 유지되고 estimates에 대안이 없다"(Review Focus 5).

`leave.test.ts`의 `earlyBoardAfterSend`. 준비: 첫 도보 5분, `state.leave = { vehicleId: "A", slack: "tight", safeLeaveAt: at(8) }`. 보낸 값 `sent`에 따라 다음을 기대합니다.

| `sent` | 기대 |
|---|---|
| `{ leaveSlack: "tight", safeLeaveEpoch: epoch(at(8)), sentAt: epoch(at(6)), leaveEpoch: epoch(at(10)), stage: "walk", legIndex: 0 }` | `earlyBoardFrom` = `{ vehicleId: "A", at: at(13) }` |
| 이미 `{A, at(13)}`인데 safe at(7)을 보냄 | at(12)로 줄어듦 |
| 이미 `{A, at(12)}`인데 safe at(9)를 보냄 | at(12) 그대로 |
| `state.leave.vehicleId = "B"`, safe at(9) | `{ vehicleId: "B", at: at(14) }`로 바뀜 |
| `sentAt`이 `safeLeaveEpoch` 이상(`tight`가 보임) | 그대로 |

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test packages/commute/src/session/`
Expected: FAIL

- [ ] **Step 3: 구현합니다**

`checkPassed`는 스펙 4.6의 세 갈래를 따릅니다.
- `passedEntry.at ≥ readyAt`이면 `"time"`입니다.
- `legIndex === 0`이고, `earlyBoardFrom?.vehicleId === fixedId`이고, `earlyBoardFrom.at ≤ passedEntry.at < readyAt`이면 `"early"`입니다. 이때 `readyAt: passedEntry.at`, `stage: "ride"`입니다.
- 그 밖에는 지금처럼 놓침입니다.

`earlyBoardAfterSend`는 `leaveShownAt(sent, sent.sentAt) === "safe"`이고 `state.leave`가 있을 때만 바꿉니다. 같은 차량이면 이른 쪽 `at`을 남기고, 다른 차량이면 바꿉니다.

- [ ] **Step 4: 통과를 확인합니다**

Run: `bun test packages/commute/src/session/`
Expected: PASS

- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/session/
git commit -m "feat(commute): accept early boarding after a safe leave time"
```

---

### Task 5: `leave` 기록과 판정

**Files:**
- Modify: `packages/commute/src/accuracy.ts`
- Test: `packages/commute/src/accuracy.test.ts`

**Interfaces:**
- Consumes:
  - `leaveShownAt`, `LeaveShown`(Task 3)
  - `SessionState.leave`(Task 2)
  - `marginSecFor`(Task 1)
- Produces:

```ts
// AccuracyRecord에 더함
| {
		kind: "leave";
		at: number;
		sessionId: string;
		line: LineRef;
		stop: StopRef;
		vehicleId: string | null;
		leaveAt: number;
		safeLeaveAt: number | null;
		firstWalkMs: number;
		marginSec: number;
		shown: LeaveShown;
  }
// "end" 기록에 boardedEarly?: boolean 추가
export interface LeaveMark { shown: LeaveShown; safeLeaveAt: number | null; vehicleId: string | null }
/** 보낸 값 기준. 첫 구간 walk가 아니거나 last와 같으면 null. */
export function leaveRecordOf(state: SessionState, sent: ContentState, plan: CommutePlan, config: CommuteConfig, last: LeaveMark | null): LeaveRecord | null;
export interface LeaveSummary {
	verdict: "sure" | "boundary" | "wrong" | "unknown" | "tightOnly";
	shown: "roomy" | "safe" | null;
	sawSafe: boolean;
	sawTight: boolean;
	overWaitMs: number | null;
	boundaryDelayMs: number | null;
}
// SessionSummary에 leave: LeaveSummary | null, earlyBoarded: boolean 추가
// DailyCommuteReport에 leave 추가:
// { sessions; sure; boundary; wrong; unknown; tightOnly; sawSafe; sawTight;
//   rateLow: number | null; rateHigh: number | null; status: "ok" | "undecidable";
//   overWaitMeanMs: number | null; boundaryDelayMaxMs: number | null; boundaryLate: number; earlyBoarded: number }
```

- [ ] **Step 1: 실패하는 테스트를 씁니다**

**`leaveRecordOf`**
- 첫 구간 walk에서 보낸 safe 값이면 `shown: "safe"`, `safeLeaveAt: at(8)`, `firstWalkMs: 300000`, `marginSec: 180`인 기록을 냅니다.
- 같은 `LeaveMark`면 `null`입니다.
- `stage: "ride"`이면 `null`입니다.

**`summarize`의 `leave`**: `safe` at(8) 기록 하나(차량 A, 정류장 S, 도보 5분이라 `ready` = at(13))에 대해 판정합니다.

| A의 S 도착(`low`~`high`) | 기대 |
|---|---|
| at(13, 30)~at(14) | `verdict: "sure"`, `overWaitMs: 30000` |
| at(12, 40)~at(13, 20) | `"boundary"` |
| at(12)~at(12, 50) | `"wrong"`, `overWaitMs: 0` |
| 없음 | `"unknown"` |

다른 기록 조합은 다음을 기대합니다.

| 기록 | 기대 |
|---|---|
| `tight` 기록만 | `verdict: "tightOnly"`, `sawTight: true` |
| `safe` 뒤 `roomy` 기록 | `shown: "roomy"`, `ready = leaveAt + 도보`로 판정. `overWaitMs: null` |
| `none` 기록만 | `leave: null` |
| `safe` at(8) 뒤 `send{reason: "boundary", outcome: "ok", at: at(8, 5)}` | `boundaryDelayMs: 5000` |
| `end{boardedEarly: true}` | `earlyBoarded: true` |

**`dailyReport`**

| 세션 구성 | 기대 |
|---|---|
| sure 3, boundary 1 | `rateLow: 0.75`, `rateHigh: 1`, `status: "ok"` |
| sure 3, boundary 1, unknown 5 | `status: "undecidable"` |
| 경계 지연 5초·40초 | `boundaryDelayMaxMs: 40000`, `boundaryLate: 1`(30초 초과) |

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test packages/commute/src/accuracy.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현합니다**

**`leaveRecordOf`**
- `shown`은 `leaveShownAt(sent, sent.sentAt)`입니다.
- `vehicleId`는 `state.leave?.vehicleId ?? state.fixed[0] ?? null`입니다.
- `line`, `stop`은 기본 경로 첫 구간의 `line`과 `board.stop`입니다.

**판정**
- 마지막 `roomy`·`safe` 기록을 고릅니다.
- `ready`는 `roomy`면 `leaveAt + firstWalkMs`, `safe`면 `safeLeaveAt + firstWalkMs`입니다.
- 실제 도착은 `firstArrivals`의 `${stop}|${vehicleId}`입니다.
- `ready ≤ low`면 `sure`, `ready ≤ high`면 `boundary`, 그보다 크면 `wrong`입니다.

**지표**
- `overWaitMs`: `safe`일 때만 `max(0, low − ready)`입니다.
- `boundaryDelayMs`: 마지막 `safe` 기록의 `safeLeaveAt` 이후 첫 `reason: "boundary"`, `outcome: "ok"` 보낸 기록까지의 시간입니다.
- `rateLow` = sure ÷ (sure + boundary + wrong), `rateHigh` = (sure + boundary) ÷ 같은 분모입니다. 분모가 0이면 둘 다 `null`입니다.
- `status`: unknown이 (sure + boundary + wrong)보다 많으면 `"undecidable"`입니다.

- [ ] **Step 4: 통과를 확인합니다**

Run: `bun test packages/commute/src/accuracy.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋합니다**

```bash
git add packages/commute/src/accuracy.ts packages/commute/src/accuracy.test.ts
git commit -m "feat(commute): record and judge the shown leave time"
```

---

### Task 6: 실행기 연결(보낸 뒤 처리, iOS 오래됨 시각, 경계 알람)

**Files:**
- Modify: `apps/server/src/commute/runner-core.ts`
  - `SessionEntry`
  - `#advanceAndSend`
  - `#start`, `#update`
  - `#tick`
  - 종료 기록(1414행 근처)
- Modify: `packages/commute/src/push/apns.ts`(`apnsStartRequest`에 선택 `staleAt`)
- Test: `apps/server/src/commute/runner-core.test.ts`, `packages/commute/src/push/apns.test.ts`(있으면, 없으면 만듭니다)

**Interfaces:**
- Consumes:
  - `earlyBoardAfterSend`(Task 4)
  - `staleAtFor`, `nextLeaveBoundaryMs`(Task 3)
  - `leaveRecordOf`, `LeaveMark`(Task 5)
- Produces:
  - `SessionEntry.lastLeave?: LeaveMark | null`
  - `apnsStartRequest(input & { staleAt?: number })`: 값이 있으면 `"stale-date"`를 넣습니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

`runner-core.test.ts`의 기존 하네스(가짜 시계·저장소·푸시)를 씁니다.
- **보낸 safe 값의 처리**: safe를 싣는 갱신이 `ok`로 나가면, 저장된 세션의 `state.earlyBoardFrom`이 `{ vehicleId, at: safeLeave + 도보 }`입니다. 기록에 `kind: "leave", shown: "safe"`가 한 줄 있습니다.
- **보내지 못한 값**: 같은 값이 `retry`면 `earlyBoardFrom`이 `null`이고 `leave` 기록이 없습니다.
- **iOS 갱신의 stale-date**: safe at(8)을 싣는 iOS 갱신 요청 본문의 `"stale-date"`가 `epoch(at(8))`입니다.
- **iOS 시작의 stale-date**: 시작 푸시가 safe를 실으면 본문에 `"stale-date": epoch(at(8))`이 있습니다(Review Focus 4).
- **경계 알람**: 열린 세션 둘 중 하나의 마지막 보낸 값이 safe at(8)이고 `now = at(7, 50)`이면, `tick()`의 `nextAlarmAt`이 `at(8)`입니다. `now + tickMs`보다 이르기 때문입니다.
- **경계 푸시**: 알람이 at(8)에 다시 tick하면 그 세션에 `reason: "boundary"` 보낸 기록이 남습니다.
- **종료 기록**: `boardedBy`에 `"early"`가 있는 세션이 닫히면 `end` 기록의 `boardedEarly: true`입니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test apps/server/src/commute/runner-core.test.ts packages/commute/src/push/`
Expected: FAIL

- [ ] **Step 3: 구현합니다**

**`#advanceAndSend`**: 기존 제안 처리(`entry.lastContent === content`) 바로 앞에서, 보낸 경우에만 다음을 합니다.
- `entry.state = earlyBoardAfterSend(entry.state, content, plan)`
- `const record = leaveRecordOf(entry.state, content, plan, config, entry.lastLeave ?? null)`
- `record`가 있으면 `#note`로 남기고, `entry.lastLeave = { shown, safeLeaveAt, vehicleId }`로 바꿉니다.

**`#update`(iOS)**: `staleAt: staleAtFor(content, now, config)`를 씁니다.

**`#start`(iOS)**: `staleAt: staleAtFor(content, now, config)`를 넘기고, `apnsStartRequest`가 `"stale-date"`를 씁니다.

**`#tick`**:
- 세션을 다 돈 뒤, 저장된 각 `entry.lastContent`의 `nextLeaveBoundaryMs(content, now)` 중 가장 이른 값을 구합니다.
- `busy > 0`이면 `nextAlarmAt = min(now + tickMs, 그 값)`입니다. 단 `now`보다 늦어야 합니다.

**종료 기록**: `boardedEarly: entry.state.boardedBy.includes("early")`를 넣습니다.

- [ ] **Step 4: 통과를 확인합니다**

Run: `bun test apps/server packages/commute`
Expected: PASS

- [ ] **Step 5: 타입과 린트를 확인합니다**

Run: `bun run check-types && bunx ultracite check`
Expected: 오류 0

- [ ] **Step 6: 커밋합니다**

```bash
git add apps/server/src/commute/runner-core.ts apps/server/src/commute/runner-core.test.ts packages/commute/src/push/
git commit -m "feat(server): record sent leave times and wake at leave boundaries"
```

---

### Task 7: 앱 JS(푸시 값 읽기, 잠금화면 문구, 15·17 확인)

**Files:**
- Modify: `apps/native/lib/commute/content-state.ts`(`ContentState`, `parseContentState`)
- Modify: `apps/native/lib/commute/lock-screen-model.ts`(`statusLine`)
- Modify: `apps/native/lib/i18n/messages-ko.ts`(`commute.lock.status`)
- Modify: `apps/native/lib/commute/__fixtures__/lock-screen-cases.json`
- Test: `apps/native/lib/commute/content-state.test.ts`, `lock-screen-model.test.ts`, `guide-model.test.ts`

**Interfaces:**
- Produces:
  - 앱 `ContentState`에 `leaveSlack: "roomy" | "tight" | null`, `safeLeaveEpoch: number | null`를 더합니다. 파싱 뒤에는 항상 값이 있고, 없던 키는 `null`입니다.
  - 표본 JSON 사례는 2-F Swift 테스트가 그대로 씁니다.

- [ ] **Step 1: 실패하는 테스트를 씁니다**

**`content-state.test.ts`**

| 입력 | 기대 |
|---|---|
| `leaveSlack: "tight"`, `safeLeaveEpoch: 1794265680` | 그대로 읽음 |
| 두 키가 없음 | 둘 다 `null` |
| `leaveSlack: "maybe"` | 파싱 결과 `null`(값 전체를 버림). 다른 필드처럼 엄격하게 봅니다 |

**`lock-screen-cases.json`**: 사례를 더합니다. `now`·`leaveEpoch`는 기존 사례처럼 epoch 초이고, 08:10 = `leaveEpoch`입니다.

| 이름 | 상태 | now | 기대 `status` |
|---|---|---|---|
| `leave roomy keeps the registered time` | roomy | 08:05 | `08:10에 나가세요` |
| `leave tight before safe shows the earlier time` | tight, safe 08:08 | 08:05 | `08:08에 나가면 여유 있어요` |
| `leave tight at the safe minute is tight` | tight, safe 08:08 | 08:08:00 | `08:10에 나가면 빠듯해요` |
| `leave tight without safe is tight` | tight, safe `null` | 08:05 | `08:10에 나가면 빠듯해요` |
| `leave estimated falls back` | tight, safe 08:08, `etaState: "estimated"` | 08:05 | `08:10에 나가세요` |
| `leave hysteresis cap` | tight, safe 08:09 | 08:05 | `08:09에 나가면 여유 있어요` |

모든 사례의 `detail`은 `{stop} · {eta} 탑승` 그대로입니다.

**`guide-model.test.ts`**: 위 safe 사례로 15 세션 줄 `status`가 `"08:08에 나가면 여유 있어요 · {n}분"` 꼴인지 확인합니다. `commuteGuide.strip.status` 규칙을 따릅니다.

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test apps/native/lib/commute/`
Expected: FAIL

- [ ] **Step 3: 구현합니다**

`statusLine`은 `beforeLeave`가 있을 때 문장을 고릅니다.
- `tagOf(state) === "estimated"`이면 `beforeLeave`입니다.
- `leaveSlack === "tight"`이면:
  - `safeLeaveEpoch !== null && now < safeLeaveEpoch`이면 `beforeLeaveSafe { safeLeave: clock(safeLeaveEpoch) }`입니다.
  - 그 밖에는 `beforeLeaveTight { leave }`입니다.
- 나머지는 `beforeLeave`입니다.

`messages-ko.ts`에 키 둘을 더합니다(문구는 Global Constraints).

- [ ] **Step 4: 통과를 확인합니다**

Run: `bun test apps/native/lib/commute/ && bun run check-types`
Expected: PASS, 타입 오류 0

- [ ] **Step 5: 15 세션 줄 길이를 기기에서 확인합니다**

시뮬레이터나 기기에서 15 내 장소를 엽니다. 예를 들어 `__DEV__` 하네스나 가짜 세션 값으로 "08:08에 나가면 여유 있어요 · 12분"을 띄웁니다. 한 줄에서 잘리지 않는지 스크린샷으로 확인합니다. 잘리면 `commuteGuide.strip.status`의 줄바꿈 규칙을 고치고 결과를 커밋 메시지에 적습니다.

- [ ] **Step 6: 커밋합니다**

```bash
git add apps/native/lib/commute/ apps/native/lib/i18n/messages-ko.ts
git commit -m "feat(native): show the safe leave time on the lock screen model"
```

---

### Task 8: 2-F에 넘길 것(문서)

**Files:**
- Modify: 이 계획 파일의 아래 "2-F에 넘길 것" 절(구현하면서 바뀐 이름을 고칩니다)

2-F Task 4(iOS)와 Task 6(Android)는 `feat/mvp2-lock-screen`에서 진행합니다. 이 계획의 Task 1~7이 develop에 들어간 뒤 시작하고, 다음을 따릅니다.

- **Swift `ContentState`**: 선택 필드 `leaveSlack: String?`, `safeLeaveEpoch: Int?`를 더합니다. 없는 키는 `nil`입니다.
- **`CommuteCopy`**:
  - Task 7의 `statusLine` 규칙과 같은 부등호(`now < safeLeaveEpoch`)를 씁니다.
  - 태그가 "시간표 추정"이면(`etaState == estimated`, `positionState != live`, 또는 `context.isStale`) `beforeLeave`로 내립니다. JS는 `tagOf(state) === "estimated"`입니다.
  - `leaveSlack`이 `tight`가 아니면(`roomy`, `nil`) `beforeLeave`입니다. `tight`이고 `safeLeaveEpoch != nil && now < safeLeaveEpoch`이면 `beforeLeaveSafe`(`{safeLeave}`), 그 밖에는 `beforeLeaveTight`(`{leave}`)입니다.
- **`Localizable.strings`**: `commute.lock.status.beforeLeaveSafe`, `commute.lock.status.beforeLeaveTight`(Global Constraints 문구)를 더합니다.
- **Swift 표본 테스트**: `lock-screen-cases.json`의 `leave *` 사례 여섯 개(`leave roomy keeps the registered time`, `leave tight before safe shows the earlier time`, `leave tight at the safe minute is tight`, `leave tight without safe is tight`, `leave estimated falls back`, `leave hysteresis cap`)를 통과해야 합니다.
- **Android(Task 6)**: Kotlin 타입 변경은 없습니다(JS가 만든 `LockScreenModel`을 받음). 실기기에서 safe 문구가 보이는지만 확인합니다.

- [ ] **Step 1: 2-F 계획에 덧붙입니다**

`origin/feat/mvp2-lock-screen`을 별도 worktree(예: `git worktree add ../Betro-2f feat/mvp2-lock-screen`)로 엽니다. `docs/superpowers/plans/2026-11-10-mvp-2f-lock-screen.md` 끝에 "여유를 담은 출발 시각(2026-11-19 계획 Task 8)" 절로 위 다섯 줄을 붙이고, 그 브랜치에 커밋해 push합니다.

```bash
git -C ../Betro-2f commit -am "docs(plan): note the leave slack fields for Task 4 and 6"
```

---

### Task 9: 여유 폭 사전 수집 계산

**Files:**
- Create: `packages/commute/src/margin.ts`
- Create: `packages/commute/src/margin.test.ts`
- Create: `scripts/leave-margin.ts`

**Interfaces:**
- Produces:

```ts
export const LEAVE_MARGIN_LEAD_WINDOW_MIN = [5, 15] as const;
export const LEAVE_MARGIN_MIN_SAMPLES = 100;
export const LEAVE_MARGIN_MIN_SEC = 30;
export interface MarginSample {
	mode: "bus" | "subway";
	line: LineRef;
	low: number;   // 실제 도착 구간, 밀리초
	high: number;
	predictions: { at: number; etaAt: number; live: boolean }[];
}
export interface MarginResult { n: number; p95Sec: number | null; marginSec: number | null; capped: boolean }
/** 도착(low) 5~15분 전 live 예측 중 가장 이른 것. */
export function earliestLivePrediction(sample: MarginSample): { at: number; etaAt: number } | null;
export function marginOf(errorsMs: number[], maxSec: number): MarginResult;
export function leaveMargins(samples: MarginSample[], maxSec: number): {
	mode: Record<"bus" | "subway", MarginResult>;
	byLine: Record<string, MarginResult>;
};
```

- [ ] **Step 1: 실패하는 테스트를 씁니다**

**`earliestLivePrediction`**(`low` = at(20))

| 예측 | 기대 |
|---|---|
| at(4)(16분 전, 창 밖), at(6) live, at(8) live, at(12) not live | at(6)의 것 |
| 창 안에 live가 없음 | `null` |

**`marginOf`**(오차는 `etaAt − low`, nearest-rank)

| 오차 | 기대 |
|---|---|
| 1초~100초 100개 | `{ n: 100, p95Sec: 95, marginSec: 95, capped: false }` |
| 99개 | `{ n: 99, p95Sec: null, marginSec: null, capped: false }` |
| 모두 10초(100개) | `marginSec: 30`(최소값) |
| 모두 400초(100개) | `{ p95Sec: 400, marginSec: 300, capped: true }` |

**`leaveMargins`**: 지하철 2호선 100개, 7호선 20개라면 다음을 기대합니다.
- `mode.subway.n === 120`
- `byLine["seoul-subway:line2"].marginSec !== null`
- `byLine["seoul-subway:line7"].marginSec === null`

- [ ] **Step 2: 실패를 확인합니다**

Run: `bun test packages/commute/src/margin.test.ts`
Expected: FAIL

- [ ] **Step 3: `margin.ts`를 구현하고 통과를 확인합니다**

Run: `bun test packages/commute/src/margin.test.ts`
Expected: PASS

- [ ] **Step 4: `scripts/leave-margin.ts` CLI를 만듭니다**

**사용법**

```
bun scripts/leave-margin.ts --targets targets.json [--subway-dir <dir>] [--bus-file <ndjson>] [--max-sec 300]
```

`targets.json`은 `[{ "mode": "subway", "line": "seoul-subway:line2", "stop": "seoul-subway:1002000222", "direction": "up" }, …]`입니다.

**지하철 어댑터**: `--subway-dir`은 R2에서 내려받은 폴더입니다.
- 내려받는 키: `raw/subway-all/<날짜>/07-*`·`08-*`·`09-*`(출근), `17-*`·`18-*`·`19-*`(퇴근), `events/subway/…`
- **예측**: 스냅샷마다 `packages/commute/src/sources/seoul-subway.ts`의 `stationBoard`로 대상 역의 도착판을 만듭니다. `approaching`의 `etaAt`(노선 보정 포함, `config.subwayEtaBiasSec`)과 `method`를 씁니다. `live`는 `method !== null && method !== "timetable"`입니다.
- **실제 도착**: 이벤트에서 그 열차가 대상 역에 `arrive`로 처음 잡힌 원천 시각을 `high`로, 그 직전 스냅샷 시각을 `low`로 둡니다(실험 6과 같은 방법).

**버스 어댑터**: `--bus-file`은 수집 Worker의 `/dump` NDJSON입니다.
- **예측**: 응답마다 `parseRouteArrivals`로 도착 예측을 얻습니다.
- **실제 도착**: 차량이 대상 정류장 예측 목록에서 사라지거나 지난 첫 응답 시각을 `high`로, 그 직전 응답 시각을 `low`로 둡니다.

**출력**: `leaveMargins` 결과 JSON과 함께 다음을 stdout에 냅니다.
- 원래 p95와 `capped` 여부
- `config` 환경 변수로 붙일 값(`COMMUTE_LEAVE_MARGIN_SEC`, `COMMUTE_LEAVE_MARGIN_BY_LINE`)

- [ ] **Step 5: 실험 6 자료로 어댑터를 확인합니다**

`raw/subway-all`과 `events/subway`의 2026-11-05·06·10 07:30~09:30을 내려받습니다. 강남역 2호선 내선(`statnId` 1002000222, `up`)을 대상으로, 임시로 창을 `[4, 6]`분으로 바꿔 돌립니다.

Expected:
- 표본 수가 실험 6의 평가 수(내선 82)와 ±10 안입니다.
- 보정 뒤 오차(`etaAt − mid`)의 중앙값이 0초 ±20초 안입니다. 실험 6은 보정 전 −59초이고 2호선 보정이 60초입니다.

맞지 않으면 어댑터의 도착 판정을 고칩니다.

- [ ] **Step 6: 커밋합니다**

```bash
git add packages/commute/src/margin.ts packages/commute/src/margin.test.ts scripts/leave-margin.ts
git commit -m "feat(commute): compute leave margins from collected arrivals"
```

---

### Task 10: 사전 수집 실행과 설정 반영(운영)

코드가 아니라 운영 작업입니다. 7.1 검증 시작 전에 끝냅니다.

- [ ] **Step 1: 대상을 정합니다**

검증 참여자의 등록 경로에서 승차역·정류장과 노선을 `targets.json`으로 만듭니다.

- [ ] **Step 2: 지하철 표본을 계산합니다**

최근 평일 출퇴근 시간대의 수집기 기록을 내려받아 Task 9 CLI를 돌립니다. Expected: `mode.subway.n ≥ 100`

- [ ] **Step 3: 버스 수집 Worker를 확인합니다**

실험 6의 버스 수집 Worker(`spikes/accuracy/collect-bus-arrivals.ts`, 로컬 브랜치 `spike/mvp2-accuracy`)가 Mac 저장소(`/Users/choehyeonjun/project/Betro`)에 있는지 herdr로 확인합니다.
- 있으면 `ACTIVE_DATES`에 평일 5일을 넣고 대상을 참여자의 버스 정류장·노선으로 바꿔 배포합니다. 하루 호출 수가 1,000건 아래인지 계산해 적습니다(대상 2개면 480건).
- 없으면 이 단계에서 멈추고 사용자에게 알립니다.

- [ ] **Step 4: 버스 표본을 계산합니다**

5일 뒤 `/dump`를 받아 CLI를 돌립니다. Expected: `mode.bus.n ≥ 100`. 모자라면 날짜를 늘립니다.

- [ ] **Step 5: 설정을 반영합니다**

CLI가 낸 값을 서버 환경 변수(`COMMUTE_LEAVE_MARGIN_SEC`, `COMMUTE_LEAVE_MARGIN_BY_LINE`)로 배포합니다. 원래 p95와 `capped`를 `docs/research/2026-11-06-mvp2-experiments.md`에 새 절("여유 폭 사전 수집")로 적고 커밋합니다.

```bash
git commit -m "docs(research): record the pre-collected leave margins"
```

---

### Task 11: Figma 표본 변형

**Files:** Figma [Betro App UI](https://www.figma.com/design/MiS0r5xYKVht3Pc7YXMXpP/Betro-App-UI), `iOS / 18 Live Activity`

- [ ] **Step 1: 나가기 전 표본 옆에 변형을 만듭니다**

`figma:figma-use` 스킬을 먼저 불러옵니다. 나가기 전 표본 하나를 복제해 옆에 둡니다.
- 상태 줄: "08:08에 나가면 여유 있어요"
- 상세 줄: "천호역.현대백화점 · 08:15 탑승"

기존 변수와 컴포넌트(`LiveActivity`)만 씁니다.

- [ ] **Step 2: 확인합니다**

`get_screenshot`으로 카드가 160pt 안이고 글자가 잘리지 않는지 확인합니다.

---

## 2-F에 넘길 것

Task 8 참고. 이름이 바뀌면 이 절을 먼저 고칩니다.
