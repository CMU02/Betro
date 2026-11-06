# MVP 2-B: 문구 키 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/native`의 사용자 문구를 코드에서 빼서 한국어 메시지 묶음 하나로 모으고, 앞으로 코드에 문구를 직접 쓰면 테스트가 실패하게 만든다.

**Architecture:** 메시지 묶음(`messages-ko.ts`)은 중첩 객체 하나이고, 키는 점으로 이은 경로(`"settings.theme.title"`)입니다. `translate`는 순수 함수라 `bun test`로 검증합니다. 화면은 `t(key, params)`만 부릅니다. 데이터 파일(탭, 데이터 출처)은 문구 대신 키를 들고, 화면이 그릴 때 `t`로 바꿉니다. 그래서 나중에 실행 중 언어를 바꿔도 데이터를 다시 만들 필요가 없습니다. 언어가 하나뿐이라 라이브러리는 쓰지 않습니다. 키 구조가 i18next와 같은 점 경로라서, 해외 확장 때 옮기는 일은 기계적입니다.

**Tech Stack:** TypeScript 6(템플릿 리터럴 타입으로 키 타입 생성), bun test, Expo SDK 58 / expo-router.

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` 5.10의 1번("화면 문구는 키로 관리합니다"), 8장 2단계 첫 항목

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/mvp2`, 브랜치 `feat/mvp2-message-catalog`(develop에서 만듦). PR은 develop으로.
- 커밋 메시지와 PR 본문에 AI 서명이나 출처 표기(`Co-Authored-By`, 세션 URL 등)를 넣지 않는다.
- 커밋 전 `bunx ultracite fix`를 돌린다. 각 Task 끝에 `bun test apps/native`와 `cd apps/native && bun run check-types`가 통과해야 한다.
- MVP의 언어는 한국어 하나다. **이 작업은 문구를 한 글자도 바꾸지 않는다.** 줄바꿈(`\n`)과 가운뎃점(`·`)을 포함해 지금 화면에 나오는 문자열을 그대로 옮긴다.
- 순수 로직 파일(`lib/i18n/*.ts`)은 `react-native`와 `expo-*`를 import하지 않는다(bun이 로드하지 못함).
- 범위 밖 문구:
  - `app.config.ts`의 권한 문구(`locationWhenInUsePermission`). 네이티브 설정이므로 해외 확장 때 Expo `locales`로 옮긴다.
  - 코드 주석.
  - 개발자용 로그 문자열.
  - Sentry로 보내는 시험 예외 메시지(`lib/crash/app-crash-reporting.ts`의 `"Betro 크래시 시험: 테스트 예외"`). 화면에 나오지 않는 개발자용 값이지만 검사 테스트에 걸리므로 Task 2에서 영어(`"Betro crash test: test exception"`)로 바꾼다.
- 이 작업 뒤로 새 화면은 모두 `t()`를 쓴다(Task 2의 검사 테스트가 강제함).

## Review Focus

- **매개변수가 있는 문구에 값을 빠뜨린 경우.** 예를 들어 `permissions.row.openSettings`에 `title`이 없으면 `"{title}"`이 그대로 화면에 나가면 안 된다. 오류를 던져 개발 중에 바로 보이게 한다. Task 1 테스트로 고정한다.
- **타입을 우회해 없는 키를 넘긴 경우**(`as MessageKey`). 빈 문자열이나 `undefined`를 그리면 안 된다. 키 이름이 담긴 오류를 던진다. Task 1 테스트로 고정한다.
- **두 줄 문구의 줄바꿈과 기기별 분기가 옮기는 중에 사라지는 경우.** `permissions.tsx`는 iOS와 Android에서 다른 문구를 쓴다. 위쪽 안내(`IosIntro`, `AndroidIntro`)의 설명이 다르고, 카드 설명은 iOS만 두 줄로 끊는다. 옮긴 뒤 화면이 이전과 같아야 한다. Task 2 테스트(값 대조)와 Task 2 기기 확인으로 고정한다.
- **화면 파일 안에 한글 문구가 새로 들어오는 경우.** 검사 테스트가 파일과 줄을 짚어 실패해야 한다. 주석 속 한글은 통과해야 한다. Task 2 테스트로 고정한다.
- **데이터 출처의 법적 표기**(`© OpenStreetMap contributors`, 공공누리 표기)가 키로 옮겨지면서 바뀌는 경우. 원문과 같아야 한다. Task 2 테스트로 고정한다.

---

### Task 1: 메시지 묶음과 번역 함수

**Files:**
- Create: `apps/native/lib/i18n/messages-ko.ts`
- Create: `apps/native/lib/i18n/translate.ts`
- Create: `apps/native/lib/i18n/t.ts`
- Test: `apps/native/lib/i18n/translate.test.ts`

**Interfaces:**
- Produces:
  - `messages-ko.ts`: `export const ko = { … } as const`. 최상위 묶음은 `common`, `tabs`, `onboarding`, `permissions`, `settings`, `dataSources`, `errorBoundary`, `notFound`, `push`. 값은 Task 2에서 채운다. 이 Task에서는 `tabs`(지도, 즐겨찾기, 출퇴근, 설정)와 `permissions.row.openSettings: "설정 앱에서 {title} 권한을 켤 수 있어요"`만 넣어 테스트에 쓴다.
  - `translate.ts`:
    - `export type MessageCatalog = Widen<typeof ko>`. 잎의 리터럴 타입을 `string`으로 넓힌 같은 모양이다. 해외 확장 때 `en: MessageCatalog`를 이 타입으로 만든다.
    - `export type MessageKey`: `typeof ko`의 잎 문자열까지 가는 점 경로 유니온이다. 예: `"tabs.map"`, `"permissions.row.openSettings"`.
    - `export type MessageParams = Readonly<Record<string, string | number>>`
    - `export function translate(catalog: MessageCatalog, key: MessageKey, params?: MessageParams): string`
  - `t.ts`: `export function t(key: MessageKey, params?: MessageParams): string`. `ko`에 묶은 `translate`다. 화면은 `import { t } from "@/lib/i18n/t"`만 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** (`translate.test.ts`)

```ts
import { describe, expect, test } from "bun:test";
import { ko } from "./messages-ko";
import { type MessageKey, translate } from "./translate";

test("returns the Korean message for a key", () => {
	expect(translate(ko, "tabs.map")).toBe("지도");
	expect(translate(ko, "tabs.commute")).toBe("출퇴근");
});

test("fills {param} placeholders", () => {
	expect(translate(ko, "permissions.row.openSettings", { title: "위치" })).toBe(
		"설정 앱에서 위치 권한을 켤 수 있어요"
	);
});

test("accepts number params", () => {
	const catalog = { ...ko, tabs: { ...ko.tabs, map: "{n}분" } };
	expect(translate(catalog, "tabs.map", { n: 3 })).toBe("3분");
});

test("throws when a param is missing", () => {
	expect(() => translate(ko, "permissions.row.openSettings")).toThrow(
		'Missing message param "title" for key "permissions.row.openSettings"'
	);
});

test("throws on an unknown key instead of rendering empty text", () => {
	expect(() => translate(ko, "tabs.nope" as MessageKey)).toThrow(
		'Unknown message key "tabs.nope"'
	);
	expect(() => translate(ko, "tabs" as MessageKey)).toThrow(
		'Unknown message key "tabs"'
	);
});

describe("catalog", () => {
	test("every leaf is a non-empty string", () => {
		const walk = (node: unknown, path: string): void => {
			if (typeof node === "string") {
				expect(node.length, path).toBeGreaterThan(0);
				return;
			}
			for (const [k, v] of Object.entries(node as object)) {
				walk(v, path ? `${path}.${k}` : k);
			}
		};
		walk(ko, "");
	});
});
```

컴파일 시점 확인으로 다음 두 줄을 테스트 파일 끝에 둔다(`check-types`가 잡는다).
```ts
const _ok: MessageKey = "permissions.row.openSettings";
// @ts-expect-error 잎이 아닌 경로는 키가 아니다
const _notLeaf: MessageKey = "permissions.row";
```

- [ ] **Step 2: 실패 확인**

Run: `bun test apps/native/lib/i18n`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**
  - `messages-ko.ts`에 위 Interfaces의 값을 넣는다. 파일 머리 주석에 다음 두 가지를 적는다.
    - 키는 `화면.덩어리.역할` 순서로 짓는다.
    - 문구를 바꿀 때는 Figma 문구 표(`2026-11-05-mvp-1-app-foundation.md` "문구 변경")를 함께 고친다.
  - `translate.ts`:
    - 키는 `.`으로 나눠 따라 내려간다. 끝이 문자열이 아니면 `Error('Unknown message key "<key>"')`를 던진다.
    - 자리표시자는 `/\{(\w+)\}/g` 하나로 바꾼다(정규식은 모듈 최상위 상수). 값이 없으면 `Error('Missing message param "<name>" for key "<key>"')`를 던진다. 남는 params는 무시한다.
    - `Widen`과 `MessageKey`는 재귀 조건부 타입으로 만든다.
  - `t.ts`: `translate(ko, key, params)`를 부른다.

- [ ] **Step 4: 통과 확인**

Run: `bun test apps/native/lib/i18n && cd apps/native && bun run check-types`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
bunx ultracite fix
git add apps/native/lib/i18n
git commit -m "feat(native): add typed Korean message catalog and translate"
```

---

### Task 2: 문구를 키로 옮기기와 검사 테스트

**Files:**
- Modify: `apps/native/lib/i18n/messages-ko.ts` (모든 문구 추가)
- Modify: `apps/native/components/navigation/tabs.ts`, `apps/native/components/navigation/tabs.test.ts`, `apps/native/components/navigation/tab-bar.tsx`
- Modify: `apps/native/lib/legal/data-sources.ts`, `apps/native/lib/legal/data-sources.test.ts`, `apps/native/app/settings/data-sources.tsx`
- Modify: `apps/native/lib/crash/app-crash-reporting.ts`(시험 예외 메시지를 영어로)
- Modify: `apps/native/app/_layout.tsx`, `apps/native/app/+not-found.tsx`, `apps/native/app/onboarding/index.tsx`, `apps/native/app/onboarding/permissions.tsx`, `apps/native/app/(tabs)/index.tsx`, `apps/native/app/(tabs)/favorites.tsx`, `apps/native/app/(tabs)/commute.tsx`, `apps/native/app/(tabs)/settings.tsx`, `apps/native/components/push-notifications.tsx`
- Create: `apps/native/lib/i18n/no-hardcoded-copy.test.ts`

**Interfaces:**
- Consumes: Task 1의 `t`, `MessageKey`, `ko`
- Produces (데이터 형태 변경. 다른 화면이 이 이름을 씀):
  - `TabSpec`: `label: string`을 `labelKey: MessageKey`로 바꾼다. 값은 `"tabs.map" | "tabs.favorites" | "tabs.commute" | "tabs.settings"`.
  - `StatusLegendItem`: `label`과 `description`을 `labelKey: MessageKey`와 `descriptionKey: MessageKey`로 바꾼다. `kind`는 그대로다.
  - `DataProvider`: `title`과 `subtitle`을 `titleKey: MessageKey`와 `subtitleKey: MessageKey`로 바꾼다. `url`은 그대로다.
  - `DATA_SOURCES_FOOTNOTE`를 지우고 `DATA_SOURCES_FOOTNOTE_KEY: MessageKey = "dataSources.footnote"`를 둔다.
  - `STATUS_LEGEND`의 `labelKey`(`dataSources.status.live.label` 등)는 출퇴근 잠금화면 태그(2-F)도 쓴다.

- [ ] **Step 0: 옮기기 전 화면 기록**
  - Task 1 커밋 상태에서 iPhone 16 Pro와 Galaxy S20 Ultra(없으면 시뮬레이터·에뮬레이터)로 다음 화면을 찍어 둔다: 온보딩, 권한(iOS와 Android 각각), 지도/즐겨찾기/출퇴근 탭, 설정(개발 빌드의 "크래시 시험" 행 포함), 데이터 출처.
  - Run: `cd apps/native && bun run ios` / `bun run android`
  - Expected: 스크린샷 파일이 생긴다. 커밋하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `tabs.test.ts`: 탭 순서는 그대로 두고 문구 대조로 바꾼다. `TABS.map((tab) => t(tab.labelKey))`가 `["지도", "즐겨찾기", "출퇴근", "설정"]`이어야 한다.
  - `data-sources.test.ts`: 지금 파일에 있는 문자열을 기댓값으로 그대로 옮겨 대조한다.
    - `STATUS_LEGEND.map((s) => [s.kind, t(s.labelKey), t(s.descriptionKey)])`는 `[["live", "실시간", "실시간 위치 API로 확인된 위치"], ["estimated", "시간표 추정", "역 도착 신호와 시간표로 계산한 위치"], ["delayed", "지연", "운영 기관 지연 정보 반영"], ["ended", "운행 종료", "운행이 끝났거나 정보가 없어요"]]`이어야 한다.
    - `DATA_PROVIDERS.map((p) => [t(p.titleKey), t(p.subtitleKey), p.url])`는 지금 `data-sources.ts`의 네 항목과 같아야 한다. `"© OpenStreetMap contributors"`, `"선로·지도 형상 (ODbL)"`도 포함한다.
    - `t(DATA_SOURCES_FOOTNOTE_KEY)`는 `"공공누리 제1유형 · 갱신 주기는 노선과 시간대에 따라 달라요"`이어야 한다.
  - `no-hardcoded-copy.test.ts`:
    - `test("screens and components contain no hard-coded Korean copy")`
    - `apps/native`의 `app/**/*.tsx`, `components/**/*.{ts,tsx}`, `lib/**/*.{ts,tsx}`, `contexts/**/*.tsx`를 읽는다(`Bun.Glob`).
    - 다음 파일은 뺀다: `*.test.ts`, `lib/i18n/messages-ko.ts`.
    - 주석을 지운다. `/\/\*[\s\S]*?\*\//g`(JSX의 `{/* */}` 포함)와 줄 주석 `/(^|[^:])\/\/.*$/gm`(URL의 `://`는 남김)을 쓴다.
    - 그 뒤 `/[가-힣]/`가 나오는 줄을 `파일:줄: 내용`으로 모은다. 목록이 빈 배열(`toEqual([])`)이어야 한다.
    - 검사기 자체도 확인한다. 같은 파일에 `test("detector flags code but not comments")`를 두고, 임시 문자열 `'const a = "지도"; // 지도'`는 한 줄이 잡히고 `'// 지도\n/* 지도 */'`는 0줄이 잡히는지 본다(검사 함수를 따로 export하지 않고 파일 안 함수로 둠).

- [ ] **Step 2: 실패 확인**

Run: `bun test apps/native`
Expected: FAIL. `tabs.test.ts`와 `data-sources.test.ts`는 `labelKey` 없음으로 실패하고, `no-hardcoded-copy.test.ts`는 화면 파일의 한글 줄 목록을 출력하며 실패한다.

- [ ] **Step 3: 옮기기**
  - 검사 테스트가 출력한 모든 줄의 문구를 `messages-ko.ts`에 넣고, 그 자리를 `t("…")`로 바꾼다. 대상은 `accessibilityLabel`, `Alert.alert` 기본 제목(`push.defaultTitle: "알림"`), 템플릿 문자열을 포함한다.
    - `permissions.tsx`의 `` `설정 앱에서 ${title} 권한을 켤 수 있어요` ``는 `permissions.row.openSettings`로 옮긴다.
    - `` `${title} 권한을 요청해요` ``는 `permissions.row.request: "{title} 권한을 요청해요"`로 옮긴다.
    - 플랫폼마다 다른 문구는 따로 둔다. 안내 설명은 `permissions.intro.ios.body`와 `permissions.intro.android.body`, 카드 설명은 `permissions.purpose.ios.{location,notifications}`(줄바꿈 있음)와 `permissions.purpose.android.{location,notifications}`(줄바꿈 없음)다. 두 플랫폼이 같은 제목은 `permissions.intro.title` 하나로 둔다.
  - `settings.tsx`의 개발 빌드 전용 "크래시 시험" 행과 Alert 문구(제목, 설명, 버튼)는 `settings.crashTest.*`로 옮긴다.
  - `settings.tsx`의 `THEME_OPTIONS`와 `MAP_QUALITY_LABEL`도 탭과 같은 방식으로 `labelKey`를 들게 한다.
  - `tab-bar.tsx`, `data-sources.tsx`는 그릴 때 `t(item.labelKey)` 식으로 바꾼다.
  - 문구는 한 글자도 바꾸지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `bun test apps/native && cd apps/native && bun run check-types`
Expected: PASS. 검사 테스트는 빈 목록이다.

- [ ] **Step 5: 기기 확인**
  - Step 0과 같은 화면을 다시 찍어 비교한다.
  - Run: `cd apps/native && bun run ios` / `bun run android`
  - Expected: 두 플랫폼 모두 전후 화면의 문구와 줄바꿈이 같다. 다르면 Step 3로 돌아간다.

- [ ] **Step 6: 커밋**

```bash
bunx ultracite fix
git add apps/native
git commit -m "refactor(native): move user-facing copy into the message catalog"
```
