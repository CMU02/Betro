# 1단계: 지하철 역 대응표와 선로 모양 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 API의 역 ID(`statnId`)를 좌표와 시간표 코드에 잇는 역 대응표(`station_crosswalk`)와, OSM 선로를 노선·갈래·방향별 폴리라인으로 만들고 그 위에 역 위치(선 시작점부터의 거리)를 올린 선로 데이터(`track_shape`, `track_station`)를 배치 작업으로 만들어 참조 DB에 적재한다.

**Architecture:** 새 워크스페이스 패키지 `packages/transit-static`(`@Betro/transit-static`)에 순수 함수(파싱, 매칭, 선로 조립, 투영, 검증)와 얇은 I/O 계층(다운로드, 원본 보관, DB 적재)과 CLI를 둔다. 원본 파일은 `data/raw/<source>/` 아래에 그대로 보관하고 SHA-256 해시가 같으면 다시 적재하지 않는다. 참조 DB 테이블은 `packages/db`의 Drizzle 스키마에 추가하고, 배치마다 `reference_batch` 행을 만들어 버전을 매긴다. 모든 순수 함수는 인라인 픽스처로 `bun test`한다. 실제 원본 파일을 쓰는 통합 테스트는 파일이 없으면 건너뛴다.

**Tech Stack:** Bun 1.4, TypeScript, Drizzle ORM 1.0.0-rc.5 + libsql(SQLite), `read-excel-file` 9.3.14(xlsx 읽기), `@turf/nearest-point-on-line` · `@turf/length` · `@turf/distance` · `@turf/helpers` 7.4.0(측지 계산), Overpass API(OSM), Biome/Ultracite.

**Spec:** `docs/superpowers/specs/2026-10-30-data-collection-design.md` 6.1절, 6.2절, 9.2절, 13장 1단계. 사실 근거는 `docs/research/2026-10-30-data-sources.md` 1장, 4장.

## Global Constraints

- 범위는 실시간 API가 응답하는 19개 노선 전체이며 서울 밖 구간을 포함한다. subwayId: 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1063, 1065, 1067, 1075, 1077, 1092, 1093, 1081, 1032, 1094.
- 런타임 조인 키는 `statn_id` 문자열(10자리)만 쓴다. 숫자로 바꾸지 않는다.
- 좌표는 WGS84(EPSG:4326), 내부 순서는 `[lng, lat]`(GeoJSON 순서). 거리는 미터.
- 선로 모양은 전부 OSM에서만 가져온다. 비OSM 선로 데이터와 섞지 않는다. 선로 데이터에는 출처 문자열 `© OpenStreetMap contributors (ODbL)`을 붙인다.
- 네이버 지도 SDK에서 얻은 좌표나 경로는 저장하지 않는다.
- 받은 원본 파일은 그대로 보관한다. 원본 해시가 이전과 같으면 다시 적재하지 않는다.
- 매칭 안 된 역이 하나라도 있으면 배치가 실패하고 DB에 적재하지 않는다.
- `openapi.seoul.go.kr:8088`은 HTTP(평문)만 된다(8088 포트는 TLS 불가, 443 HTTPS는 시간 초과). `datafile.seoul.go.kr`는 HTTPS가 된다. 키가 평문으로 전송되는 위험은 서버 측 수집으로만 한정한다(스펙 §4.2). 코드에서 URL은 상수로 두고 주석에 이유를 적는다.
- 코드 스타일은 Ultracite(Biome). 커밋 전에 `bunx ultracite fix`를 돌린다. 테스트 파일은 소스 옆에 `*.test.ts`로 둔다.
- 키 의존성: 실시간도착_역정보 xlsx와 OSM은 키가 없다. 역사마스터(OA-21232)와 역 검색(OA-121)은 서울 열린데이터광장 **일반 인증키**가 필요하다(즉시 발급). 키는 환경 변수 `SEOUL_OPEN_API_KEY`로만 받고 코드와 저장소에 넣지 않는다. 키가 없어도 Task 1~6, 8~10의 모든 테스트는 통과해야 한다.
- 커밋 메시지에 attribution 트레일러를 넣지 않는다.

## Review Focus

1. **xlsx의 `STATN_ID`가 숫자 셀로 들어 있을 때** `read-excel-file`은 number로 돌려준다. 10자리 문자열로 복원해야 하며(`1001000101`처럼 앞자리가 0이 아니라 손실은 없지만 타입이 number가 됨), `SUBWAY_ID`도 마찬가지다. Task 3의 테스트가 number 입력을 다룬다.
2. **역사마스터에 같은 노선·같은 이름 레코드가 둘인 경우**(7호선 까치울~부평구청 27xx/37xx 이중 등재). 매칭은 실패가 아니라 첫 레코드를 쓰고 `quality_flags`에 `duplicate-master`를 남겨야 한다. Task 5의 테스트가 이를 고정한다.
3. **OSM way 사이에 틈이 있거나(끝점 불일치) 분기가 있을 때** 조용히 이어 붙이면 선로가 엉뚱한 곳으로 튄다. 틈은 오류로 보고하고 그 shape는 적재하지 않는다. Task 9의 테스트가 틈을 다룬다.
4. **같은 노선의 역이 여러 갈래 shape 근처에 있을 때**(5호선 강동, 2호선 성수). 역은 150m 안에 있는 모든 shape에 들어가야 하고, 어느 shape에도 150m 안에 없는 역은 오류다. Task 10, 11의 테스트가 이를 다룬다.
5. **역사마스터 `ROUTE` 또는 OA-121 `LINE_NUM`에 처음 보는 노선 문자열이 올 때**(새 노선, 표기 변경). 무시하면 그 노선 역이 전부 미매칭이 되어 원인을 알기 어렵다. 매핑되지 않은 노선 문자열은 그 값과 건수를 보고서에 적고 배치를 실패시킨다. Task 5의 테스트가 이를 고정한다.

## 실행 방식과 모델 배정

실행은 superpowers:subagent-driven-development로 한다. Task마다 구현 서브에이전트 하나, 리뷰 서브에이전트 하나. 사용자 지시(2026-10-31): 주 구현은 Opus 5.5, 난이도와 작업량에 따라 Sonnet 5.5·Haiku 5.5를 섞는다.

| Task | 구현 모델 | 이유 |
|---|---|---|
| 1 패키지 뼈대, 원본 저장소 | Sonnet 5.5 | 인터페이스와 테스트가 정해진 보일러플레이트 |
| 2 DB 스키마 | Sonnet 5.5 | 기존 `auth.ts` 패턴 복제, 마이그레이션 생성 |
| 3 xlsx 파싱 | Sonnet 5.5 | 작은 파서, 테스트 완비 |
| 4 열린데이터광장 클라이언트 | Sonnet 5.5 | 응답 봉투 파싱과 페이징, 테스트 완비 |
| 5 정규화·3단계 매칭 | Opus 5.5 | 매칭 규칙의 우선순위와 플래그 처리에 판단이 필요 |
| 6 코드 붙이기·판 차이 | Haiku 5.5 | 순수 함수 둘, 테스트가 결과를 완전히 고정 |
| 7 대응표 빌드·적재·실데이터 | Opus 5.5 | 실제 원본을 보고 매뉴얼 표를 채우는 큐레이션 |
| 8 Overpass·OSM 모델·탐색 | Sonnet 5.5 | 질의 문자열과 인덱싱, 테스트 완비 |
| 9 way 이어 붙이기 | Opus 5.5 | 방향 결정과 틈 처리 알고리즘 |
| 10 투영·검증 | Sonnet 5.5 | turf 호출과 규칙 적용, 테스트 완비 |
| 11 선로 조립·적재·실데이터 | Opus 5.5 | 19개 노선 relation 큐레이션과 OSM 오류 판단 |

리뷰 서브에이전트는 모든 Task에서 Opus 5.5. 마지막 브랜치 전체 리뷰도 Opus 5.5.

---

## 파일 구조

```
packages/transit-static/
  package.json                      @Betro/transit-static, bun test, cli 스크립트
  tsconfig.json                     @Betro/config/tsconfig.base.json 상속
  README.md                         CLI 사용법, 키 발급 안내, 데이터 디렉터리 설명
  src/
    lines.ts                        19개 노선 상수(subwayId ↔ lineKey), LineKey 타입
    paths.ts                        데이터 디렉터리 경로 계산
    raw-store.ts                    원본 저장, 해시, 최신 원본 읽기
    reports.ts                      보고서(JSON+Markdown) 쓰기
    sources/
      station-xlsx.ts               OA-12764 첨부 xlsx 다운로드, 행 파싱
      seoul-open-api.ts             openapi.seoul.go.kr 클라이언트(역사마스터, 역 검색)
      overpass.ts                   Overpass 질의 생성과 호출
    crosswalk/
      normalize-name.ts             역명 정규화
      source-line-names.ts          출처별 노선 문자열 → lineKey
      match.ts                      3단계 매칭
      attach-codes.ts               OA-121의 STATION_CD/FR_CODE 붙이기
      diff.ts                       xlsx 판 사이 차이
      build.ts                      대응표 빌드 오케스트레이션(순수: 입력 → 결과+보고)
    track/
      osm-model.ts                  Overpass JSON 타입과 인덱싱
      stitch.ts                     way 이어 붙이기
      project.ts                    역 좌표 → 선 위 거리
      validate.ts                   shape 검증(순서, 간격)
      assemble.ts                   shape 조립 오케스트레이션(순수)
    db/
      load.ts                       reference_batch 생성, 대응표·선로 적재, current 전환
    jobs/
      fetch-station-xlsx.ts
      fetch-station-master.ts
      fetch-station-search.ts
      build-crosswalk.ts
      osm-discover.ts
      fetch-osm.ts
      build-tracks.ts
    cli.ts                          명령 분기
    manual/
      station-aliases.json          수동 별칭(리뷰 대상)
      source-line-names.json        master ROUTE, OA-121 LINE_NUM → lineKey
      osm-routes.json               노선별 OSM relation id, 갈래, 방향
packages/db/src/schema/transit.ts   reference_batch, station_crosswalk, track_shape, track_station
packages/db/src/schema/index.ts     transit 재export 추가
packages/db/src/migrations/         drizzle-kit generate 결과
data/                               (gitignore) raw/, reports/
```

데이터 디렉터리: 환경 변수 `BETRO_DATA_DIR`, 기본값은 저장소 루트의 `data`. 하위에 `raw/<source>/<파일명>`과 `reports/<job>/<ISO시각>.{json,md}`.

DB: CLI는 `DATABASE_URL`(기본값 `file:./local.db`, 저장소 루트 기준)을 쓴다. 기존 `apps/server/.env`의 값과 같은 파일을 가리키도록 CLI는 저장소 루트에서 실행한다.

---

### Task 1: 패키지 뼈대, 노선 상수, 원본 저장소

**Files:**
- Create: `packages/transit-static/package.json`, `packages/transit-static/tsconfig.json`, `packages/transit-static/README.md`
- Create: `packages/transit-static/src/lines.ts`, `packages/transit-static/src/paths.ts`, `packages/transit-static/src/raw-store.ts`
- Test: `packages/transit-static/src/lines.test.ts`, `packages/transit-static/src/raw-store.test.ts`
- Modify: `package.json`(루트) scripts에 `"transit": "bun --cwd packages/transit-static run cli"`, `"test": "bun test"` 추가
- Modify: `.gitignore`에 `data/` 추가

**Interfaces:**
- Produces:
  - `type LineKey = "line1" | "line2" | ... | "sillim"` (19개). 값: `line1 line2 line3 line4 line5 line6 line7 line8 line9 gyeongui-jungang airport gyeongchun suin-bundang shinbundang ui-sinseol seohae gyeonggang gtx-a sillim`
  - `const LINES: readonly { lineKey: LineKey; subwayId: string; nameKo: string }[]` (nameKo는 실시간 API 한글 노선명: 1호선 … 경의중앙선, 공항철도, 경춘선, 수인분당선, 신분당선, 우이신설선, 서해선, 경강선, GTX-A, 신림선)
  - `lineKeyBySubwayId(subwayId: string): LineKey | undefined`
  - `resolveDataDir(env: Record<string, string | undefined>): string`
  - `rawPath(dataDir: string, source: string, fileName: string): string`
  - `sha256Hex(bytes: Uint8Array): string`
  - `saveRaw(dataDir: string, source: string, fileName: string, bytes: Uint8Array): Promise<{ path: string; sha256: string; unchanged: boolean }>` — 같은 경로에 같은 해시의 파일이 이미 있으면 덮어쓰지 않고 `unchanged: true`
  - `readRaw(dataDir: string, source: string, fileName: string): Promise<{ bytes: Uint8Array; sha256: string } | undefined>`

- [ ] **Step 1: 패키지 파일 작성**

`package.json`: name `@Betro/transit-static`, `"type": "module"`, exports `"./*": "./src/*.ts"`, scripts `cli: bun run src/cli.ts`, `test: bun test`, `check-types: tsc --noEmit`. dependencies: `@Betro/db: workspace:*`, `drizzle-orm: catalog:`, `@libsql/client: 0.18.0`, `read-excel-file: ^9.3.14`, `@turf/helpers ^7.4.0`, `@turf/nearest-point-on-line ^7.4.0`, `@turf/length ^7.4.0`, `@turf/distance ^7.4.0`, `zod: catalog:`. devDependencies: `@Betro/config: workspace:*`, `@types/bun: catalog:`, `typescript: ^6.0.3`. `tsconfig.json`은 `packages/api/tsconfig.json`을 그대로 따른다. `src/cli.ts`는 일단 `console.error("no command")`로 종료하는 빈 파일.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// lines.test.ts
import { describe, expect, it } from "bun:test";
import { LINES, lineKeyBySubwayId } from "./lines";

describe("LINES", () => {
  it("has exactly 19 lines with unique keys and subwayIds", () => {
    expect(LINES.length).toBe(19);
    expect(new Set(LINES.map((l) => l.lineKey)).size).toBe(19);
    expect(new Set(LINES.map((l) => l.subwayId)).size).toBe(19);
  });
  it("maps realtime subwayIds", () => {
    expect(lineKeyBySubwayId("1002")).toBe("line2");
    expect(lineKeyBySubwayId("1032")).toBe("gtx-a");
    expect(lineKeyBySubwayId("1094")).toBe("sillim");
    expect(lineKeyBySubwayId("1081")).toBe("gyeonggang");
    expect(lineKeyBySubwayId("9999")).toBeUndefined();
  });
});
```

```ts
// raw-store.test.ts
import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRaw, resolveDataDir, saveRaw, sha256Hex } from "./raw-store";

describe("raw store", () => {
  it("resolveDataDir prefers BETRO_DATA_DIR", () => {
    expect(resolveDataDir({ BETRO_DATA_DIR: "/x" })).toBe("/x");
    expect(resolveDataDir({})).toMatch(/data$/);
  });
  it("saves, hashes, and skips unchanged bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "betro-raw-"));
    const bytes = new TextEncoder().encode("hello");
    const first = await saveRaw(dir, "test-src", "a.txt", bytes);
    expect(first.sha256).toBe(sha256Hex(bytes));
    expect(first.unchanged).toBe(false);
    const second = await saveRaw(dir, "test-src", "a.txt", bytes);
    expect(second.unchanged).toBe(true);
    const read = await readRaw(dir, "test-src", "a.txt");
    expect(read?.sha256).toBe(first.sha256);
    expect(await readRaw(dir, "test-src", "missing.txt")).toBeUndefined();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: `lines.ts`, `paths.ts`, `raw-store.ts` 구현**

`resolveDataDir`는 `paths.ts`에 두고 `raw-store.ts`에서 재export한다. 기본 데이터 디렉터리는 `import.meta.dir`에서 `../../..`로 올라간 저장소 루트의 `data`. 해시는 `new Bun.CryptoHasher("sha256")`.

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd packages/transit-static && bun test`
Expected: PASS (2 files)

- [ ] **Step 6: 루트 설정과 설치**

루트 `package.json` scripts 추가, `.gitignore`에 `data/` 추가, `bun install` 실행. `bunx ultracite fix` 실행.

- [ ] **Step 7: 커밋**

```bash
git add packages/transit-static package.json bun.lock .gitignore
git commit -m "feat(transit-static): scaffold package with line constants and raw store"
```

---

### Task 2: 참조 DB 스키마

**Files:**
- Create: `packages/db/src/schema/transit.ts`
- Modify: `packages/db/src/schema/index.ts` (`export * from "./transit";` 추가)
- Create: `packages/db/src/migrations/*` (drizzle-kit generate 결과)
- Create: `packages/db/src/test-db.ts` — 테스트용 인메모리 DB 헬퍼
- Test: `packages/db/src/schema/transit.test.ts`

**Interfaces:**
- Produces (Drizzle 테이블, 컬럼은 snake_case, 속성은 camelCase):
  - `referenceBatch` = `reference_batch`: `id` integer pk autoincrement, `kind` text notNull (`"station_crosswalk" | "track"`), `createdAt` integer timestamp_ms notNull default now, `sourceManifest` text json notNull (`Record<string, { fileName: string; sha256: string }>`), `isCurrent` integer boolean notNull default false
  - `stationCrosswalk` = `station_crosswalk`: `id` pk, `batchId` fk→reference_batch, `statnId` text notNull, `subwayId` text notNull, `lineKey` text notNull, `stationCd` text, `frCode` text, `bldnId` text, `nameCanonical` text notNull, `nameAliases` text json notNull (`string[]`), `lat` real notNull, `lng` real notNull, `coordSource` text notNull, `matchMethod` text notNull (`"auto-same-line" | "auto-shared" | "manual-alias"`), `qualityFlags` text json notNull (`string[]`). unique index `(batch_id, statn_id)`.
  - `trackShape` = `track_shape`: `id` pk, `batchId` fk, `lineKey` text notNull, `branchKey` text notNull, `direction` text notNull (`"up" | "down"`), `osmRelationId` integer notNull, `coords` text json notNull (`[number, number][]`, `[lng, lat]`), `lengthM` real notNull, `attribution` text notNull. unique index `(batch_id, osm_relation_id)`.
  - `trackStation` = `track_station`: `id` pk, `trackShapeId` fk→track_shape, `statnId` text notNull, `seq` integer notNull, `distanceM` real notNull, `offsetM` real notNull, `osmStopNodeId` integer. unique index `(track_shape_id, statn_id)`.
  - `createTestDb(): Promise<Database>` in `packages/db/src/test-db.ts` — `createDb({ DATABASE_URL: ":memory:" })` 후 `drizzle-orm/libsql/migrator`의 `migrate`로 `src/migrations` 적용

설계 판단: 설계 문서 6.1은 `osm_stop_node_id`를 대응표에 두지만, 그 값은 선로 배치(6.2)에서만 알 수 있고 갈래마다 다를 수 있어 `track_station`에 둔다. 설계 문서 "구현 중 근거가 생기면 바꿀 수 있음"에 해당한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// transit.test.ts
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-db";
import { referenceBatch, stationCrosswalk, trackShape, trackStation } from "./transit";

describe("transit schema", () => {
  it("round-trips a batch with crosswalk, shape, and station rows", async () => {
    const db = await createTestDb();
    const [batch] = await db.insert(referenceBatch).values({ kind: "track", sourceManifest: { osm: { fileName: "osm.json", sha256: "ab" } } }).returning();
    if (!batch) throw new Error("no batch");
    await db.insert(stationCrosswalk).values({ batchId: batch.id, statnId: "1002000211", subwayId: "1002", lineKey: "line2", nameCanonical: "성수", nameAliases: ["성수"], lat: 37.5445, lng: 127.0559, coordSource: "station-master", matchMethod: "auto-same-line", qualityFlags: [] });
    const [shape] = await db.insert(trackShape).values({ batchId: batch.id, lineKey: "line2", branchKey: "main", direction: "up", osmRelationId: 1, coords: [[127.0, 37.5], [127.01, 37.5]], lengthM: 884, attribution: "© OpenStreetMap contributors (ODbL)" }).returning();
    if (!shape) throw new Error("no shape");
    await db.insert(trackStation).values({ trackShapeId: shape.id, statnId: "1002000211", seq: 0, distanceM: 0, offsetM: 12.3 });
    const found = await db.select().from(trackStation).where(eq(trackStation.trackShapeId, shape.id));
    expect(found.length).toBe(1);
    expect(found[0]?.statnId).toBe("1002000211");
    const shapes = await db.select().from(trackShape);
    expect(shapes[0]?.coords).toEqual([[127.0, 37.5], [127.01, 37.5]]);
  });
  it("rejects duplicate statn_id within one batch", async () => {
    const db = await createTestDb();
    const [batch] = await db.insert(referenceBatch).values({ kind: "station_crosswalk", sourceManifest: {} }).returning();
    if (!batch) throw new Error("no batch");
    const row = { batchId: batch.id, statnId: "1001000133", subwayId: "1001", lineKey: "line1", nameCanonical: "서울", nameAliases: [], lat: 37.55, lng: 126.97, coordSource: "station-master", matchMethod: "auto-same-line", qualityFlags: [] } as const;
    await db.insert(stationCrosswalk).values(row);
    await expect(db.insert(stationCrosswalk).values(row)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/db && bun test`
Expected: FAIL (transit 모듈 없음)

- [ ] **Step 3: `transit.ts`, `test-db.ts` 구현, 마이그레이션 생성**

`transit.ts`는 `auth.ts`와 같은 스타일(`sqliteTable`, `integer(..., { mode: "timestamp_ms" })`, `text(..., { mode: "json" }).$type<...>()`). json 컬럼은 `$type`으로 위 Interfaces의 타입을 지정한다. 마이그레이션: 저장소 루트에서 `bun run db:generate` (DATABASE_URL이 필요하면 `apps/server/.env` 값이 쓰인다). `test-db.ts`의 migrator 폴더 경로는 `new URL("./migrations", import.meta.url).pathname` 기준으로 계산한다(Windows에서 선행 `/` 처리에 `fileURLToPath` 사용).

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/db && bun test`
Expected: PASS (2 tests)

- [ ] **Step 5: 로컬 DB 반영 확인**

Run: 저장소 루트에서 `bun run db:migrate`
Expected: 오류 없이 종료. `local.db`에 4개 테이블 생성.

- [ ] **Step 6: 커밋**

```bash
git add packages/db
git commit -m "feat(db): add reference batch, station crosswalk, and track tables"
```

---

### Task 3: 실시간도착_역정보 xlsx 다운로드와 파싱

**Files:**
- Create: `packages/transit-static/src/sources/station-xlsx.ts`
- Create: `packages/transit-static/src/jobs/fetch-station-xlsx.ts`
- Modify: `packages/transit-static/src/cli.ts` (`fetch:station-xlsx [--seq N]` 명령)
- Test: `packages/transit-static/src/sources/station-xlsx.test.ts`

**Interfaces:**
- Produces:
  - `type RealtimeStationRow = { statnId: string; subwayId: string; lineKey: LineKey; nameRaw: string; lineNameRaw: string }`
  - `stationXlsxUrl(seq: number): string` — `https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-12764&seqNo=&seq=${seq}&infSeq=2`
  - `parseStationRows(rows: unknown[][]): { rows: RealtimeStationRow[]; errors: string[] }` — 첫 행은 헤더(`SUBWAY_ID`, `STATN_ID`, `STATN_NM`, `호선이름`), 헤더 위치로 컬럼을 찾는다(순서 가정 금지). 알 수 없는 `SUBWAY_ID`는 `errors`에 `unknown subwayId 1999 at row 5` 형태로 남기고 행은 제외한다.
  - `readStationXlsx(path: string): Promise<unknown[][]>` — `read-excel-file/node` 호출. 첫 시트.
  - job `fetchStationXlsx({ dataDir, seq, fetchImpl = fetch })` → `saveRaw(dataDir, "oa-12764-station-xlsx", \`stations-seq${seq}.xlsx\`, bytes)` 결과를 반환하고 콘솔에 경로·해시·unchanged를 출력

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "bun:test";
import { parseStationRows, stationXlsxUrl } from "./station-xlsx";

describe("parseStationRows", () => {
  const header = ["SUBWAY_ID", "STATN_ID", "STATN_NM", "호선이름"];
  it("keeps ids as 10-digit strings even when cells are numbers", () => {
    const { rows, errors } = parseStationRows([header, [1001, 1001000133, "서울", "1호선"]]);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ statnId: "1001000133", subwayId: "1001", lineKey: "line1", nameRaw: "서울", lineNameRaw: "1호선" });
  });
  it("finds columns by header name regardless of order", () => {
    const { rows } = parseStationRows([["STATN_NM", "호선이름", "STATN_ID", "SUBWAY_ID"], ["신림", "신림선", "1094000001", "1094"]]);
    expect(rows[0]?.lineKey).toBe("sillim");
  });
  it("reports unknown subwayId and drops the row", () => {
    const { rows, errors } = parseStationRows([header, ["1999", "1999000001", "어딘가", "없는선"]]);
    expect(rows).toEqual([]);
    expect(errors[0]).toContain("1999");
  });
  it("trims whitespace in names", () => {
    const { rows } = parseStationRows([header, ["1002", "1002000211", " 성수 ", "2호선"]]);
    expect(rows[0]?.nameRaw).toBe("성수");
  });
});

describe("stationXlsxUrl", () => {
  it("embeds seq", () => {
    expect(stationXlsxUrl(57)).toContain("seq=57");
    expect(stationXlsxUrl(57)).toContain("infId=OA-12764");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/sources/station-xlsx.test.ts`
Expected: FAIL

- [ ] **Step 3: `station-xlsx.ts`, job, CLI 명령 구현**

`cli.ts`는 `process.argv[2]`를 명령 이름으로, 나머지는 `Bun.argv` 기반 `util.parseArgs`로 파싱한다. 명령 이름과 핸들러의 맵을 두고, 모르는 명령이면 목록을 출력하고 exit 1. `--seq` 기본값 57.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/transit-static && bun test src/sources/station-xlsx.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 실제 다운로드로 확인 (키 불필요)**

Run: 저장소 루트에서 `bun transit fetch:station-xlsx`
Expected: `data/raw/oa-12764-station-xlsx/stations-seq57.xlsx` 생성, 콘솔에 sha256 출력. 두 번째 실행은 `unchanged: true`.

Run: `bun -e 'const {readStationXlsx, parseStationRows} = await import("./packages/transit-static/src/sources/station-xlsx.ts"); const r = parseStationRows(await readStationXlsx("data/raw/oa-12764-station-xlsx/stations-seq57.xlsx")); console.log(r.rows.length, r.errors, new Set(r.rows.map(x=>x.lineKey)).size)'`
Expected: `696 [] 19`. 다르면 xlsx 판이 바뀐 것이므로 숫자를 README에 기록하고 진행한다.

- [ ] **Step 6: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): download and parse realtime station xlsx"
```

---

### Task 4: 서울 열린데이터광장 API 클라이언트(역사마스터, 역 검색)

**Files:**
- Create: `packages/transit-static/src/sources/seoul-open-api.ts`
- Create: `packages/transit-static/src/jobs/fetch-station-master.ts`, `packages/transit-static/src/jobs/fetch-station-search.ts`
- Modify: `packages/transit-static/src/cli.ts` (`fetch:station-master`, `fetch:station-search`)
- Test: `packages/transit-static/src/sources/seoul-open-api.test.ts`

**Interfaces:**
- Produces:
  - `type StationMasterRow = { bldnId: string; bldnNm: string; route: string; lat: number; lng: number }` (응답 필드 `BLDN_ID, BLDN_NM, ROUTE, LAT, LOT`)
  - `type StationSearchRow = { stationCd: string; stationNm: string; lineNum: string; frCode: string }` (응답 필드 `STATION_CD, STATION_NM, LINE_NUM, FR_CODE`)
  - `type SeoulApiResult<T> = { ok: true; rows: T[]; totalCount: number } | { ok: false; code: string; message: string }`
  - `parseSeoulEnvelope(serviceName: string, json: unknown): SeoulApiResult<Record<string, unknown>>` — 성공 구조 `{ [serviceName]: { list_total_count, RESULT: { CODE, MESSAGE }, row: [...] } }`, 실패 구조 `{ RESULT: { CODE, MESSAGE } }`. `INFO-000`만 ok. `INFO-200`(데이터 없음)은 `ok: true, rows: []`.
  - `seoulApiUrl(key: string, service: string, start: number, end: number, extraPath?: string): string` — `http://openapi.seoul.go.kr:8088/${key}/json/${service}/${start}/${end}/${extraPath ?? ""}`; extraPath는 `encodeURIComponent`
  - `fetchStationMaster(key: string, fetchImpl = fetch): Promise<SeoulApiResult<StationMasterRow>>` — `subwayStationMaster/1/1000/` 한 번. `list_total_count > 1000`이면 1001부터 다음 페이지를 이어서 요청.
  - `fetchStationSearch(key: string, name: string, fetchImpl = fetch): Promise<SeoulApiResult<StationSearchRow>>` — `SearchInfoBySubwayNameService/1/100/${name}`
  - job `fetchStationMaster` → 원본 JSON(페이지를 합친 `{ rows }`)을 `saveRaw(dataDir, "oa-21232-station-master", "station-master.json", ...)`
  - job `fetchStationSearch` → 최신 xlsx(Task 3)의 `nameRaw` 중복 제거 목록을 돌며 `data/raw/oa-121-station-search/<name>.json`에 저장. 이미 파일이 있으면 요청하지 않는다(재개 가능). 요청 사이 200ms 대기. 결과 없음(`INFO-200`)도 빈 rows로 저장해 재요청을 막는다.
  - 키는 `process.env.SEOUL_OPEN_API_KEY`. 없으면 `SEOUL_OPEN_API_KEY가 없습니다. 서울 열린데이터광장에서 일반 인증키를 발급받아 설정하세요.` 메시지로 exit 1.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "bun:test";
import { fetchStationMaster, parseSeoulEnvelope, seoulApiUrl } from "./seoul-open-api";

const ok = (rows: unknown[], total = rows.length) => ({ subwayStationMaster: { list_total_count: total, RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" }, row: rows } });
const asResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("parseSeoulEnvelope", () => {
  it("returns rows on INFO-000", () => {
    const r = parseSeoulEnvelope("subwayStationMaster", ok([{ BLDN_ID: "0150" }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0]?.BLDN_ID).toBe("0150");
  });
  it("treats INFO-200 as empty success", () => {
    const r = parseSeoulEnvelope("x", { RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });
    expect(r).toEqual({ ok: true, rows: [], totalCount: 0 });
  });
  it("returns error code on ERROR-*", () => {
    const r = parseSeoulEnvelope("x", { RESULT: { CODE: "ERROR-300", MESSAGE: "필수 값이 누락" } });
    expect(r).toEqual({ ok: false, code: "ERROR-300", message: "필수 값이 누락" });
  });
});

describe("seoulApiUrl", () => {
  it("percent-encodes the trailing path", () => {
    expect(seoulApiUrl("K", "SearchInfoBySubwayNameService", 1, 5, "대곡")).toBe("http://openapi.seoul.go.kr:8088/K/json/SearchInfoBySubwayNameService/1/5/%EB%8C%80%EA%B3%A1");
  });
});

describe("fetchStationMaster", () => {
  it("coerces LAT/LOT to numbers and pages past 1000", async () => {
    const calls: string[] = [];
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ BLDN_ID: String(i), BLDN_NM: "역", ROUTE: "1호선", LAT: "37.5", LOT: "127.0" }));
    const page2 = [{ BLDN_ID: "1000", BLDN_NM: "역", ROUTE: "1호선", LAT: "37.6", LOT: "127.1" }];
    const fetchImpl = async (url: string | URL | Request) => {
      calls.push(String(url));
      return asResponse(calls.length === 1 ? ok(page1, 1001) : ok(page2, 1001));
    };
    const r = await fetchStationMaster("K", fetchImpl as typeof fetch);
    expect(calls[0]).toContain("/subwayStationMaster/1/1000/");
    expect(calls[1]).toContain("/subwayStationMaster/1001/2000/");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.length).toBe(1001);
      expect(r.rows[1000]).toEqual({ bldnId: "1000", bldnNm: "역", route: "1호선", lat: 37.6, lng: 127.1 });
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/sources/seoul-open-api.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/transit-static && bun test src/sources/seoul-open-api.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 키 없이 CLI 오류 메시지 확인**

Run: `bun transit fetch:station-master`
Expected: exit 1, 위 안내 메시지. (키가 있으면 이 단계 뒤에 실제 호출로 784행 저장을 확인하고 README에 행 수를 적는다. 키는 Task 7 전까지만 있으면 된다.)

- [ ] **Step 6: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): add Seoul open API client for station master and search"
```

---

### Task 5: 역명 정규화, 출처 노선명 매핑, 3단계 매칭

**Files:**
- Create: `packages/transit-static/src/crosswalk/normalize-name.ts`, `packages/transit-static/src/crosswalk/source-line-names.ts`, `packages/transit-static/src/crosswalk/match.ts`
- Create: `packages/transit-static/src/manual/station-aliases.json`, `packages/transit-static/src/manual/source-line-names.json`
- Test: `packages/transit-static/src/crosswalk/normalize-name.test.ts`, `packages/transit-static/src/crosswalk/match.test.ts`

**Interfaces:**
- Consumes: `RealtimeStationRow`(Task 3), `StationMasterRow`(Task 4), `LineKey`(Task 1)
- Produces:
  - `normalizeStationName(name: string): string` — 트림, 내부 공백 제거, 끝의 `역` 한 글자 제거(`서울역`→`서울`; 단 두 글자 이하 이름은 그대로), 괄호와 괄호 안 내용 제거(`응암순환(상선)`→`응암순환`), 가운뎃점·하이픈 통일(`·`, `ㆍ`, `-`, `−` → `·`)
  - `source-line-names.json`: `{ "stationMasterRoute": { "<ROUTE 문자열>": "<lineKey>" }, "stationSearchLineNum": { "<LINE_NUM 문자열>": "<lineKey>" } }`. 초기 내용은 Task 7에서 실제 원본을 보고 채운다. 이 Task에서는 빈 객체 둘로 시작한다.
  - `mapSourceLineName(kind: "stationMasterRoute" | "stationSearchLineNum", raw: string, table = manualTable): LineKey | undefined`
  - `station-aliases.json`: `[{ "statnId": "1001080176", "masterName": "원곡", "note": "실시간 xlsx는 시우, 마스터는 원곡" }, ...]`. 초기값은 조사에서 확인된 5건: 시우/원곡, 한국항공대/화전, 운정중앙/운정, 세종왕릉/세종대왕릉, 응암순환/응암 (statnId는 Task 7에서 실제 xlsx로 확인해 채운다; 이 Task에서는 테스트 픽스처만 쓴다).
  - ```ts
    type MatchInput = { stations: RealtimeStationRow[]; master: StationMasterRow[]; aliases: { statnId: string; masterName: string }[]; lineNames: typeof manualTable }
    type CrosswalkRow = { statnId: string; subwayId: string; lineKey: LineKey; nameCanonical: string; nameAliases: string[]; lat: number; lng: number; coordSource: "station-master"; bldnId: string; matchMethod: "auto-same-line" | "auto-shared" | "manual-alias"; qualityFlags: string[]; stationCd?: string; frCode?: string }
    type MatchResult = { rows: CrosswalkRow[]; unmatched: RealtimeStationRow[]; unmappedRoutes: { route: string; count: number }[] }
    matchStations(input: MatchInput): MatchResult
    ```
  - 매칭 순서(역마다): (1) 같은 `lineKey`의 마스터 레코드 중 정규화 역명이 같은 것 → `auto-same-line`. (2) 노선 무관하게 정규화 역명이 같은 마스터 레코드 → `auto-shared`(여럿이면 첫 번째, `shared-multiple` 플래그). (3) 별칭 표의 `masterName`으로 (1),(2)를 다시 → `manual-alias`. 전부 실패 → `unmatched`.
  - (1)에서 후보가 둘 이상이면 첫 후보를 쓰고 `duplicate-master` 플래그.
  - `nameCanonical`은 xlsx의 `nameRaw`를 정규화한 값. `nameAliases`는 xlsx 원문, 마스터 `bldnNm`, 별칭 표 이름의 중복 제거 목록.
  - 마스터 레코드의 `route`가 `lineNames.stationMasterRoute`에 없으면 그 레코드는 (1)에 참여하지 못하며, 문자열별 건수를 `unmappedRoutes`에 집계한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// normalize-name.test.ts
import { describe, expect, it } from "bun:test";
import { normalizeStationName } from "./normalize-name";

describe("normalizeStationName", () => {
  it.each([
    ["서울역", "서울"],
    ["서울", "서울"],
    [" 성수 ", "성수"],
    ["응암순환(상선)", "응암순환"],
    ["대모산입구", "대모산입구"],
    ["총신대입구(이수)", "총신대입구"],
    ["동대문역사문화공원", "동대문역사문화공원"],
    ["여의나루역", "여의나루"],
    ["신촌(경의중앙선)", "신촌"],
    ["월드컵경기장(성산)", "월드컵경기장"],
    ["잠실새내", "잠실새내"],
    ["역곡", "역곡"],
    ["이대", "이대"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeStationName(input)).toBe(expected);
  });
});
```

```ts
// match.test.ts
import { describe, expect, it } from "bun:test";
import { matchStations } from "./match";

const lineNames = { stationMasterRoute: { "1호선": "line1", "2호선": "line2", "4호선": "line4", "경의중앙선": "gyeongui-jungang" }, stationSearchLineNum: {} } as const;
const st = (statnId: string, subwayId: string, lineKey: string, nameRaw: string) => ({ statnId, subwayId, lineKey, nameRaw, lineNameRaw: "" }) as never;
const m = (bldnId: string, bldnNm: string, route: string, lat = 37.5, lng = 127.0) => ({ bldnId, bldnNm, route, lat, lng });

describe("matchStations", () => {
  it("matches same line by normalized name", () => {
    const r = matchStations({ stations: [st("1001000133", "1001", "line1", "서울역")], master: [m("0150", "서울", "1호선", 37.556, 126.972), m("0426", "서울", "4호선", 37.553, 126.970)], aliases: [], lineNames });
    expect(r.unmatched).toEqual([]);
    expect(r.rows[0]).toMatchObject({ statnId: "1001000133", bldnId: "0150", lat: 37.556, matchMethod: "auto-same-line", nameCanonical: "서울", coordSource: "station-master" });
    expect(r.rows[0]?.nameAliases).toEqual(["서울역", "서울"]);
  });
  it("falls back to a shared-station record on another route", () => {
    const r = matchStations({ stations: [st("1063000001", "1063", "gyeongui-jungang", "효창공원앞")], master: [m("2628", "효창공원앞", "6호선")], aliases: [], lineNames });
    expect(r.rows[0]?.matchMethod).toBe("auto-shared");
    expect(r.unmappedRoutes).toEqual([{ route: "6호선", count: 1 }]);
  });
  it("uses the manual alias table last", () => {
    const r = matchStations({ stations: [st("1001080176", "1001", "line1", "시우")], master: [m("1826", "원곡", "1호선")], aliases: [{ statnId: "1001080176", masterName: "원곡" }], lineNames });
    expect(r.rows[0]).toMatchObject({ matchMethod: "manual-alias", bldnId: "1826" });
    expect(r.rows[0]?.nameAliases).toEqual(["시우", "원곡"]);
  });
  it("reports unmatched stations instead of throwing", () => {
    const r = matchStations({ stations: [st("1002000999", "1002", "line2", "없는역")], master: [], aliases: [], lineNames });
    expect(r.rows).toEqual([]);
    expect(r.unmatched.map((s) => s.statnId)).toEqual(["1002000999"]);
  });
  it("flags duplicate master records on the same line and keeps the first", () => {
    const r = matchStations({ stations: [st("1007000754", "1007", "line7", "까치울")], master: [m("2754", "까치울", "7호선", 37.506, 126.811), m("3754", "까치울", "7호선", 37.506, 126.811)], aliases: [], lineNames: { ...lineNames, stationMasterRoute: { ...lineNames.stationMasterRoute, "7호선": "line7" } } });
    expect(r.rows[0]?.bldnId).toBe("2754");
    expect(r.rows[0]?.qualityFlags).toContain("duplicate-master");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/crosswalk`
Expected: FAIL

- [ ] **Step 3: 구현**

마스터를 `Map<normalizedName, StationMasterRow[]>`와 `Map<lineKey, Map<normalizedName, StationMasterRow[]>>`로 한 번 인덱싱한 뒤 역을 순회한다. JSON 매뉴얼 파일은 `import ... with { type: "json" }`으로 읽는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/transit-static && bun test src/crosswalk`
Expected: PASS (18 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): station name normalization and three-tier crosswalk matching"
```

---

### Task 6: OA-121 코드 붙이기와 xlsx 판 차이 보고

**Files:**
- Create: `packages/transit-static/src/crosswalk/attach-codes.ts`, `packages/transit-static/src/crosswalk/diff.ts`
- Test: `packages/transit-static/src/crosswalk/attach-codes.test.ts`, `packages/transit-static/src/crosswalk/diff.test.ts`

**Interfaces:**
- Consumes: `CrosswalkRow`(Task 5), `StationSearchRow`(Task 4), `mapSourceLineName`(Task 5), `RealtimeStationRow`(Task 3)
- Produces:
  - `attachStationCodes(rows: CrosswalkRow[], searchByName: Map<string, StationSearchRow[]>, lineNames): { rows: CrosswalkRow[]; missingCodes: string[]; unmappedLineNums: { lineNum: string; count: number }[] }` — 키는 xlsx 원문 `nameRaw`(Task 4 job이 파일명으로 쓴 이름). 각 역에 대해 (a) `lineNum`을 `mapSourceLineName("stationSearchLineNum", ...)`으로 바꿔 같은 `lineKey`인 행 → `stationCd`, `frCode`. (b) 없으면 정규화 역명으로 다른 이름 파일에서도 찾지 않고 `missingCodes`에 statnId 추가, `qualityFlags`에 `no-station-cd`. 코드가 없어도 행은 유지한다(시간표 조인은 2단계 문제).
  - `diffStationLists(prev: RealtimeStationRow[], next: RealtimeStationRow[]): { added: RealtimeStationRow[]; removed: RealtimeStationRow[]; renamed: { statnId: string; from: string; to: string }[] }` — statnId 기준.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// attach-codes.test.ts
import { describe, expect, it } from "bun:test";
import { attachStationCodes } from "./attach-codes";

const lineNames = { stationMasterRoute: {}, stationSearchLineNum: { "03호선": "line3", "서해선": "seohae", "GTX-A": "gtx-a" } } as const;
const row = (statnId: string, lineKey: string, nameRaw: string) => ({ statnId, subwayId: "", lineKey, nameCanonical: nameRaw, nameAliases: [nameRaw], lat: 0, lng: 0, coordSource: "station-master", bldnId: "", matchMethod: "auto-same-line", qualityFlags: [] }) as never;

describe("attachStationCodes", () => {
  const search = new Map([["대곡", [
    { stationCd: "103C", stationNm: "대곡", lineNum: "서해선", frCode: "S11" },
    { stationCd: "1953", stationNm: "대곡", lineNum: "03호선", frCode: "314" },
    { stationCd: "9002", stationNm: "대곡", lineNum: "GTX-A", frCode: "X103" },
  ]]]);
  it("picks the row whose LINE_NUM maps to the station's lineKey", () => {
    const r = attachStationCodes([row("1003000314", "line3", "대곡")], search, lineNames);
    expect(r.rows[0]).toMatchObject({ stationCd: "1953", frCode: "314" });
    expect(r.missingCodes).toEqual([]);
  });
  it("keeps the row and flags it when no code matches", () => {
    const r = attachStationCodes([row("1063000001", "gyeongui-jungang", "대곡")], search, lineNames);
    expect(r.rows[0]?.stationCd).toBeUndefined();
    expect(r.rows[0]?.qualityFlags).toContain("no-station-cd");
    expect(r.missingCodes).toEqual(["1063000001"]);
  });
  it("counts LINE_NUM values that are not in the manual table", () => {
    const r = attachStationCodes([row("1001000001", "line1", "수원")], new Map([["수원", [{ stationCd: "1", stationNm: "수원", lineNum: "경부선", frCode: "P155" }]]]), lineNames);
    expect(r.unmappedLineNums).toEqual([{ lineNum: "경부선", count: 1 }]);
  });
});
```

```ts
// diff.test.ts
import { describe, expect, it } from "bun:test";
import { diffStationLists } from "./diff";

const st = (statnId: string, nameRaw: string) => ({ statnId, subwayId: "1001", lineKey: "line1", nameRaw, lineNameRaw: "1호선" }) as never;

describe("diffStationLists", () => {
  it("detects added, removed, and renamed stations by statnId", () => {
    const r = diffStationLists([st("1", "가"), st("2", "나"), st("3", "다")], [st("2", "나"), st("3", "라"), st("4", "마")]);
    expect(r.added.map((s) => s.statnId)).toEqual(["4"]);
    expect(r.removed.map((s) => s.statnId)).toEqual(["1"]);
    expect(r.renamed).toEqual([{ statnId: "3", from: "다", to: "라" }]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/crosswalk`
Expected: FAIL (새 2 파일)

- [ ] **Step 3: 구현**

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/transit-static && bun test src/crosswalk`
Expected: PASS (22 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): attach OA-121 station codes and diff xlsx editions"
```

---

### Task 7: 대응표 빌드 잡, DB 적재, 보고서, 실제 데이터 통과

이 Task부터 `SEOUL_OPEN_API_KEY`가 필요하다(원본 다운로드에만). 테스트는 키 없이 통과한다.

**Files:**
- Create: `packages/transit-static/src/reports.ts`, `packages/transit-static/src/db/load.ts`, `packages/transit-static/src/crosswalk/build.ts`, `packages/transit-static/src/jobs/build-crosswalk.ts`
- Modify: `packages/transit-static/src/cli.ts` (`build:crosswalk [--dry-run]`), `packages/transit-static/src/manual/source-line-names.json`, `packages/transit-static/src/manual/station-aliases.json`, `packages/transit-static/README.md`
- Test: `packages/transit-static/src/crosswalk/build.test.ts`, `packages/transit-static/src/db/load.test.ts`, `packages/transit-static/src/crosswalk/build.integration.test.ts`

**Interfaces:**
- Consumes: Task 3~6의 함수, Task 2의 테이블, `createTestDb`
- Produces:
  - `writeReport(dataDir: string, job: string, body: { summary: Record<string, unknown>; markdown: string }): Promise<{ jsonPath: string; mdPath: string }>` — `data/reports/<job>/<YYYYMMDDTHHmmss>.json|.md`
  - ```ts
    type BuildCrosswalkInput = { stations: RealtimeStationRow[]; prevStations?: RealtimeStationRow[]; master: StationMasterRow[]; searchByName: Map<string, StationSearchRow[]>; aliases; lineNames }
    type BuildCrosswalkResult = { ok: boolean; rows: CrosswalkRow[]; unmatched: RealtimeStationRow[]; unmappedRoutes; unmappedLineNums; missingCodes: string[]; diff?: ReturnType<typeof diffStationLists>; markdown: string }
    buildCrosswalk(input: BuildCrosswalkInput): BuildCrosswalkResult
    ```
    `ok`는 `unmatched.length === 0 && unmappedRoutes.length === 0 && unmappedLineNums.length === 0`. `missingCodes`는 ok에 영향 없음(경고).
  - `loadCrosswalk(db: Database, rows: CrosswalkRow[], manifest: SourceManifest): Promise<{ batchId: number }>` — 한 트랜잭션에서 `reference_batch(kind="station_crosswalk")` 삽입, 행 삽입(500개씩 나눠서), 같은 kind의 다른 배치 `is_current=false`, 새 배치 `is_current=true`
  - `loadTracks(db, shapes: TrackShapeInput[], manifest): Promise<{ batchId: number }>` — Task 11에서 쓰는 같은 패턴. `TrackShapeInput = { lineKey; branchKey; direction; osmRelationId; coords; lengthM; attribution; stations: { statnId; seq; distanceM; offsetM; osmStopNodeId?: number }[] }`. 이 Task에서 구현하고 테스트한다.
  - job `buildCrosswalk({ dataDir, db, dryRun })`: 최신 xlsx(가장 큰 seq 파일)와 직전 xlsx(있으면), `station-master.json`, `oa-121-station-search/*.json`을 읽어 `buildCrosswalk` 실행 → 보고서 작성 → `ok`이고 `!dryRun`이면 `loadCrosswalk`. `ok`가 아니면 exit 1. 원본 파일이 없으면 어떤 fetch 명령을 먼저 돌리라고 안내하고 exit 1.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// build.test.ts
import { describe, expect, it } from "bun:test";
import { buildCrosswalk } from "./build";

describe("buildCrosswalk", () => {
  const base = { master: [{ bldnId: "0150", bldnNm: "서울", route: "1호선", lat: 37.556, lng: 126.972 }], searchByName: new Map([["서울역", [{ stationCd: "0150", stationNm: "서울", lineNum: "01호선", frCode: "133" }]]]), aliases: [], lineNames: { stationMasterRoute: { "1호선": "line1" }, stationSearchLineNum: { "01호선": "line1" } } } as const;
  const seoul = { statnId: "1001000133", subwayId: "1001", lineKey: "line1", nameRaw: "서울역", lineNameRaw: "1호선" } as const;
  it("is ok when everything matches and includes codes", () => {
    const r = buildCrosswalk({ ...base, stations: [seoul] } as never);
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ stationCd: "0150", frCode: "133" });
    expect(r.markdown).toContain("매칭 1 / 1");
  });
  it("is not ok with an unmatched station and lists it in markdown", () => {
    const r = buildCrosswalk({ ...base, stations: [seoul, { ...seoul, statnId: "1001000134", nameRaw: "없는역" }] } as never);
    expect(r.ok).toBe(false);
    expect(r.markdown).toContain("1001000134");
  });
  it("includes the edition diff when prevStations is given", () => {
    const r = buildCrosswalk({ ...base, stations: [seoul], prevStations: [] } as never);
    expect(r.diff?.added.length).toBe(1);
  });
});
```

```ts
// load.test.ts
import { describe, expect, it } from "bun:test";
import { createTestDb } from "@Betro/db/test-db";
import { referenceBatch, stationCrosswalk } from "@Betro/db/schema/transit";
import { eq } from "drizzle-orm";
import { loadCrosswalk, loadTracks } from "./load";

const row = { statnId: "1001000133", subwayId: "1001", lineKey: "line1", nameCanonical: "서울", nameAliases: ["서울역"], lat: 37.556, lng: 126.972, coordSource: "station-master", bldnId: "0150", matchMethod: "auto-same-line", qualityFlags: [] } as const;

describe("loadCrosswalk", () => {
  it("creates a current batch and demotes the previous one", async () => {
    const db = await createTestDb();
    const a = await loadCrosswalk(db, [row], { xlsx: { fileName: "s57.xlsx", sha256: "a" } });
    const b = await loadCrosswalk(db, [row], { xlsx: { fileName: "s58.xlsx", sha256: "b" } });
    const batches = await db.select().from(referenceBatch);
    expect(batches.find((x) => x.id === a.batchId)?.isCurrent).toBe(false);
    expect(batches.find((x) => x.id === b.batchId)?.isCurrent).toBe(true);
    const rows = await db.select().from(stationCrosswalk).where(eq(stationCrosswalk.batchId, b.batchId));
    expect(rows.length).toBe(1);
  });
});

describe("loadTracks", () => {
  it("inserts shapes with their stations", async () => {
    const db = await createTestDb();
    const r = await loadTracks(db, [{ lineKey: "line2", branchKey: "main", direction: "up", osmRelationId: 1, coords: [[127, 37.5], [127.01, 37.5]], lengthM: 884, attribution: "© OpenStreetMap contributors (ODbL)", stations: [{ statnId: "1002000211", seq: 0, distanceM: 0, offsetM: 3 }] }], {});
    expect(r.batchId).toBeGreaterThan(0);
  });
});
```

```ts
// build.integration.test.ts (원본 파일이 있을 때만)
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolveDataDir } from "../paths";
import { loadBuildCrosswalkInput } from "../jobs/build-crosswalk";
import { buildCrosswalk } from "./build";

const dataDir = resolveDataDir(process.env);
const hasRaw = existsSync(`${dataDir}/raw/oa-21232-station-master/station-master.json`) && existsSync(`${dataDir}/raw/oa-12764-station-xlsx`);

describe.skipIf(!hasRaw)("crosswalk against real raw files", () => {
  it("matches every station on all 19 lines", async () => {
    const input = await loadBuildCrosswalkInput(dataDir);
    const r = buildCrosswalk(input);
    expect(r.unmatched).toEqual([]);
    expect(r.unmappedRoutes).toEqual([]);
    expect(r.unmappedLineNums).toEqual([]);
    expect(new Set(r.rows.map((x) => x.lineKey)).size).toBe(19);
    expect(r.rows.length).toBe(input.stations.length);
  });
});
```

`loadBuildCrosswalkInput(dataDir): Promise<BuildCrosswalkInput>`는 job 파일에서 export한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test`
Expected: FAIL (build, load). integration은 skip.

- [ ] **Step 3: `reports.ts`, `build.ts`, `db/load.ts`, job, CLI 구현**

markdown 보고서에는 다음 줄을 포함한다: `매칭 N / M`, 매칭 방법별 건수, 미매칭 목록(statnId, 노선, 역명), 매핑 안 된 노선 문자열과 건수, 코드 없는 역 수, 판 차이(추가/삭제/개명). 원본 해시 manifest도 적는다.

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `cd packages/transit-static && bun test`
Expected: PASS, integration 1 skipped

- [ ] **Step 5: 키 발급 후 원본 다운로드 (사용자 작업 포함)**

사용자: 서울 열린데이터광장 마이페이지에서 일반 인증키 발급 → `SEOUL_OPEN_API_KEY` 환경 변수 설정.

Run:
```bash
bun transit fetch:station-master
bun transit fetch:station-search
```
Expected: `station-master.json`(약 784행), `oa-121-station-search/` 아래 이름별 JSON(약 600개). 두 번째 명령은 하루 1,000건 한도 안에서 끝난다. 중단되면 다시 실행하면 이어서 받는다.

- [ ] **Step 6: 매뉴얼 표 채우기**

Run: `bun transit build:crosswalk --dry-run`
Expected: 첫 실행은 `unmappedRoutes`, `unmappedLineNums`로 실패하고 보고서에 문자열 목록이 나온다. 그 목록을 보고 `source-line-names.json`을 채운다(19개 lineKey 각각에 마스터 ROUTE 문자열과 OA-121 LINE_NUM 문자열이 적어도 하나씩). 2호선 지선, 경부선·경인선·경원선 같은 1호선 구간명이 따로 올 수 있으니 전부 `line1`로 보낸다. 범위 밖 노선(인천1호선, 김포골드라인 등)은 매핑하지 않고 보고서에 "범위 밖"으로 남기기 위해 `source-line-names.json`에 `"ignoredRoutes": [...]` 배열을 추가하고, `matchStations`/`attachStationCodes`의 unmapped 집계에서 제외한다(Task 5, 6 함수에 선택 인자 추가, 테스트 1개씩 추가: ignored 문자열은 unmapped에 나오지 않는다).

다시 실행해 `unmatched` 목록이 나오면 `station-aliases.json`에 statnId와 마스터 이름을 추가한다. 예상 5건 내외.

Expected (최종): `bun transit build:crosswalk --dry-run`이 `ok: true`, 매칭 696 / 696(판이 바뀌었으면 그 수), 19개 노선.

- [ ] **Step 7: 통합 테스트와 적재**

Run: `cd packages/transit-static && bun test`
Expected: PASS, integration 포함

Run: 저장소 루트에서 `bun transit build:crosswalk`
Expected: `reference_batch`에 `station_crosswalk` 배치 1개(`is_current=1`), `station_crosswalk` 696행. 확인: `bun -e 'const {createClient}=await import("@libsql/client"); const c=createClient({url:"file:./local.db"}); console.log((await c.execute("select match_method, count(*) n from station_crosswalk group by 1")).rows)'`

- [ ] **Step 8: README 갱신과 커밋**

README에 키 발급 절차, 명령 순서, 보고서 위치, 매뉴얼 표 수정 규칙(리뷰 필요)을 적는다.

```bash
git add packages/transit-static
git commit -m "feat(transit-static): build and load station crosswalk from real sources"
```

---

### Task 8: Overpass 질의, OSM 모델, 노선 relation 탐색

**Files:**
- Create: `packages/transit-static/src/sources/overpass.ts`, `packages/transit-static/src/track/osm-model.ts`
- Create: `packages/transit-static/src/jobs/osm-discover.ts`, `packages/transit-static/src/jobs/fetch-osm.ts`
- Create: `packages/transit-static/src/manual/osm-routes.json`
- Modify: `packages/transit-static/src/cli.ts` (`osm:discover`, `fetch:osm`)
- Test: `packages/transit-static/src/sources/overpass.test.ts`, `packages/transit-static/src/track/osm-model.test.ts`

**Interfaces:**
- Produces:
  - `const OVERPASS_URL = "https://overpass-api.de/api/interpreter"`; `const SEOUL_METRO_BBOX = { south: 36.7, west: 126.3, north: 38.0, east: 127.9 } as const` (1호선 신창 36.77N, 경춘선 춘천 127.73E, 경강선 여주 127.63E 포함)
  - `discoverQuery(bbox): string` — `[out:json][timeout:120]; relation["type"="route"]["route"~"^(subway|train|light_rail)$"](south,west,north,east); out tags;` 와 같은 bbox의 `route_master` relation도 포함(`out body`로 멤버 포함)
  - `routeQuery(relationIds: number[]): string` — `[out:json][timeout:180]; relation(id:1,2,3); (._;>;); out body;`
  - `fetchOverpass(query: string, fetchImpl = fetch): Promise<unknown>` — POST, body `data=<query>` (`application/x-www-form-urlencoded`), 200이 아니면 상태와 본문 앞 200자를 담은 Error
  - `osm-model.ts`:
    ```ts
    type OsmNode = { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> }
    type OsmWay = { type: "way"; id: number; nodes: number[]; tags?: Record<string, string> }
    type OsmRelation = { type: "relation"; id: number; members: { type: "node" | "way" | "relation"; ref: number; role: string }[]; tags?: Record<string, string> }
    type OsmIndex = { nodes: Map<number, OsmNode>; ways: Map<number, OsmWay>; relations: Map<number, OsmRelation> }
    indexOsm(json: unknown): OsmIndex  // { elements: [...] } 형태 검증(zod), 아니면 throw
    stopNodesOf(rel: OsmRelation, idx: OsmIndex): OsmNode[]  // role이 stop, stop_entry_only, stop_exit_only인 node 멤버, 멤버 순서 유지
    wayMembersOf(rel: OsmRelation, idx: OsmIndex): OsmWay[]  // role이 "" 또는 "forward"/"backward"인 way 멤버, 순서 유지; 없는 way는 건너뛰고 경고 대신 throw하지 않음
    ```
  - `osm-routes.json`: `[{ "lineKey": "line2", "branchKey": "main", "direction": "up", "osmRelationId": 2339409, "note": "내선순환" }, ...]`. `branchKey`는 `main`이 본선이고 갈래는 짧은 영문(`seongsu`, `sinjeong`, `macheon`, `hanam`, `gwangmyeong`, `incheon`, `sinchang`, `yongmun`, `imjingang` 등 구현자가 정함). `direction`은 실시간 API `updnLine`과 맞춘다: `up` = 상행·내선(0), `down` = 하행·외선(1). 이 Task에서는 빈 배열로 시작한다.
  - job `osmDiscover({ dataDir })`: discover 질의 결과를 `saveRaw(dataDir, "osm", "discover.json")`에 저장하고, `data/reports/osm-discover/<시각>.md`에 표를 쓴다: relation id, route, ref, name, from, to, network, operator, way 멤버 수, stop 멤버 수, 소속 route_master name. `name` 기준 정렬.
  - job `fetchOsm({ dataDir })`: `osm-routes.json`의 relation id로 `routeQuery` 호출 → `saveRaw(dataDir, "osm", "routes.json")`. 비어 있으면 안내 후 exit 1.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// overpass.test.ts
import { describe, expect, it } from "bun:test";
import { SEOUL_METRO_BBOX, discoverQuery, fetchOverpass, routeQuery } from "./overpass";

describe("queries", () => {
  it("routeQuery lists ids and recurses down", () => {
    const q = routeQuery([1, 22, 333]);
    expect(q).toContain("relation(id:1,22,333)");
    expect(q).toContain("(._;>;)");
    expect(q).toContain("[out:json]");
  });
  it("discoverQuery filters route types inside the bbox", () => {
    const q = discoverQuery(SEOUL_METRO_BBOX);
    expect(q).toContain("subway|train|light_rail");
    expect(q).toContain("36.7,126.3,38,127.9");
  });
});

describe("fetchOverpass", () => {
  it("posts form-encoded data and throws on non-200", async () => {
    let seen: { method?: string; body?: string } = {};
    const okFetch = (async (_url: unknown, init?: RequestInit) => {
      seen = { method: init?.method, body: String(init?.body) };
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    }) as typeof fetch;
    expect(await fetchOverpass("[out:json];", okFetch)).toEqual({ elements: [] });
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe("data=%5Bout%3Ajson%5D%3B");
    const badFetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    await expect(fetchOverpass("x", badFetch)).rejects.toThrow(/429/);
  });
});
```

```ts
// osm-model.test.ts
import { describe, expect, it } from "bun:test";
import { indexOsm, stopNodesOf, wayMembersOf } from "./osm-model";

const json = { elements: [
  { type: "node", id: 1, lat: 37.5, lon: 127.0, tags: { name: "가", railway: "stop" } },
  { type: "node", id: 2, lat: 37.5, lon: 127.01 },
  { type: "node", id: 3, lat: 37.5, lon: 127.02, tags: { name: "나" } },
  { type: "way", id: 10, nodes: [1, 2] },
  { type: "way", id: 11, nodes: [2, 3] },
  { type: "relation", id: 100, members: [
    { type: "node", ref: 1, role: "stop" }, { type: "node", ref: 3, role: "stop_exit_only" },
    { type: "way", ref: 10, role: "" }, { type: "way", ref: 11, role: "" }, { type: "way", ref: 99, role: "" },
    { type: "node", ref: 2, role: "platform" },
  ], tags: { type: "route", route: "subway" } },
] };

describe("indexOsm", () => {
  it("indexes by type and id", () => {
    const idx = indexOsm(json);
    expect(idx.nodes.size).toBe(3);
    expect(idx.ways.get(11)?.nodes).toEqual([2, 3]);
    expect(idx.relations.has(100)).toBe(true);
  });
  it("throws on a malformed payload", () => {
    expect(() => indexOsm({ nope: true })).toThrow();
  });
  it("stopNodesOf keeps member order and only stop roles", () => {
    const idx = indexOsm(json);
    const rel = idx.relations.get(100);
    if (!rel) throw new Error("rel");
    expect(stopNodesOf(rel, idx).map((n) => n.id)).toEqual([1, 3]);
  });
  it("wayMembersOf skips ways missing from the payload", () => {
    const idx = indexOsm(json);
    const rel = idx.relations.get(100);
    if (!rel) throw new Error("rel");
    expect(wayMembersOf(rel, idx).map((w) => w.id)).toEqual([10, 11]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/sources/overpass.test.ts src/track/osm-model.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 테스트 통과 확인**

Run: 위 명령
Expected: PASS (7 tests)

- [ ] **Step 5: 실제 탐색 실행 (키 불필요)**

Run: `bun transit osm:discover`
Expected: `data/reports/osm-discover/<시각>.md`에 200개 이상의 relation 표. 429가 나오면 1분 뒤 재시도.

- [ ] **Step 6: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): Overpass client, OSM index, and route discovery report"
```

---

### Task 9: way 이어 붙이기

**Files:**
- Create: `packages/transit-static/src/track/stitch.ts`
- Test: `packages/transit-static/src/track/stitch.test.ts`

**Interfaces:**
- Consumes: `OsmWay`, `OsmIndex`(Task 8)
- Produces:
  - `type LngLat = [number, number]`
  - `stitchWays(ways: OsmWay[], idx: OsmIndex): { ok: true; coords: LngLat[] } | { ok: false; reason: "gap" | "empty" | "missing-node"; atWayId?: number; gapM?: number }`
  - 규칙: 첫 way의 방향은 두 번째 way와 공유하는 끝점으로 정한다(way가 하나면 그대로). 이후 way마다 현재 선의 끝점과 같은 노드 id로 시작하면 그대로, 끝나면 뒤집어서 잇는다. 둘 다 아니면 끝점 좌표 거리를 재서 `GAP_TOLERANCE_M = 1` 이내면 잇고(노드 id가 달라도 같은 위치), 넘으면 `{ ok: false, reason: "gap", atWayId, gapM }`. 이어 붙일 때 공유 노드는 한 번만 넣는다. 노드가 index에 없으면 `missing-node`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "bun:test";
import { indexOsm } from "./osm-model";
import { stitchWays } from "./stitch";

const node = (id: number, lon: number, lat = 37.5) => ({ type: "node", id, lat, lon });
const way = (id: number, nodes: number[]) => ({ type: "way", id, nodes });
const idx = indexOsm({ elements: [node(1, 127.00), node(2, 127.01), node(3, 127.02), node(4, 127.03), node(9, 127.50), way(10, [1, 2]), way(11, [2, 3]), way(12, [4, 3]), way(13, [9, 4]), way(20, [2, 1])] });
const w = (id: number) => { const x = idx.ways.get(id); if (!x) throw new Error(String(id)); return x; };

describe("stitchWays", () => {
  it("joins ways end to start without duplicating the shared node", () => {
    const r = stitchWays([w(10), w(11)], idx);
    expect(r).toEqual({ ok: true, coords: [[127.00, 37.5], [127.01, 37.5], [127.02, 37.5]] });
  });
  it("reverses a way whose end touches the current end", () => {
    const r = stitchWays([w(10), w(11), w(12)], idx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.coords.at(-1)).toEqual([127.03, 37.5]);
  });
  it("orients the first way toward the second", () => {
    const r = stitchWays([w(20), w(11)], idx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.coords[0]).toEqual([127.00, 37.5]);
  });
  it("reports a gap instead of jumping", () => {
    const r = stitchWays([w(10), w(13)], idx);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("gap"); expect(r.atWayId).toBe(13); expect(r.gapM).toBeGreaterThan(1000); }
  });
  it("handles an empty list", () => {
    expect(stitchWays([], idx)).toEqual({ ok: false, reason: "empty" });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/track/stitch.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

끝점 거리는 `@turf/distance`(`units: "meters"`).

- [ ] **Step 4: 테스트 통과 확인**

Run: 위 명령
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): stitch OSM ways into one polyline"
```

---

### Task 10: 역 투영과 shape 검증

**Files:**
- Create: `packages/transit-static/src/track/project.ts`, `packages/transit-static/src/track/validate.ts`
- Test: `packages/transit-static/src/track/project.test.ts`, `packages/transit-static/src/track/validate.test.ts`

**Interfaces:**
- Consumes: `LngLat`(Task 9), `CrosswalkRow`(Task 5), `OsmNode`(Task 8)
- Produces:
  - `const STATION_WARN_OFFSET_M = 80`, `const STATION_MAX_OFFSET_M = 150`
  - `lineLengthM(coords: LngLat[]): number` (`@turf/length`, meters)
  - `projectPoint(coords: LngLat[], point: LngLat): { distanceM: number; offsetM: number; snapped: LngLat }` (`@turf/nearest-point-on-line`의 `properties.location`과 `properties.dist`, units meters)
  - `projectStations(coords: LngLat[], stations: { statnId: string; lat: number; lng: number }[]): { onShape: { statnId: string; distanceM: number; offsetM: number }[]; offShape: { statnId: string; offsetM: number }[] }` — `offsetM <= STATION_MAX_OFFSET_M`이면 onShape, 아니면 offShape. onShape는 `distanceM` 오름차순 정렬.
  - `validate.ts`:
    ```ts
    type ShapeIssue = { level: "error" | "warn"; code: "stop-order" | "station-offset" | "short-gap" | "long-gap" | "unmatched-osm-stop" | "no-stations"; detail: string }
    validateShape(args: { stations: { statnId: string; distanceM: number; offsetM: number }[]; osmStopOrder: string[] /* statnId, 멤버 순서 */; medianGapM: number }): ShapeIssue[]
    ```
    규칙: `osmStopOrder`에 있는 역들의 `distanceM`이 순서대로 증가하지 않으면 `stop-order` error. `offsetM > STATION_WARN_OFFSET_M`이면 `station-offset` warn. 인접 역 간 거리 `< 300`이면 `short-gap` warn, `> 3 * medianGapM`이면 `long-gap` warn. 역이 2개 미만이면 `no-stations` error.
  - `matchOsmStops(stops: OsmNode[], candidates: CrosswalkRow[]): { statnId: string; osmNodeId: number }[]` — `tags.ref`가 후보의 `frCode`와 같으면 그 역, 아니면 `normalizeStationName(tags.name)`이 후보의 `nameCanonical` 또는 `nameAliases`를 정규화한 값과 같으면 그 역. 둘 다 없으면 제외(호출자가 `unmatched-osm-stop` warn을 낸다).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// project.test.ts
import { describe, expect, it } from "bun:test";
import { lineLengthM, projectStations } from "./project";

// 위도 37.5에서 경도 0.01도는 약 884m
const line: [number, number][] = [[127.00, 37.5], [127.01, 37.5], [127.02, 37.5]];

describe("projectStations", () => {
  it("measures distance from the line start and sorts along the line", () => {
    const r = projectStations(line, [
      { statnId: "B", lat: 37.5, lng: 127.02 },
      { statnId: "A", lat: 37.5001, lng: 127.01 },
    ]);
    expect(r.offShape).toEqual([]);
    expect(r.onShape.map((s) => s.statnId)).toEqual(["A", "B"]);
    expect(r.onShape[0]?.distanceM).toBeCloseTo(lineLengthM(line) / 2, -1);
    expect(r.onShape[0]?.offsetM).toBeCloseTo(11.1, 0);
    expect(r.onShape[1]?.distanceM).toBeCloseTo(lineLengthM(line), -1);
  });
  it("puts stations farther than 150 m off the shape", () => {
    const r = projectStations(line, [{ statnId: "FAR", lat: 37.502, lng: 127.01 }]);
    expect(r.onShape).toEqual([]);
    expect(r.offShape[0]?.statnId).toBe("FAR");
    expect(r.offShape[0]?.offsetM).toBeGreaterThan(150);
  });
});
```

```ts
// validate.test.ts
import { describe, expect, it } from "bun:test";
import { matchOsmStops, validateShape } from "./validate";

const s = (statnId: string, distanceM: number, offsetM = 10) => ({ statnId, distanceM, offsetM });

describe("validateShape", () => {
  it("passes a clean shape", () => {
    expect(validateShape({ stations: [s("A", 0), s("B", 1000), s("C", 2100)], osmStopOrder: ["A", "B", "C"], medianGapM: 1000 })).toEqual([]);
  });
  it("errors when OSM stop order disagrees with projected order", () => {
    const issues = validateShape({ stations: [s("A", 0), s("B", 1000), s("C", 2100)], osmStopOrder: ["A", "C", "B"], medianGapM: 1000 });
    expect(issues.some((i) => i.code === "stop-order" && i.level === "error")).toBe(true);
  });
  it("warns on large offsets and odd gaps", () => {
    const issues = validateShape({ stations: [s("A", 0, 120), s("B", 100), s("C", 5000)], osmStopOrder: [], medianGapM: 1000 });
    expect(issues.map((i) => i.code).sort()).toEqual(["long-gap", "short-gap", "station-offset"]);
    expect(issues.every((i) => i.level === "warn")).toBe(true);
  });
  it("errors with fewer than two stations", () => {
    expect(validateShape({ stations: [s("A", 0)], osmStopOrder: [], medianGapM: 0 })[0]?.code).toBe("no-stations");
  });
});

describe("matchOsmStops", () => {
  const cand = (statnId: string, nameCanonical: string, frCode?: string, aliases: string[] = []) => ({ statnId, nameCanonical, frCode, nameAliases: aliases }) as never;
  it("prefers ref = frCode, then normalized name, then aliases", () => {
    const r = matchOsmStops([
      { type: "node", id: 1, lat: 0, lon: 0, tags: { ref: "S401", name: "엉뚱" } },
      { type: "node", id: 2, lat: 0, lon: 0, tags: { name: "서울역" } },
      { type: "node", id: 3, lat: 0, lon: 0, tags: { name: "원곡" } },
      { type: "node", id: 4, lat: 0, lon: 0, tags: { name: "모름" } },
    ], [cand("1", "샛강", "S401"), cand("2", "서울"), cand("3", "시우", undefined, ["원곡"])]);
    expect(r).toEqual([{ statnId: "1", osmNodeId: 1 }, { statnId: "2", osmNodeId: 2 }, { statnId: "3", osmNodeId: 3 }]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/track/project.test.ts src/track/validate.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

- [ ] **Step 4: 테스트 통과 확인**

Run: 위 명령
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/transit-static
git commit -m "feat(transit-static): project stations onto track shapes and validate them"
```

---

### Task 11: 선로 조립, 적재, 실제 데이터 통과

**Files:**
- Create: `packages/transit-static/src/track/assemble.ts`, `packages/transit-static/src/jobs/build-tracks.ts`
- Modify: `packages/transit-static/src/cli.ts` (`build:tracks [--dry-run]`), `packages/transit-static/src/manual/osm-routes.json`, `packages/transit-static/README.md`
- Test: `packages/transit-static/src/track/assemble.test.ts`, `packages/transit-static/src/track/assemble.integration.test.ts`

**Interfaces:**
- Consumes: Task 8~10 함수, `loadTracks`(Task 7), `TrackShapeInput`(Task 7), `CrosswalkRow`(Task 5)
- Produces:
  - ```ts
    type OsmRouteConfig = { lineKey: LineKey; branchKey: string; direction: "up" | "down"; osmRelationId: number; note?: string }
    type AssembleResult = { ok: boolean; shapes: TrackShapeInput[]; issues: { osmRelationId: number; lineKey: LineKey; issues: ShapeIssue[] }[]; stitchFailures: { osmRelationId: number; reason: string }[]; uncoveredStations: { statnId: string; lineKey: LineKey; nearestOffsetM: number }[]; markdown: string }
    assembleTracks(args: { osm: OsmIndex; routes: OsmRouteConfig[]; crosswalk: CrosswalkRow[] }): AssembleResult
    ```
    절차(route마다): relation 찾기(없으면 stitchFailure `missing-relation`) → `wayMembersOf` → `stitchWays`(실패면 stitchFailure) → 같은 `lineKey`의 crosswalk 역을 `projectStations` → `matchOsmStops(stopNodesOf(rel), onShape 역들)`로 `osmStopNodeId`와 `osmStopOrder` → `validateShape` → `TrackShapeInput`(stations에 `seq`는 distanceM 순 0부터, `attribution` 고정 문자열). 매칭 안 된 OSM stop마다 `unmatched-osm-stop` warn.
    모든 route를 처리한 뒤 crosswalk의 각 역이 자기 lineKey의 어떤 shape에도 onShape가 아니면 `uncoveredStations`(nearestOffsetM은 그 노선 shape들에 대한 최소 offset).
    `ok` = stitchFailures 없음, error 수준 issue 없음, uncoveredStations 없음, 19개 lineKey마다 shape가 1개 이상.
  - job `buildTracks({ dataDir, db, dryRun })`: `data/raw/osm/routes.json`, `osm-routes.json`, DB의 current `station_crosswalk` 배치를 읽어 `assembleTracks` → 보고서(`data/reports/build-tracks/`) → ok이고 dryRun 아니면 `loadTracks`. 아니면 exit 1.
  - `loadBuildTracksInput(dataDir: string, db?: Database): Promise<{ osm: OsmIndex; routes: OsmRouteConfig[]; crosswalk: CrosswalkRow[] }>` — job 파일에서 export. `db`가 없으면 `DATABASE_URL`(기본 `file:./local.db`)로 연다.
  - `loadCurrentCrosswalk(db): Promise<CrosswalkRow[]>` in `db/load.ts` — `is_current` 배치의 행.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// assemble.test.ts
import { describe, expect, it } from "bun:test";
import { indexOsm } from "./osm-model";
import { assembleTracks } from "./assemble";

const node = (id: number, lon: number, tags?: Record<string, string>) => ({ type: "node", id, lat: 37.5, lon, tags });
const osm = indexOsm({ elements: [
  node(1, 127.00, { name: "가", railway: "stop" }), node(2, 127.01), node(3, 127.02, { name: "나" }), node(4, 127.03, { name: "다" }),
  { type: "way", id: 10, nodes: [1, 2, 3] }, { type: "way", id: 11, nodes: [3, 4] },
  { type: "relation", id: 100, members: [{ type: "node", ref: 1, role: "stop" }, { type: "node", ref: 3, role: "stop" }, { type: "node", ref: 4, role: "stop" }, { type: "way", ref: 10, role: "" }, { type: "way", ref: 11, role: "" }], tags: { route: "subway" } },
] });
const cw = (statnId: string, name: string, lng: number, lineKey = "line2") => ({ statnId, subwayId: "1002", lineKey, nameCanonical: name, nameAliases: [name], lat: 37.5, lng, coordSource: "station-master", bldnId: "", matchMethod: "auto-same-line", qualityFlags: [] }) as never;
const route = { lineKey: "line2", branchKey: "main", direction: "up", osmRelationId: 100 } as const;

describe("assembleTracks", () => {
  it("builds one shape with ordered stations and OSM stop ids", () => {
    const r = assembleTracks({ osm, routes: [route], crosswalk: [cw("A", "가", 127.00), cw("B", "나", 127.02), cw("C", "다", 127.03)] });
    expect(r.ok).toBe(true);
    const shape = r.shapes[0];
    expect(shape?.coords.length).toBe(4);
    expect(shape?.lengthM).toBeCloseTo(2653, -2);
    expect(shape?.stations.map((s) => [s.statnId, s.seq, s.osmStopNodeId])).toEqual([["A", 0, 1], ["B", 1, 3], ["C", 2, 4]]);
    expect(shape?.attribution).toBe("© OpenStreetMap contributors (ODbL)");
  });
  it("reports a station of the line that lies on no shape", () => {
    const r = assembleTracks({ osm, routes: [route], crosswalk: [cw("A", "가", 127.00), cw("B", "나", 127.02), cw("Z", "먼역", 127.30)] });
    expect(r.ok).toBe(false);
    expect(r.uncoveredStations[0]).toMatchObject({ statnId: "Z", lineKey: "line2" });
  });
  it("records a stitch failure for a missing relation and keeps going", () => {
    const r = assembleTracks({ osm, routes: [route, { ...route, osmRelationId: 999, direction: "down" }], crosswalk: [cw("A", "가", 127.00), cw("B", "나", 127.02)] });
    expect(r.shapes.length).toBe(1);
    expect(r.stitchFailures).toEqual([{ osmRelationId: 999, reason: "missing-relation" }]);
    expect(r.ok).toBe(false);
  });
  it("ignores stations of other lines", () => {
    const r = assembleTracks({ osm, routes: [route], crosswalk: [cw("A", "가", 127.00), cw("B", "나", 127.02), cw("X", "다", 127.03, "line3")] });
    expect(r.shapes[0]?.stations.map((s) => s.statnId)).toEqual(["A", "B"]);
    expect(r.uncoveredStations).toEqual([]);
  });
});
```

```ts
// assemble.integration.test.ts
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolveDataDir } from "../paths";
import { loadBuildTracksInput } from "../jobs/build-tracks";
import { assembleTracks } from "./assemble";

const dataDir = resolveDataDir(process.env);
const ready = existsSync(`${dataDir}/raw/osm/routes.json`) && existsSync("local.db");

describe.skipIf(!ready)("tracks against real OSM and crosswalk", () => {
  it("covers every crosswalk station on all 19 lines without errors", async () => {
    const r = assembleTracks(await loadBuildTracksInput(dataDir));
    expect(r.stitchFailures).toEqual([]);
    expect(r.uncoveredStations).toEqual([]);
    expect(r.issues.flatMap((i) => i.issues).filter((i) => i.level === "error")).toEqual([]);
    expect(new Set(r.shapes.map((s) => s.lineKey)).size).toBe(19);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/transit-static && bun test src/track`
Expected: FAIL (assemble), integration skip

- [ ] **Step 3: `assemble.ts`, job, CLI, `loadCurrentCrosswalk` 구현**

markdown 보고서: 노선별 shape 수, shape마다 길이·역 수·warn 수, error 목록, stitch 실패 목록, 미커버 역 목록, OSM stop 미매칭 목록.

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `cd packages/transit-static && bun test`
Expected: PASS, integration 2 skipped

- [ ] **Step 5: `osm-routes.json` 큐레이션 (키 불필요)**

Task 8의 탐색 보고서를 보고 19개 노선 각각에 대해 방향별 relation을 고른다. 기준:
- `route=subway|train|light_rail`이고 route_master가 해당 노선인 것. 2호선 본선은 내선·외선 2개, 성수지선·신정지선은 각각 양방향 2개.
- 1호선은 OSM에서 경부선·경인선·경원선·장항선 등으로 나뉘어 있을 수 있다. 실시간 1호선 역을 전부 덮도록 갈래를 여러 개 넣는다(`branchKey` 예: `gyeongin`, `gyeongbu`, `gwangmyeong`, `gyeongwon`, `sinchang`).
- 5호선은 `main`(방화~하남검단산)과 `macheon`, 경의중앙선은 `main`과 `imjingang`·`seoul-station`, 경춘선은 `main`과 광운대 갈래 등. 실시간 역 커버가 목표이므로 `uncoveredStations`가 비는 쪽으로 고른다.
- 방향: relation의 `from`/`to` 태그로 판단. 상행(`up`)은 실시간 API `updnLine=0`, 하행(`down`)은 `1`. 2호선은 내선=`up`, 외선=`down`. 판단 근거를 `note`에 적는다.

Run: `bun transit fetch:osm` → `bun transit build:tracks --dry-run`
Expected: 보고서를 보고 반복한다. stitch 실패(gap)는 다른 relation 변형을 고르거나, 해당 relation을 두 갈래로 나눠 등록한다. OSM 데이터 자체 오류면 README의 "알려진 OSM 문제" 절에 relation id와 증상을 적고 그 갈래를 제외한다(제외 역이 생기면 `uncoveredStations`로 드러나므로 숨길 수 없다). 최종적으로 `ok: true`.

- [ ] **Step 6: 통합 테스트와 적재**

Run: `cd packages/transit-static && bun test`
Expected: PASS, 통합 테스트 포함

Run: `bun transit build:tracks`
Expected: `reference_batch`에 `track` 배치, `track_shape` 수십 행, `track_station` 약 696행 이상(공용 갈래에서 중복 포함). 확인: `bun -e 'const {createClient}=await import("@libsql/client"); const c=createClient({url:"file:./local.db"}); console.log((await c.execute("select line_key, count(*) shapes, round(sum(length_m)/1000,1) km from track_shape group by 1")).rows)'`

- [ ] **Step 7: README 갱신, 전체 검사, 커밋**

Run: 저장소 루트에서 `bunx ultracite check`, `bun run check-types`, `bun test`
Expected: 모두 통과

```bash
git add packages/transit-static
git commit -m "feat(transit-static): assemble OSM track shapes with projected stations and load them"
```

---

## 완료 기준 (설계 문서 13장 1단계)

- `station_crosswalk` current 배치에 19개 노선 전 역(현재 판 기준 696개)이 있고 `unmatched`가 0이다.
- `track_shape` current 배치가 19개 노선을 모두 덮고, 모든 crosswalk 역이 자기 노선의 shape 중 하나에 150m 안으로 투영되어 있다.
- 선로 투영 경고(`station-offset`, `short-gap`, `long-gap`, `unmatched-osm-stop`) 목록이 `data/reports/build-tracks/` 최신 보고서에 있고 사람이 훑어봤다. 경고가 OSM 오류로 판단되면 README "알려진 OSM 문제"에 기록되어 있다.
- 매뉴얼 표 세 개(`station-aliases.json`, `source-line-names.json`, `osm-routes.json`)가 커밋되어 있고 README에 수정 절차가 있다.

## 범위 밖 (다음 계획)

- 시간표 적재와 열차번호 매칭(설계 6.3, 6.4절, 2단계)
- 버스 정적 데이터(6.5절, 3단계)
- 앱 배포용 참조 데이터 묶음(9.4절) — 선로 좌표를 앱에 내려보내는 형식은 배포 설계에서 정한다
- 월간 자동 갱신 스케줄링과 1% 길이 변화 감지(6.2 갱신 규칙) — 지금은 CLI 수동 실행이고, `diffStationLists`와 `reference_batch` 버전으로 수동 비교가 가능하다
