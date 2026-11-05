# MVP 1: 앱 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Better-T-Stack 템플릿 상태의 `apps/native`를 Figma 디자인 시스템(토큰·폰트)과 하단 탭 4개 구조로 바꾸고, 온보딩·권한, 설정(게스트)·데이터 출처, 기기 저장, 설치 ID, 크래시 수집까지 갖춘 앱 뼈대를 만든다.

**Architecture:** 디자인 토큰은 `apps/native/theme/tokens.ts` 하나가 원본이고, 생성 스크립트가 uniwind/HeroUI용 CSS(`theme.generated.css`)를 만든다. 순수 로직(토큰 렌더링, 환경설정 파싱, 설치 ID, 온보딩 진입 판단, 권한 단계)은 react-native를 import하지 않는 파일에 두고 `bun test`로 검증하며, 화면은 그 위에 얇게 얹는다. 화면 확인은 iOS 시뮬레이터와 Android 에뮬레이터 스크린샷을 Figma와 비교한다.

**Tech Stack:** Expo SDK 58, expo-router 58 (Stack.Protected, Tabs), React Native 0.88, uniwind 1.13 + heroui-native 1, lucide-react-native, expo-sqlite/kv-store, expo-secure-store, expo-crypto, expo-location, @react-native-firebase/messaging·crashlytics 27.1.0, bun test, fonttools(`uvx`, 폰트 서브셋용).

**Spec:** `docs/superpowers/specs/2026-11-05-mvp-design.md` (8장의 1단계 "앱 기반", 4.1·4.4·5.2·5.9)

## 실행 방식과 모델 배정

사용자 지시(2026-11-05): 구현은 ultracode(Workflow)로 하고, 작업마다 난이도·작업량에 맞는 모델을 쓴다. Task는 순서대로 실행한다(뒤 Task가 앞 Task의 인터페이스를 씀). 각 Task는 구현 에이전트 → 리뷰 에이전트(스펙·계획 대조, 테스트·타입 확인) 순서이고, 마지막에 브랜치 전체 리뷰를 한 번 한다.

| Task | 내용 | 구현 모델 | 리뷰 모델 | 이유 |
|---|---|---|---|---|
| 1 | 디자인 토큰 | Sonnet 5.5 | Sonnet 5.5 | 값 옮기기와 단순 생성기 |
| 2 | 폰트 서브셋·텍스트 스타일 | Sonnet 5.5 | Sonnet 5.5 | 스크립트 한 개, 값 표 |
| 3 | 환경설정·설치 ID | Sonnet 5.5 | Opus 5.5 | 로직은 작지만 저장 실패 처리가 중요 |
| 4 | 탭 껍데기·템플릿 정리 | Opus 5.5 | Opus 5.5 | 삭제 범위가 넓고 커스텀 탭바를 Figma에 맞춰야 함 |
| 5 | 온보딩·권한 | Opus 5.5 | Opus 5.5 | 보호 라우트, 권한·푸시 동작 변경 |
| 6 | 설정·데이터 출처 | Sonnet 5.5 | Sonnet 5.5 | 화면 두 개, 정해진 문구 |
| 7 | 크래시 수집·기기 확인 | Opus 5.5 | — | 네이티브 설정, 시뮬레이터·에뮬레이터 빌드와 Figma 비교 판단 |
| 마지막 | 브랜치 전체 리뷰 | — | Opus 5.5 | |

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/mvp-commute`, 브랜치 `feat/mvp-commute-design`. PR은 develop으로.
- 커밋 메시지·PR 본문에 AI 서명·출처 표기(`Co-Authored-By`, 세션 URL 등)를 넣지 않는다.
- 커밋 전 `bunx ultracite fix`, 각 Task 끝에 `bun test apps/native`와 `cd apps/native && bun run check-types` 통과.
- 디자인 원본: Figma `MiS0r5xYKVht3Pc7YXMXpP` (Betro App UI). 화면을 만들 때 해당 프레임을 Figma MCP(`get_design_context`, `get_screenshot`)로 보고 맞춘다.
- iOS 최소 버전 17.2 (`expo-build-properties`의 `ios.deploymentTarget: "17.2"`).
- 로그인 없음: 앱에서 better-auth 클라이언트·로그인 화면·`privateData` 호출을 없앤다. 서버(`apps/server`, `packages/auth`)는 건드리지 않는다.
- 컴포넌트에 hex 색을 직접 쓰지 않는다. 클래스는 토큰 클래스(`bg-bg-canvas`, `text-text-primary` 등)를 쓰고, 네이티브 API(StatusBar, 내비게이션 옵션)에 원시 값이 필요하면 `theme/tokens.ts`에서 읽는다.
- 순수 로직 파일(`*.ts` 중 테스트 대상)은 `react-native`, `expo-*`를 import하지 않는다(bun이 로드하지 못함). 플랫폼 의존 부분은 어댑터 파일로 분리한다.
- 사용자에게 보이는 문구는 한국어. Figma 문구를 그대로 쓰되, 아래 "문구 변경" 표의 항목만 바꾼다.
- 아이콘은 Figma와 같은 Lucide(`lucide-react-native`)를 이름 import로 쓴다(`import { Map } from "lucide-react-native"`).

### 문구 변경 (Figma와 다르게 쓰는 것)

| 화면 | Figma | 코드 |
|---|---|---|
| 01 온보딩 부제 | 312대의 차량이 지금 어디쯤 있는지 한눈에 보여드려요. | 지금 달리는 차량이 어디쯤 있는지 한눈에 보여드려요. |
| 01 온보딩 기능 2 | 역·정류장 도착 알림 | 출퇴근 길을 잠금화면에서 |
| 01 온보딩 | "이미 계정이 있어요" 버튼 | 없음(로그인 MVP 제외) |
| 02 권한 알림 설명 | 도착 알림과 지연 안내를 / 보내드려요 | 출퇴근 시간에 잠금화면에 / 도착 정보를 띄워요 |
| 12 설정 | 프로필 카드 / 게스트 로그인 카드 | 없음 |
| 12 설정 알림 섹션 | 푸시 알림, 알림 시간대 | 출퇴근 잠금화면 안내(토글) 한 줄 |
| 12 설정 | 로그아웃 버튼 | 없음 |
| 13 데이터 출처 서울특별시 부제 | 서울 열린데이터광장 · 실시간 지하철·버스 위치 | 서울 열린데이터광장 · 실시간 지하철 도착·역 정보 |
| 13 데이터 출처 공공데이터포털 부제 | 버스 노선·정류소 | 버스 위치·노선·정류소, 서울교통공사 시간표 |
| 13 데이터 출처 각주 | 데이터 갱신: 지하철 30초, 버스 15초 간격 | 공공누리 제1유형 · 갱신 주기는 노선과 시간대에 따라 달라요 |

## Review Focus

- 저장된 환경설정이 깨졌거나(잘못된 JSON, 다른 버전, 일부 필드만 있음) 없을 때 → 앱은 기본값으로 정상 시작한다. Task 3 테스트로 고정.
- 보안 저장소에 설치 ID만 있고 비밀값이 없거나(또는 반대), 보안 저장소가 예외를 던질 때 → 두 값을 함께 새로 만들거나 예외를 그대로 올려 호출부가 다음 실행에 다시 시도한다. 앱은 죽지 않는다. Task 3 테스트로 고정.
- 권한 화면에서 "나중에"를 누르거나 둘 다 거부할 때 → 온보딩은 끝나고 앱을 쓸 수 있으며, 앱을 다시 켜도 권한 요청이 저절로 뜨지 않는다. Task 5 테스트로 고정.
- 테마를 "시스템"으로 둔 채 기기 다크 모드를 바꿀 때, 또는 "다크"로 고정했을 때 → 앱이 즉시 따라가고 다음 실행 첫 화면부터 저장된 테마로 그린다. Task 3 테스트(`toUniwindTheme`) + Task 7 기기 확인.
- 역·정류장 이름에 서브셋 밖 글자가 나올 때 → 폰트 서브셋이 KS X 1001 한글 전체와 쓰는 기호를 덮는다(현재 참조 데이터 639자 전부 포함 확인됨). Task 2 테스트로 고정.

---

### Task 1: 디자인 토큰

**Files:**
- Create: `apps/native/theme/tokens.ts`, `apps/native/theme/render-theme-css.ts`, `apps/native/theme/render-theme-css.test.ts`, `apps/native/scripts/generate-theme-css.ts`, `apps/native/theme/theme.generated.css`
- Modify: `apps/native/global.css`, `apps/native/package.json`(script `theme:css`)

**Interfaces:**
- Produces:
  - `type ThemeMode = "dark" | "light"`
  - `COLOR_TOKENS: Record<ColorTokenName, { dark: string; light: string }>` — 키는 Figma 이름에서 `color/`를 뗀 `"bg/canvas"` 형식
  - `TRANSIT_COLORS: Record<TransitTokenName, string>` — 키 `"line/1"`, `"bus/trunk"` 형식
  - `RADII: Record<"xs"|"sm"|"md"|"lg"|"xl"|"2xl"|"full", number>`
  - `colorToken(name: ColorTokenName, mode: ThemeMode): string`
  - `renderThemeCss(): string`
  - CSS 클래스 규칙: `--color-<group>-<name>` → `bg-bg-canvas`, `text-text-primary`, `border-border-subtle`, `bg-accent-primary`, `text-status-live`, `bg-transit-line-2` 등

토큰 값(Figma 2026-11-05 기준, `dark / light`):

| 이름 | 값 |
|---|---|
| bg/canvas | #0b0e15 / #f5f6f8 |
| bg/surface | #131722 / #ffffff |
| bg/surface-raised | #1a1f2b / #ffffff |
| bg/surface-sunken | #06080c / #eceef2 |
| bg/control | #232937 / #eceef2 |
| bg/glass | #131722c7 / #ffffffd6 |
| bg/scrim | #00000080 / #00000080 |
| bg/hover | #ffffff14 / #0000000f |
| text/primary | #f5f6f8 / #0b0e15 |
| text/secondary | #b6bdca / #4b5365 |
| text/tertiary | #687184 / #8a93a4 |
| text/on-accent | #0b0e15 / #0b0e15 |
| text/accent | #c6f432 / #4f6a08 |
| text/inverse | #0b0e15 / #ffffff |
| icon/primary | #f5f6f8 / #0b0e15 |
| icon/secondary | #8a93a4 / #687184 |
| border/subtle | #232937 / #dadee5 |
| border/strong | #333a4a / #b6bdca |
| accent/primary | #c6f432 / #c6f432 |
| accent/pressed | #a9d916 / #a9d916 |
| accent/soft | #26330a / #f0fbc8 |
| status/live | #3ddc84 / #0f8a47 |
| status/estimated | #ffc145 / #a86f00 |
| status/delayed | #ff6b6b / #d23434 |
| status/info | #5aa9ff / #1f6fd1 |
| status/live-soft | #3ddc8429 / #0f8a471f |
| status/estimated-soft | #ffc14529 / #a86f001f |
| status/delayed-soft | #ff6b6b29 / #d234341f |
| status/neutral-soft | #68718433 / #68718424 |
| status/info-soft | #5aa9ff29 / #1f6fd11f |

Transit(모드 없음): line/1 #0052a4, line/2 #00a84d, line/3 #ef7c1c, line/4 #00a5de, line/5 #996cac, line/6 #cd7c2f, line/7 #747f00, line/8 #e6186c, line/9 #bdb092, line/sinbundang #d4003b, line/suin-bundang #f5a200, line/gyeongui-jungang #77c4a3, line/airport #0090d2, line/ui-sinseol #b7c452, line/gtx-a #9a6292, line/gyeongchun #178c72, bus/trunk #0068b7, bus/branch #53b332, bus/express #e60012, bus/circular #f2b70a, bus/village #53b332, bus/airport #00a0e9.

Radius: xs 6, sm 8, md 12, lg 16, xl 20, 2xl 28, full 999. 간격은 Tailwind 기본(4px 단위)이 Figma `space/*`와 맞으므로 따로 두지 않는다.

HeroUI 변수 매핑(각 모드에서 오른쪽 토큰 값을 씀): `--background`=bg/canvas, `--foreground`=text/primary, `--surface`·`--surface-secondary`=bg/surface, `--surface-tertiary`=bg/surface-raised, 각 `*-foreground`=text/primary, `--overlay`=bg/surface-raised, `--overlay-foreground`=text/primary, `--backdrop`=bg/scrim, `--muted`=text/tertiary, `--default`=bg/control, `--default-foreground`=text/primary, `--accent`=accent/primary, `--accent-foreground`=text/on-accent, `--success`=status/live, `--warning`=status/estimated, `--danger`=status/delayed, `--success-foreground`·`--warning-foreground`·`--danger-foreground`=text/on-accent, `--border`·`--separator`=border/subtle, `--field-background`=bg/control, `--field-foreground`=text/primary, `--field-placeholder`=text/tertiary, `--segment`=bg/surface-raised, `--segment-foreground`=text/primary, `--focus`=accent/primary, `--link`=text/accent.

- [ ] **Step 1: 실패하는 테스트** — `render-theme-css.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderThemeCss } from "./render-theme-css";
import { COLOR_TOKENS, colorToken } from "./tokens";

describe("renderThemeCss", () => {
	const css = renderThemeCss();
	const block = (variant: "dark" | "light") => {
		const start = css.indexOf(`@variant ${variant} {`);
		return css.slice(start, css.indexOf("}", start));
	};

	it("writes every color token into both variants", () => {
		expect(block("dark")).toContain("--color-bg-canvas: #0b0e15;");
		expect(block("light")).toContain("--color-bg-canvas: #f5f6f8;");
		expect(block("light")).toContain("--color-text-accent: #4f6a08;");
		for (const name of Object.keys(COLOR_TOKENS)) {
			expect(block("dark")).toContain(`--color-${name.replace("/", "-")}:`);
		}
	});

	it("maps HeroUI variables to Betro tokens", () => {
		expect(block("dark")).toContain("--accent: #c6f432;");
		expect(block("dark")).toContain("--accent-foreground: #0b0e15;");
		expect(block("light")).toContain("--background: #f5f6f8;");
		expect(block("dark")).toContain("--danger: #ff6b6b;");
	});

	it("writes transit colors and radii once, outside variants", () => {
		expect(css).toContain("--color-transit-line-2: #00a84d;");
		expect(css).toContain("--color-transit-bus-trunk: #0068b7;");
		expect(css).toContain("--radius-2xl: 28px;");
	});

	it("matches the committed generated file", () => {
		const file = readFileSync(join(import.meta.dir, "theme.generated.css"), "utf8");
		expect(file).toBe(css);
	});
});

describe("colorToken", () => {
	it("returns the value for the requested mode", () => {
		expect(colorToken("accent/soft", "dark")).toBe("#26330a");
		expect(colorToken("accent/soft", "light")).toBe("#f0fbc8");
	});
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/theme` / Expected: FAIL (모듈 없음)
- [ ] **Step 3: 구현** — `tokens.ts`(위 표 그대로, `as const`), `renderThemeCss()`는 `@layer theme { :root { @variant dark {…} @variant light {…} } }` 안에 색·HeroUI 변수를, 그 밖 `@theme { … }`에 transit 색과 `--radius-*`를 쓴다(맨 위에 "생성 파일, 직접 고치지 말 것" 주석). `scripts/generate-theme-css.ts`는 결과를 `theme/theme.generated.css`에 쓴다. `package.json`에 `"theme:css": "bun scripts/generate-theme-css.ts"`. `global.css`는 기존 세 import 뒤에 `@import "./theme/theme.generated.css";`.
- [ ] **Step 4: 생성과 통과 확인** — Run: `cd apps/native && bun run theme:css && cd ../.. && bun test apps/native/theme` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(native): add Figma design tokens and generated theme css`

### Task 2: 폰트와 텍스트 스타일

**Files:**
- Create: `apps/native/scripts/subset-fonts.py`, `apps/native/assets/fonts/{NotoSansKR-Regular,NotoSansKR-Medium,NotoSansKR-Bold,NotoSansKR-Black,JetBrainsMono-Medium,JetBrainsMono-Bold}.ttf`, `apps/native/assets/fonts/subset-chars.txt`, `apps/native/theme/typography.ts`, `apps/native/theme/typography.test.ts`, `apps/native/components/ui/app-text.tsx`
- Modify: `apps/native/app.json`(expo-font 플러그인), `apps/native/package.json`(devDependencies `@expo-google-fonts/noto-sans-kr`, `@expo-google-fonts/jetbrains-mono`; dependency `expo-font`는 이미 있음)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type TextVariant = "displayL" | "title1" | "title2" | "title3" | "bodyL" | "bodyM" | "bodyMStrong" | "bodyS" | "labelM" | "labelS" | "caption" | "micro" | "dataXL" | "dataL" | "dataM" | "dataS"`
  - `TEXT_STYLES: Record<TextVariant, { fontFamily: FontFamily; fontSize: number; lineHeight: number; letterSpacing: number }>` (letterSpacing은 px)
  - `type FontFamily = "NotoSansKR-Regular" | "NotoSansKR-Medium" | "NotoSansKR-Bold" | "NotoSansKR-Black" | "JetBrainsMono-Medium" | "JetBrainsMono-Bold"`
  - `<AppText variant?: TextVariant (기본 "bodyM") className? ...TextProps>` — `style`로 `TEXT_STYLES[variant]`를 주고, 색은 `className`(기본 `text-text-primary`). `fontWeight`는 주지 않는다(Android에서 패밀리 이름과 충돌). `maxFontSizeMultiplier={1.3}`.

텍스트 스타일(Figma, 글꼴 크기/줄 높이/자간 %): Display/L Black 32/40 −2%, Title/1 Bold 24/32 −1.5%, Title/2 Bold 20/28 −1%, Title/3 Bold 17/24 −0.5%, Body/L Regular 16/24 −0.3%, Body/M Regular 15/22 −0.3%, Body/M Strong Medium 15/22 −0.3%, Body/S Regular 14/20 −0.2%, Label/M Medium 14/20 −0.2%, Label/S Medium 13/18 −0.2%, Caption Medium 12/16 0, Micro Bold 11/14 +1%, Data/XL JetBrains Mono Bold 28/32 −2%, Data/L Mono Bold 18/24 −1%, Data/M Mono Medium 14/20 0, Data/S Mono Medium 12/16 0. 자간 px = 크기 × % / 100, 소수 둘째 자리 반올림.

폰트 서브셋(Noto Sans KR 정적 TTF 한 굵기가 약 6MB라 그대로 넣지 않는다): 대상 글자 = U+0020–007E, U+00A0–00FF, U+2010–2027, U+2030–205E, U+2190–21FF, U+3000–303F, U+3131–318E, 그리고 U+AC00–D7A3 중 `euc-kr`로 인코딩되는 2,350자(KS X 1001; Python `euc-kr`이 UHC 확장 글자까지 인코딩하므로 KS X 1001 바이트 영역(0xB0A1–0xC8FE)으로 한 번 더 거른다). Noto 범위에는 ℃ 등을 위해 U+2100–214F도 추가한다. JetBrains Mono는 U+0020–007E, U+00A0–00FF, U+2010–2027, U+2190–21FF만. 원본은 devDependency 패키지의 정적 TTF(`400Regular`, `500Medium`, `700Bold`, `900Black` / `500Medium`, `700Bold`). 출력 파일 이름이 곧 RN `fontFamily`이므로 위 이름을 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트** — `typography.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEXT_STYLES } from "./typography";

describe("TEXT_STYLES", () => {
	it("copies Figma text styles", () => {
		expect(TEXT_STYLES.title1).toEqual({ fontFamily: "NotoSansKR-Bold", fontSize: 24, lineHeight: 32, letterSpacing: -0.36 });
		expect(TEXT_STYLES.micro).toEqual({ fontFamily: "NotoSansKR-Bold", fontSize: 11, lineHeight: 14, letterSpacing: 0.11 });
		expect(TEXT_STYLES.dataXL).toEqual({ fontFamily: "JetBrainsMono-Bold", fontSize: 28, lineHeight: 32, letterSpacing: -0.56 });
		expect(TEXT_STYLES.displayL.fontFamily).toBe("NotoSansKR-Black");
	});
});

describe("font subset", () => {
	const chars = readFileSync(join(import.meta.dir, "../assets/fonts/subset-chars.txt"), "utf8");
	it("covers all KS X 1001 hangul and the symbols the app uses", () => {
		const hangul = [...chars].filter((c) => c >= "가" && c <= "힣");
		expect(hangul.length).toBe(2350);
		for (const c of ["뚝", "섬", "·", "→", "…", "℃"]) expect(chars).toContain(c);
	});
	it("keeps each Noto Sans KR file under 2MB", () => {
		for (const w of ["Regular", "Medium", "Bold", "Black"]) {
			const size = Bun.file(join(import.meta.dir, `../assets/fonts/NotoSansKR-${w}.ttf`)).size;
			expect(size).toBeLessThan(2_000_000);
		}
	});
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/theme/typography.test.ts` / Expected: FAIL
- [ ] **Step 3: 서브셋 스크립트와 폰트 생성** — `scripts/subset-fonts.py`가 위 범위로 `subset-chars.txt`를 쓰고 `pyftsubset`(`--layout-features='*' --name-IDs='*'`)으로 6개 파일을 만든다. Run: `cd apps/native && bun add -d @expo-google-fonts/noto-sans-kr @expo-google-fonts/jetbrains-mono && uvx --from fonttools python scripts/subset-fonts.py` / Expected: `assets/fonts/`에 TTF 6개, Noto 파일이 각각 2MB 미만
- [ ] **Step 4: `typography.ts`, `app-text.tsx` 구현, `app.json` plugins에 `["expo-font", { "fonts": [<assets/fonts의 6개 경로>] }]` 추가**
- [ ] **Step 5: 통과 확인** — Run: `bun test apps/native/theme` / Expected: PASS
- [ ] **Step 6: 커밋** — `feat(native): add subset Noto Sans KR and JetBrains Mono with text styles`

### Task 3: 기기 저장 — 환경설정과 설치 ID

**Files:**
- Create: `apps/native/lib/preferences/preferences.ts`, `apps/native/lib/preferences/preferences.test.ts`, `apps/native/lib/preferences/preferences-store.ts`, `apps/native/lib/preferences/preferences-store.test.ts`, `apps/native/lib/preferences/app-preferences.ts`, `apps/native/lib/preferences/use-preferences.ts`, `apps/native/lib/device/install-identity.ts`, `apps/native/lib/device/install-identity.test.ts`, `apps/native/lib/device/app-install-identity.ts`
- Modify: `apps/native/contexts/app-theme-context.tsx`, `apps/native/package.json`(`expo-sqlite`, `expo-crypto` 추가)

**Interfaces:**
- Produces:
  - `type ThemePreference = "system" | "dark" | "light"`
  - `interface Preferences { version: 1; onboardingCompleted: boolean; themeMode: ThemePreference; mapQuality: "high3d" | "standard"; show3dBuildings: boolean; smoothVehicleMotion: boolean; dataSaver: boolean; commuteLiveActivityEnabled: boolean }`
  - `DEFAULT_PREFERENCES: Preferences` = `{ version: 1, onboardingCompleted: false, themeMode: "system", mapQuality: "high3d", show3dBuildings: true, smoothVehicleMotion: true, dataSaver: false, commuteLiveActivityEnabled: true }`
  - `PREFERENCES_KEY = "betro.preferences"`
  - `parsePreferences(raw: string | null): Preferences` — zod로 필드별 검증, 잘못된 필드만 기본값으로
  - `toUniwindTheme(mode: ThemePreference): "system" | "dark" | "light"` (그대로 돌려주는 함수지만 Uniwind 호출 지점을 하나로 모음)
  - `interface SyncKeyValue { getItem(key: string): string | null; setItem(key: string, value: string): void }`
  - `createPreferencesStore(kv: SyncKeyValue): PreferencesStore`, `interface PreferencesStore { get(): Preferences; update(patch: Partial<Omit<Preferences, "version">>): Preferences; subscribe(listener: () => void): () => void }`
  - `appPreferences: PreferencesStore` (`app-preferences.ts`, `expo-sqlite/kv-store`의 `Storage.getItemSync/setItemSync`로 묶음)
  - `usePreferences(): [Preferences, (patch) => void]` (`useSyncExternalStore`)
  - `interface InstallIdentity { installId: string; secret: string }`
  - `interface SecureKeyValue { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }`
  - `interface RandomSource { uuid(): string; bytes(length: number): Uint8Array }`
  - `INSTALL_ID_KEY = "betro.installId"`, `INSTALL_SECRET_KEY = "betro.installSecret"`
  - `getOrCreateInstallIdentity(store: SecureKeyValue, random: RandomSource): Promise<InstallIdentity>` — secret은 32바이트 base64url(패딩 없음, 43자)
  - `ensureInstallIdentity(): Promise<InstallIdentity>` (`app-install-identity.ts`, `expo-secure-store` + `expo-crypto`로 묶음)

- [ ] **Step 1: 실패하는 테스트** — `preferences.test.ts`, `preferences-store.test.ts`, `install-identity.test.ts`

```ts
// preferences.test.ts
it("returns defaults for missing or broken data", () => {
	expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
	expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
	expect(parsePreferences(JSON.stringify({ version: 99 }))).toEqual(DEFAULT_PREFERENCES);
});
it("keeps valid fields and replaces invalid ones", () => {
	const raw = JSON.stringify({ version: 1, themeMode: "dark", dataSaver: "yes", onboardingCompleted: true });
	expect(parsePreferences(raw)).toEqual({ ...DEFAULT_PREFERENCES, themeMode: "dark", onboardingCompleted: true });
});
it("passes the saved theme straight to Uniwind", () => {
	expect(toUniwindTheme("system")).toBe("system");
	expect(toUniwindTheme("light")).toBe("light");
});

// preferences-store.test.ts
it("persists updates and notifies subscribers", () => {
	const map = new Map<string, string>();
	const kv = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
	const store = createPreferencesStore(kv);
	let calls = 0;
	const unsubscribe = store.subscribe(() => calls++);
	store.update({ themeMode: "light" });
	expect(store.get().themeMode).toBe("light");
	expect(parsePreferences(map.get(PREFERENCES_KEY) ?? null).themeMode).toBe("light");
	expect(calls).toBe(1);
	unsubscribe();
	store.update({ dataSaver: true });
	expect(calls).toBe(1);
	expect(createPreferencesStore(kv).get().dataSaver).toBe(true);
});

// install-identity.test.ts
const random = { uuid: () => "11111111-1111-4111-8111-111111111111", bytes: (n: number) => new Uint8Array(n).fill(7) };
it("creates and stores both values on first run", async () => {
	const store = memorySecureStore();
	const id = await getOrCreateInstallIdentity(store, random);
	expect(id.installId).toBe("11111111-1111-4111-8111-111111111111");
	expect(id.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(await getOrCreateInstallIdentity(store, { uuid: () => "other", bytes: random.bytes })).toEqual(id);
});
it("regenerates both when only one value is stored", async () => {
	const store = memorySecureStore({ [INSTALL_ID_KEY]: "stale-id" });
	const id = await getOrCreateInstallIdentity(store, random);
	expect(id.installId).toBe("11111111-1111-4111-8111-111111111111");
	expect(await store.getItem(INSTALL_SECRET_KEY)).toBe(id.secret);
});
it("propagates storage errors instead of returning a partial identity", async () => {
	const failing = { getItem: async () => { throw new Error("keychain locked"); }, setItem: async () => {} };
	await expect(getOrCreateInstallIdentity(failing, random)).rejects.toThrow("keychain locked");
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/preferences apps/native/lib/device` / Expected: FAIL
- [ ] **Step 3: 순수 모듈 구현** — `preferences.ts`, `preferences-store.ts`, `install-identity.ts`
- [ ] **Step 4: 어댑터와 테마 연결** — `bun add expo-sqlite expo-crypto`(apps/native). `app-preferences.ts`, `use-preferences.ts`, `app-install-identity.ts` 작성. `app-theme-context.tsx`는 `usePreferences()`의 `themeMode`를 `Uniwind.setTheme(toUniwindTheme(mode))`로 반영하고 `setThemeMode(mode: ThemePreference)`를 내보낸다(`toggleTheme` 제거). 첫 렌더 전에 저장된 테마가 적용되도록 `app/_layout.tsx` 모듈 최상단에서 한 번 `Uniwind.setTheme(toUniwindTheme(appPreferences.get().themeMode))`를 부른다.
- [ ] **Step 5: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [ ] **Step 6: 커밋** — `feat(native): add preferences store and install identity`

### Task 4: 앱 껍데기 — 하단 탭과 템플릿 정리

**Files:**
- Create: `apps/native/app/(tabs)/_layout.tsx`, `apps/native/app/(tabs)/index.tsx`(지도), `apps/native/app/(tabs)/favorites.tsx`, `apps/native/app/(tabs)/commute.tsx`, `apps/native/app/(tabs)/settings.tsx`(Task 6에서 채움, 여기선 자리만), `apps/native/components/navigation/tab-bar.tsx`, `apps/native/components/navigation/tabs.ts`, `apps/native/components/navigation/tabs.test.ts`, `apps/native/components/ui/screen.tsx`
- Modify: `apps/native/app/_layout.tsx`, `apps/native/utils/orpc.ts`(쿠키 헤더 제거), `apps/native/app.json`(splash 배경 #0b0e15/#f5f6f8, `expo-build-properties`의 `ios.deploymentTarget: "17.2"`), `apps/native/package.json`
- Delete: `apps/native/app/(drawer)/`, `apps/native/app/modal.tsx`, `apps/native/components/{sign-in,sign-up,theme-toggle,container}.tsx`, `apps/native/lib/auth-client.ts`, 사용하지 않는 템플릿 이미지(`partial-react-logo.png`, `react-logo*.png`)
- Remove deps: `@better-auth/expo`, `better-auth`, `@tanstack/react-form`

**Interfaces:**
- Consumes: `AppText`(Task 2), 토큰 클래스(Task 1)
- Produces:
  - `TABS: readonly { name: "index" | "favorites" | "commute" | "settings"; label: string; icon: "map" | "star" | "route" | "settings" }[]` = 지도(map), 즐겨찾기(star), 출퇴근(route), 설정(settings) 순
  - `<TabBar {...BottomTabBarProps}>` — iOS는 Figma `TabBar / Platform=iOS`(노드 5:39, 떠 있는 유리 알약 `bg-bg-glass`, 활성 탭은 `bg-bg-hover` 위 accent 아이콘·라벨. 지도 화면을 붙이는 3단계 전에 expo-blur `BlurView`(또는 iOS 26 glass)를 배경으로 깐다), Android는 `Platform=Android`(노드 5:139, 화면 너비 바, 활성 탭 아이콘 뒤 `bg-accent-soft` 알약). `accessibilityRole="tab"`, `accessibilityState={{ selected }}`.
  - `<Screen title?: string; scroll?: boolean; children>` — safe area, `bg-bg-canvas`, 큰 제목(Title/1 또는 Figma `LargeTitle`)
  - 라우트: `/`(지도), `/favorites`, `/commute`, `/settings`. 지도·즐겨찾기·출퇴근은 이 계획에서 제목만 있는 자리 화면이다(3·2·4단계 계획에서 채움).

- [ ] **Step 1: 실패하는 테스트** — `tabs.test.ts`

```ts
it("lists the four MVP tabs in order", () => {
	expect(TABS.map((t) => t.label)).toEqual(["지도", "즐겨찾기", "출퇴근", "설정"]);
	expect(TABS.map((t) => t.name)).toEqual(["index", "favorites", "commute", "settings"]);
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/components/navigation` / Expected: FAIL
- [ ] **Step 3: 구현** — `tabs.ts`, `tab-bar.tsx`(아이콘은 `tabs.ts`의 이름을 Lucide 컴포넌트로 바꾸는 표를 `tab-bar.tsx` 안에 둔다), `(tabs)/_layout.tsx`(`<Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>`), 자리 화면 3개, `screen.tsx`. 루트 `_layout.tsx`는 Drawer·modal을 빼고 `Stack`에 `(tabs)`만 남긴다(Task 5에서 온보딩 보호 추가). 템플릿 파일과 의존성 삭제, `utils/orpc.ts`의 `authClient` 쿠키 처리 제거.
- [ ] **Step 4: 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types && cd ../.. && bunx ultracite check apps/native` / Expected: PASS, `better-auth`·`auth-client` 참조 0건(`grep -r "auth-client\|better-auth" apps/native --include=*.ts --include=*.tsx` 결과 없음)
- [ ] **Step 5: 커밋** — `feat(native): replace template drawer with four-tab shell`

### Task 5: 온보딩과 권한

**Files:**
- Create: `apps/native/app/onboarding/_layout.tsx`, `apps/native/app/onboarding/index.tsx`(01), `apps/native/app/onboarding/permissions.tsx`(02), `apps/native/lib/onboarding/onboarding.ts`, `apps/native/lib/onboarding/onboarding.test.ts`, `apps/native/lib/permissions/permissions.ts`(어댑터), `apps/native/assets/images/onboarding-map.png`
- Modify: `apps/native/app/_layout.tsx`, `apps/native/components/push-notifications.tsx`, `apps/native/lib/push/use-push-notifications.ts`, `apps/native/lib/push/push-messaging.ts`, `apps/native/app.json`(`expo-location` 플러그인). Create `apps/native/lib/push/push-launch.ts`·`push-launch.test.ts`(react-native를 import하는 `push-messaging.ts`는 bun이 로드하지 못해 순수 함수를 분리), `apps/native/package.json`(`expo-location`)

**Interfaces:**
- Consumes: `appPreferences`, `usePreferences`(Task 3), `AppText`, `Screen`
- Produces:
  - `type PermissionStatus = "granted" | "denied" | "undetermined"`
  - `interface PermissionsState { location: PermissionStatus; notifications: PermissionStatus }`
  - `completeOnboarding(store: PreferencesStore): void` — `onboardingCompleted: true` 저장. 권한 상태를 받지 않으므로 "계속"과 "나중에"는 권한 결과와 상관없이 앱으로 간다(처음 계획한 `canSkipToApp(): true`는 앱 코드에서 쓸 곳이 없어 빼고 이 규칙을 테스트 이름으로 남김)
  - `shouldShowOnboarding(prefs: Preferences): boolean`
  - `subscribeOptionsForLaunch(): { requestPermission: false }` (`lib/push/push-launch.ts`, 순수 함수. 같은 파일의 `PushSubscribeOptions`, `permissionStepFor(options): "request" | "check"`도 쓴다) — `usePushNotifications`는 이 옵션을 받아 앱 시작 시 권한을 요청하지 않고, 이미 허용된 경우에만 토큰 조회·구독한다. 권한 요청은 02 권한 화면에서만.
  - 어댑터 `requestLocationPermission(): Promise<PermissionStatus>`, `requestNotificationPermission(): Promise<PermissionStatus>`, `getPermissionsState(): Promise<PermissionsState>`
  - 루트: `<Stack.Protected guard={!shouldShowOnboarding(prefs)}>`에 `(tabs)`, `guard={shouldShowOnboarding(prefs)}`에 `onboarding`

화면 세부:
- 01 온보딩(Figma 12:1580): 배경은 `MapCanvas` 인스턴스(12:1581)를 화면 너비에 맞춰 3배로 내보낸 PNG(`onboarding-map.png`, Figma MCP `get_screenshot` 또는 `download_assets`)와 아래로 `bg-bg-canvas`로 사라지는 그라데이션. 로고, 제목, 부제, 기능 3줄(Lucide 아이콘 `Zap`, `Route`, `Box`. 두 번째 줄은 문구가 바뀌어 Figma의 `Bell` 대신 `Route`), 페이지 점, "시작하기"(→ `/onboarding/permissions`). 온보딩·권한 화면은 Figma처럼 항상 다크로 그린다(`<ScopedTheme theme="dark">`, uniwind 1.13).
- 02 권한(12:3140): 위치·알림 카드의 "허용" 버튼은 각 권한을 요청하고, 허용되면 버튼이 "허용됨"(비활성)으로 바뀐다. "계속"과 "나중에"는 둘 다 `completeOnboarding`만 한다. 이동은 루트 `Stack.Protected` guard가 바뀔 때 expo-router가 탭으로 보낸다(같은 틱에 `router.replace("/")`를 부르면 guard가 아직 닫혀 있어 처리되지 않는다).
- `app.json`: `["expo-location", { "locationWhenInUsePermission": "내 주변 역과 정류장을 바로 보여주기 위해 위치를 사용해요." }]`

- [ ] **Step 1: 실패하는 테스트** — `onboarding.test.ts`

```ts
it("shows onboarding until it is completed", () => {
	expect(shouldShowOnboarding(DEFAULT_PREFERENCES)).toBe(true);
	expect(shouldShowOnboarding({ ...DEFAULT_PREFERENCES, onboardingCompleted: true })).toBe(false);
});
it("completes onboarding without looking at permissions, even when both are denied", () => {
	const store = createPreferencesStore(memoryKv());
	completeOnboarding(store);
	expect(shouldShowOnboarding(store.get())).toBe(false);
});
```

`lib/push/push-launch.test.ts`(새 파일, 기존 `push-message.test.ts` 옆)에 시작 시 요청하지 않는 규칙을 고정한다: `subscribeOptionsForLaunch()`가 `{ requestPermission: false }`를 돌려준다(`push-launch.ts`에 순수 함수로 추가, `use-push-notifications.ts`가 이 값을 쓴다).

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/onboarding apps/native/lib/push` / Expected: FAIL
- [ ] **Step 3: 구현** — 순수 모듈, 권한 어댑터, 두 화면, 루트 보호 라우트, `PushNotifications`가 시작 시 권한을 요청하지 않게 변경(이미 허용된 경우에만 토큰 조회·구독), `bun add expo-location`, 온보딩 이미지 내보내기
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(native): add onboarding and permission screens`

### Task 6: 설정(게스트)과 데이터 출처

**Files:**
- Create: `apps/native/app/settings/data-sources.tsx`(13), `apps/native/lib/legal/data-sources.ts`, `apps/native/lib/legal/data-sources.test.ts`, `apps/native/components/ui/list-row.tsx`, `apps/native/components/ui/status-tag.tsx`
- Modify: `apps/native/app/(tabs)/settings.tsx`(12), `apps/native/app/_layout.tsx`(Stack에 `settings/data-sources`), `apps/native/package.json`(`expo-application`)

**Interfaces:**
- Consumes: `usePreferences`, `useAppTheme().setThemeMode`(Task 3), `Screen`, `AppText`
- Produces:
  - `type StatusKind = "live" | "estimated" | "delayed" | "ended"`
  - `STATUS_LEGEND: { kind: StatusKind; label: string; description: string }[]` = 실시간 / 실시간 위치 API로 확인된 위치, 시간표 추정 / 역 도착 신호와 시간표로 계산한 위치, 지연 / 운영 기관 지연 정보 반영, 운행 종료 / 운행이 끝났거나 정보가 없어요
  - `DATA_PROVIDERS: { title: string; subtitle: string; url: string }[]` = 서울특별시(https://data.seoul.go.kr), 공공데이터포털(https://www.data.go.kr), 국가철도공단(https://data.kric.go.kr), © OpenStreetMap contributors(https://www.openstreetmap.org/copyright) — 부제는 "문구 변경" 표와 Figma
  - `DATA_SOURCES_FOOTNOTE = "공공누리 제1유형 · 갱신 주기는 노선과 시간대에 따라 달라요"`
  - `<StatusTag kind: StatusKind>` — Figma `StatusTag`(점 + 라벨, `bg-status-*-soft`, `text-status-*`, ended는 `status/neutral-soft`·`text-text-tertiary`)
  - `<ListRow title; subtitle?; icon?; trailing: { type: "chevron" } | { type: "toggle"; value: boolean; onChange(v: boolean): void } | { type: "value"; text: string } | { type: "none" }; onPress? }` — Figma `ListRow`

설정 화면(Figma `iOS / 12 Settings (Guest)`, 문구 변경 반영): 섹션 "화면" — 테마 세그먼트(다크/라이트/시스템 → `setThemeMode`), 지도 품질(값 "고화질 3D"/"표준", 누르면 두 값 전환), 3D 건물(토글), 부드러운 차량 이동(토글, 부제 "위치를 보간해 자연스럽게 움직여요"), 데이터 절약 모드(토글). 섹션 "알림" — 출퇴근 잠금화면 안내(토글, `commuteLiveActivityEnabled`). 섹션 "정보" — 데이터 출처(→ `/settings/data-sources`), 버전(`expo-application`의 `nativeApplicationVersion`). 각 데이터 출처 행은 `Linking.openURL(url)`.

- [ ] **Step 1: 실패하는 테스트** — `data-sources.test.ts`

```ts
it("credits OpenStreetMap under ODbL and every public data provider", () => {
	expect(DATA_PROVIDERS.map((p) => p.title)).toEqual(["서울특별시", "공공데이터포털", "국가철도공단", "© OpenStreetMap contributors"]);
	expect(DATA_PROVIDERS[3].subtitle).toContain("ODbL");
	expect(DATA_PROVIDERS[3].url).toBe("https://www.openstreetmap.org/copyright");
	expect(DATA_SOURCES_FOOTNOTE).toContain("공공누리 제1유형");
});
it("explains all four position states", () => {
	expect(STATUS_LEGEND.map((s) => s.kind)).toEqual(["live", "estimated", "delayed", "ended"]);
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/legal` / Expected: FAIL
- [ ] **Step 3: 구현** — `data-sources.ts`, `list-row.tsx`, `status-tag.tsx`, 두 화면, `bun add expo-application`
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types` / Expected: PASS
- [ ] **Step 5: 커밋** — `feat(native): add guest settings and data sources screens`

### Task 7: 크래시 수집과 설치 ID 생성, 기기 확인

**Files:**
- Create: `apps/native/lib/crash/crash-reporting.ts`, `apps/native/lib/crash/crash-reporting.test.ts`, `apps/native/lib/crash/app-crash-reporting.ts`
- Modify: `apps/native/app/_layout.tsx`(ErrorBoundary export, 설치 ID 생성), `apps/native/app/(tabs)/settings.tsx`(개발 빌드 전용 "크래시 시험" 행), `apps/native/app.json`(`@react-native-firebase/crashlytics` 플러그인), `apps/native/package.json`(`@react-native-firebase/crashlytics@27.1.0`)

**Interfaces:**
- Consumes: `ensureInstallIdentity`(Task 3)
- Produces:
  - `interface CrashSink { recordError(error: Error, context?: string): void; setAttribute(key: string, value: string): void; setCollectionEnabled(enabled: boolean): void }`
  - `toError(value: unknown): Error` — 문자열·객체도 `Error`로 바꿔 기록
  - `configureCrashReporting(sink: CrashSink, opts: { isDev: boolean }): void` — 개발 빌드에서는 수집 끔
  - `reportError(sink: CrashSink, value: unknown, context: string): void`
  - `appCrashSink: CrashSink`(`app-crash-reporting.ts`, Crashlytics 래핑)
  - 루트 `_layout.tsx`에서 `export function ErrorBoundary`(expo-router)로 화면 오류를 기록하고 "다시 시도" 버튼을 보여줌. 시작 시 `ensureInstallIdentity()`를 부르고, 실패하면 `reportError(..., "install-identity")`만 하고 앱은 계속(다음 실행에 다시 시도). 성공하면 `setAttribute("installId", id.installId)`.

- [ ] **Step 1: 실패하는 테스트** — `crash-reporting.test.ts`

```ts
it("turns any thrown value into an Error", () => {
	expect(toError("boom").message).toBe("boom");
	expect(toError({ code: 1 }).message).toBe('{"code":1}');
	const e = new Error("x");
	expect(toError(e)).toBe(e);
});
it("disables collection in dev builds", () => {
	const calls: boolean[] = [];
	configureCrashReporting({ recordError() {}, setAttribute() {}, setCollectionEnabled: (v) => calls.push(v) }, { isDev: true });
	expect(calls).toEqual([false]);
});
it("records errors with context", () => {
	const recorded: [string, string | undefined][] = [];
	reportError({ recordError: (e, c) => recorded.push([e.message, c]), setAttribute() {}, setCollectionEnabled() {} }, "nope", "install-identity");
	expect(recorded).toEqual([["nope", "install-identity"]]);
});
```

- [ ] **Step 2: 실패 확인** — Run: `bun test apps/native/lib/crash` / Expected: FAIL
- [ ] **Step 3: 구현** — 순수 모듈, Crashlytics 어댑터, 루트 연결, 설정의 개발 전용 행(`__DEV__`일 때만, 누르면 `crashlytics().crash()`), `bun add @react-native-firebase/crashlytics@27.1.0`, `app.json` 플러그인 추가
- [ ] **Step 4: 통과 확인** — Run: `bun test apps/native && cd apps/native && bun run check-types && cd ../.. && bunx ultracite check apps/native` / Expected: PASS
- [ ] **Step 5: 기기 빌드와 화면 확인** — Run: `cd apps/native && bunx expo prebuild --clean && bunx expo run:ios --device "iPhone 16"`, 이어서 Android 에뮬레이터(`bunx expo run:android`, 에뮬레이터가 없으면 사용자에게 실기기 연결을 요청) / Expected: 첫 실행에 온보딩 → 권한 → 지도 탭. 각 화면(온보딩, 권한, 탭 4개, 설정 다크·라이트, 데이터 출처)을 `xcrun simctl io booted screenshot`·`adb exec-out screencap -p`로 찍어 Figma 프레임과 나란히 비교하고, 차이를 고친다. 확인 항목: Noto Sans KR가 실제로 쓰였는지(시스템 폰트 아님), 테마 "시스템"에서 기기 다크 모드 전환을 바로 따라가는지, 테마를 "라이트"로 바꾸고 앱을 다시 켰을 때 첫 화면부터 라이트인지, 권한 "나중에" 뒤 재실행 시 권한 요청이 뜨지 않는지, 설치 ID가 재실행 뒤에도 같은지(개발 로그).
- [ ] **Step 6: 크래시 수집 연결 확인(사용자)** — 사용자에게 Firebase 콘솔 Crashlytics에서 iOS·Android 앱이 "SDK 연결됨"으로 보이는지 확인을 요청한다. Expected: 두 앱 모두 연결됨. 실제 크래시 기록 확인은 개발 빌드에서 수집을 끄므로 출시 준비(MVP 5단계)의 release 빌드에서 한다.
- [ ] **Step 7: 커밋** — `feat(native): add crash reporting and install identity bootstrap`
