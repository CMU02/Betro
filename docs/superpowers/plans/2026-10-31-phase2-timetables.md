# 2단계: 시간표 적재와 열차번호 대응 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 19개 노선의 시간표를 출처별 어댑터로 읽어 하나의 공통 모델(trip, stop_time)로 참조 DB에 적재하고, 실시간 열차번호를 시간표 열차에 잇는 노선별 규칙을 만들어 표본 기준 매칭률을 측정한다.

**Architecture:** 1단계의 `packages/transit-static`에 `timetable/`(공통 모델, 시각 파싱, 검증, 역 해석), `sources/`(출처별 다운로드·파서), `jobs/build-timetable.ts`(출처 레지스트리 → 어댑터 → 검증 → 보고서 → 적재), `realtime/`(실시간 응답 파서와 노선별 열차번호 규칙), `jobs/report-match-rate.ts`를 더한다. 적재는 1단계와 같은 `reference_batch` 버전 체계(kind=`timetable`)와 manifest 해시(원본 + 매뉴얼 표 + 로직 버전)를 쓴다. 시간표 역은 대응표(`station_crosswalk` current 배치)의 `stationCd`로 먼저, 없으면 같은 노선 안의 정규화 이름으로, 그래도 없으면 매뉴얼 별칭표로 잇는다.

**Tech Stack:** Bun 1.4, TypeScript, Drizzle ORM + libsql(SQLite), zod, `read-excel-file`(xlsx, 1단계와 같음), `csv-parse`(CSV), `iconv-lite`(cp949 디코딩). 테스트는 `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-30-data-collection-design.md` §4.3, §4.4, §6.3, §6.4, §8(지하철 관측 이벤트 중 trainNo·match_status), §9.2, §13 2단계. 조사 보고서 `docs/research/2026-10-30-data-sources.md` 1장(실시간 API 응답 형태), 3장(시간표 출처 실측).

## Global Constraints

- 1단계 계획의 Global Constraints를 그대로 이어받는다(19개 `subwayId`↔`lineKey`, 10자리 `statnId` 문자열, 좌표 `[lng, lat]`, 원본 보관과 SHA-256 재적재 방지, Ultracite/Biome, 테스트는 `*.test.ts` 소스 옆, attribution 트레일러 금지, 키는 환경 변수로만).
- 시간표 공통 모델(§6.3): `trip`은 `line_key`, `service_day`(평일/토요일/휴일), `direction`, `timetable_train_no`(출처 원래 번호), `express`(일반/급행/특급/직통), `origin`, `destination`, `source`, `source_version`(기준일). `stop_time`은 `trip`, `seq`, `statn_id`, `arrive_sec`, `depart_sec`(서비스일 0시 기준 초, 24시 이후는 86,400 이상, 둘 중 하나는 비어 있을 수 있음).
- 검증(§6.3): 모든 `stop_time`의 역이 대응표에 있어야 한다. 한 열차 안에서 시각이 줄어들면 안 된다(24시 넘김 처리 후). 역간 소요시간이 같은 구간 다른 열차 중앙값의 3배 이상 또는 1/3 미만이면 경고. 출처별 기준일을 기록한다.
- 서울교통공사 CSV(§6.3 표): cp949. `00:00:00`은 null. 역사코드 앞자리 0 유지(문자열로 읽기). (호선, 요일, 열차코드)가 1편. 24시는 익일 00시, 25시는 익일 01시.
- korail.com XLSX와 공항철도 직통 시각표는 **사람이 파일을 받아서 넣는 방식**(§6.3 갱신). 서버는 해시 비교와 검증만 한다. 자동 수집하지 않는다.
- 열차번호 규칙(§6.4)은 **노선별로 바꿔 끼울 수 있는 함수**로 코드에 두고 실제 응답 표본으로 검증한다. 규칙으로 못 잇는 열차는 "시간표 없음" 상태로 넘긴다. 노선별 매칭률을 지표로 낸다.
- 시간표는 "정답"이 아니라 "사전 정보"다(§6.3 신선도). 출처가 없는 노선이 있어도 다른 노선의 적재를 막지 않는다. 대신 `linesWithoutTimetable`로 드러낸다.
- 실시간 API 호출은 공개 `sample` 키 경로(`http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/<노선명>`)만 쓴다. 실시간 지하철 인증키는 아직 없고, 이 계획은 그 키 없이 끝난다. 노선명은 UTF-8 퍼센트 인코딩한다.
- 키 의존성: 서울교통공사 CSV(data.go.kr 파일, 키 불필요), KRIC id=900 xlsx(키 불필요), sample 실시간(키 불필요). GTX-A 시간표(KRIC subwayTimetable API)는 KRIC 서비스키 `KRIC_SERVICE_KEY`가 필요하다. korail.com XLSX와 공항철도 직통 시각표는 사용자가 파일을 `data/manual/timetables/`에 넣어야 한다. 키·파일이 없어도 Task 1~10의 모든 테스트는 통과해야 한다.
- 요일 표기 통일: `weekday` | `saturday` | `holiday`. 토요일 시간표가 없는 출처(코레일, KRIC 코레일 행, 공항철도)는 토요일에 휴일 시간표를 복제하되 trip에 `service_day_source: "holiday-copied"` 플래그를 남긴다(§6.3 **[설계 판단, 공식 확인 필요]**).
- 방향 통일: `up` | `down`. 1단계 선로와 같은 관행(상행·내선=`up`, 하행·외선=`down`). 서울교통공사 CSV의 `UP`/`DOWN`은 그대로, 2호선 `IN`(내선)/`OUT`(외선)은 `up`/`down`. 다른 출처는 어댑터마다 적고 테스트로 고정한다.

## Review Focus

1. **시각이 자정을 넘는 열차**: `24:05:00`, `25:10`, 그리고 23시대에서 00시대로 넘어가는 표기(KRIC 일부)는 모두 86,400 이상으로 올라가야 하고, 한 열차 안에서 단조 증가해야 한다. Task 2 `parseClock`·`normalizeTripTimes` 테스트에 고정.
2. **`00:00:00`이 결측인 출처와 실제 자정인 출처의 구분**: 서울교통공사 CSV에서만 `00:00:00`을 null로 본다. 다른 출처에서 자정 정각이 결측으로 바뀌면 막차가 사라진다. Task 2 파서 옵션 `midnightIsNull`로 분리하고 Task 4·5 테스트에서 양쪽을 고정.
3. **대응표에 `stationCd`가 없는 37역**(서울, 총신대입구, 광나루, 천호 등 괄호 병기 역): 코드로 못 잇고 이름으로 이어야 한다. `normalizeStationName`이 괄호를 떼므로 통하지만, 같은 노선에 정규화 이름이 겹치는 역(없어야 함)이 있으면 모호하다. Task 3 테스트에 "코드 없음 → 이름으로 해석", "이름 모호 → 오류" 고정.
4. **열차번호 규칙의 충돌**: 2호선 지선 번호(1510/5510)는 4자리 전체가 키이고 본선은 끝 3자리 앞에 2를 붙인다. 지선 번호를 본선 규칙으로 돌리면 엉뚱한 열차에 붙는다. Task 10 테스트에 지선·본선 혼합 표본 고정.
5. **열차코드가 한 서비스일에 중복되는 경우**(연구: (열차, 역) 중복 1,546건): 같은 (노선, 요일, 열차코드)에 같은 역이 두 번 나오면 순환·회차 열차이거나 데이터 오류다. 버리지 말고 `duplicate-stop` 플래그로 남기고 seq는 파일 순서대로. Task 4 테스트에 고정.

## 실행 방식과 모델 배정

1단계와 같은 subagent-driven-development. 구현자는 순차, 리뷰·검증은 병렬. 리뷰어는 전부 Opus 5.5.

| Task | 내용 | 구현 모델 | 이유 |
|---|---|---|---|
| 1 | DB 스키마(timetable 테이블 2개, kind 추가, 마이그레이션) | Sonnet 5.5 | 1단계 스키마와 같은 패턴 |
| 2 | 공통 모델, 시각 파싱, 검증 | Opus 5.5 | 자정 넘김·중앙값 검증 알고리즘 |
| 3 | 시간표 역 해석기(코드 → 이름 → 별칭) | Sonnet 5.5 | 인터페이스가 정해진 조인 |
| 4 | 서울교통공사 CSV 어댑터 | Opus 5.5 | 42만 행, 결측·중복 규칙 |
| 5 | KRIC id=900 코레일 행 형식 어댑터 | Sonnet 5.5 | 행 단위 정형 데이터 |
| 6 | KRIC id=900 묶음 문자열 어댑터(신분당·공항철도·우이신설·신림) | Opus 5.5 | 기관마다 다른 구분자 |
| 7 | 수동 투입 파일 어댑터(korail XLSX, 공항철도 직통) + GTX-A KRIC API 어댑터 | Sonnet 5.5 | 형식이 정해진 변환 |
| 8 | 출처 레지스트리, `build:timetable` 잡, 보고서, 적재 | Opus 5.5 | 오케스트레이션, 노선별 출처 우선순위 |
| 9 | 실시간 응답 파서와 sample 표본 수집 | Sonnet 5.5 | 봉투 파싱 |
| 10 | 노선별 열차번호 규칙과 매칭률 보고서 | Opus 5.5 | §4.3 규칙 전부, 충돌 처리 |
| 11 | 실데이터 적재와 표본 매칭률 측정, README | Opus 5.5 | 실데이터 판단 |

## 파일 구조

```
packages/db/src/schema/transit.ts              (수정: ReferenceBatchKind에 "timetable", 테이블 2개)
packages/db/src/migrations/<new>/              (생성: drizzle-kit generate)
packages/transit-static/
  package.json                                 (수정: csv-parse, iconv-lite 추가)
  src/timetable/model.ts                       ServiceDay, Direction, Express, Trip, StopTime, TimetableSource
  src/timetable/clock.ts                       parseClock, normalizeTripTimes
  src/timetable/validate.ts                    validateTrips → TimetableIssue[]
  src/timetable/resolve-station.ts             StationResolver(코드 → 이름 → 별칭)
  src/timetable/registry.ts                    노선별 출처 목록과 우선순위
  src/sources/seoul-metro-csv.ts               서울교통공사 CSV 다운로드·파서
  src/sources/kric-file.ts                     KRIC id=900 xlsx 다운로드·시트 읽기
  src/sources/kric-korail-rows.ts              코레일 행 형식 → Trip[]
  src/sources/kric-packed.ts                   묶음 문자열 형식 → Trip[]
  src/sources/korail-xlsx.ts                   korail.com 시각표 XLSX(수동 투입) → Trip[]
  src/sources/airport-express-csv.ts           공항철도 직통 시각표(수동 CSV) → Trip[]
  src/sources/kric-api.ts                      KRIC subwayTimetable API 클라이언트(GTX-A)
  src/realtime/position-parser.ts              realtimePosition 응답 파서
  src/realtime/train-no-rules.ts               노선별 trainNo → 시간표 번호 후보
  src/jobs/fetch-timetable-sources.ts          CSV·id=900 다운로드
  src/jobs/build-timetable.ts                  어댑터 → 검증 → 보고서 → 적재
  src/jobs/fetch-realtime-sample.ts            sample 키로 19노선 표본 저장
  src/jobs/report-match-rate.ts                표본 × 시간표 매칭률
  src/db/load.ts                               (수정: loadTimetable, loadCurrentTrips)
  src/cli.ts                                   (수정: 명령 4개 추가)
  src/manual/timetable-station-aliases.json    { source, lineKey, sourceStation, statnId }[]
  src/manual/timetable-sources.json            노선별 출처 설정(파일 경로, 기준일)
  README.md                                    (수정)
data/raw/seoul-metro-timetable/, data/raw/kric-file/, data/raw/realtime-sample/   (gitignore)
data/manual/timetables/                        (gitignore; 사용자가 korail XLSX·공항철도 CSV를 넣는 곳)
```

---

### Task 1: 시간표 DB 스키마

**Files:**
- Modify: `packages/db/src/schema/transit.ts`
- Create: `packages/db/src/migrations/<generated>/`
- Test: `packages/db/src/schema/transit.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `referenceBatch`, `ReferenceBatchKind`, `TrackDirection` (1단계)
- Produces:
  - `ReferenceBatchKind = "station_crosswalk" | "track" | "timetable"`
  - `ServiceDay = "weekday" | "saturday" | "holiday"`, `ExpressKind = "local" | "express" | "special" | "direct"`, `TimetableSourceKind = "seoul-metro-csv" | "kric-korail" | "kric-packed" | "korail-xlsx" | "airport-express-csv" | "kric-api"`
  - `timetableTrip` 테이블 `timetable_trip`: `id` pk, `batchId` fk(cascade), `lineKey` text, `serviceDay` text, `serviceDaySource` text (`"source"` | `"holiday-copied"`), `direction` text(`TrackDirection`), `trainNo` text(출처 원래 번호), `express` text, `originStatnId` text nullable, `destinationStatnId` text nullable, `source` text, `sourceVersion` text(기준일 `YYYY-MM-DD` 또는 출처 표기), `qualityFlags` json string[]. unique(`batchId`, `source`, `lineKey`, `serviceDay`, `direction`, `trainNo`).
  - `timetableStopTime` 테이블 `timetable_stop_time`: `id` pk, `tripId` fk(cascade), `seq` integer, `statnId` text, `arriveSec` integer nullable, `departSec` integer nullable, `qualityFlags` json string[]. unique(`tripId`, `seq`), index(`statnId`).

- [ ] **Step 1: 실패하는 테스트**

```ts
test("timetable trip and stop time round-trip", async () => {
	const db = await createTestDb();
	const [batch] = await db.insert(referenceBatch).values({ kind: "timetable", sourceManifest: {} }).returning();
	const [trip] = await db.insert(timetableTrip).values({
		batchId: batch.id, lineKey: "line2", serviceDay: "weekday", serviceDaySource: "source",
		direction: "up", trainNo: "2001", express: "local", source: "seoul-metro-csv",
		sourceVersion: "2026-09-14", qualityFlags: [],
	}).returning();
	await db.insert(timetableStopTime).values([
		{ tripId: trip.id, seq: 0, statnId: "1002000201", arriveSec: null, departSec: 18000, qualityFlags: [] },
		{ tripId: trip.id, seq: 1, statnId: "1002000202", arriveSec: 18120, departSec: 18150, qualityFlags: [] },
	]);
	const rows = await db.select().from(timetableStopTime).orderBy(timetableStopTime.seq);
	expect(rows.map((r) => r.departSec)).toEqual([18000, 18150]);
});

test("duplicate trip key in one batch is rejected", async () => {
	// 같은 (batch, source, line, day, direction, trainNo) 두 번 insert → reject
});
```

- [ ] **Step 2: 실행해 실패 확인** — `cd packages/db && bun test` → `timetableTrip` 미정의
- [ ] **Step 3: 스키마 구현** — 위 Interfaces대로. `drizzle-kit generate`로 마이그레이션 생성, 생성 SQL이 테이블 2개 추가만인지 확인. `bun run db:migrate`로 local.db 적용.
- [ ] **Step 4: 통과 확인** — `bun test` PASS
- [ ] **Step 5: 커밋** — `feat(db): add timetable trip and stop time tables`

---

### Task 2: 공통 모델, 시각 파싱, 검증

**Files:**
- Create: `packages/transit-static/src/timetable/model.ts`, `clock.ts`, `validate.ts`
- Test: `clock.test.ts`, `validate.test.ts`

**Interfaces:**
- Produces:
  - `model.ts`: `interface StopTime { seq: number; statnId: string; arriveSec: number | null; departSec: number | null; qualityFlags: string[] }`, `interface Trip { lineKey: LineKey; serviceDay: ServiceDay; serviceDaySource: "source" | "holiday-copied"; direction: TrackDirection; trainNo: string; express: ExpressKind; originStatnId?: string; destinationStatnId?: string; source: TimetableSourceKind; sourceVersion: string; stops: StopTime[]; qualityFlags: string[] }`, `type SourceStop = { seq: number; station: { code?: string; name?: string }; arrive: string | null; depart: string | null }`(어댑터가 역 해석 전 단계에서 만드는 중간 형태), `type SourceTrip = Omit<Trip, "stops" | "sourceVersion"> & { stops: SourceStop[]; sourceVersion?: string }`(모든 어댑터의 출력. Task 8이 역을 해석하고 시각을 파싱해 `Trip`으로 바꾼다)
  - `clock.ts`: `parseClock(text: string, opts?: { midnightIsNull?: boolean }): number | null` — `"HH:MM"`/`"HH:MM:SS"`, HH는 0~29 허용(24→86400+), 빈 문자열·공백·`"-"`은 null, `midnightIsNull`이면 `"00:00:00"`/`"00:00"`도 null, 그 외 형식은 throw. `normalizeTripTimes(stops: StopTime[]): StopTime[]` — 앞 역보다 작은 시각이 나오면(23:50 다음 00:05처럼) 그 지점부터 86400을 더한다. 이미 86400 이상이면 더하지 않는다. 입력을 바꾸지 않는다.
  - `validate.ts`: `interface TimetableIssue { severity: "error" | "warn"; code: "unknown-station" | "non-monotonic" | "segment-outlier" | "empty-trip" | "duplicate-stop"; lineKey: LineKey; trainNo: string; serviceDay: ServiceDay; detail: string }`, `validateTrips(trips: Trip[], knownStatnIds: ReadonlySet<string>): TimetableIssue[]` — unknown-station(error), non-monotonic(error: arrive/depart 순서 포함해 줄어듦), empty-trip(error: 정차 1개 이하), segment-outlier(warn: 같은 (lineKey, from, to) 구간의 소요시간 중앙값 대비 ≥3배 또는 <1/3, 표본이 3개 미만인 구간은 건너뜀), duplicate-stop(warn: 한 trip에 같은 statnId 2회 이상).
  - 상수 `SEGMENT_OUTLIER_FACTOR = 3`, `SEGMENT_MIN_SAMPLES = 3`.

- [ ] **Step 1: 실패하는 테스트** — `clock.test.ts`: `parseClock("05:00:00")===18000`, `parseClock("24:05:00")===86700`, `parseClock("25:10")===90600`, `parseClock("00:00:00",{midnightIsNull:true})===null`, `parseClock("00:00:00")===0`, `parseClock("")===null`, `parseClock("5시")` throws. `normalizeTripTimes`: `[85800, 300]`→`[85800, 86700]`; 이미 `[85800, 86700]`이면 그대로. `validate.test.ts`: 5개 코드 각각 1건 + 정상 trip 0건.
- [ ] **Step 2: 실패 확인** — 모듈 없음
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat(transit-static): timetable model, clock parsing, and trip validation`

---

### Task 3: 시간표 역 해석기

**Files:**
- Create: `packages/transit-static/src/timetable/resolve-station.ts`, `src/manual/timetable-station-aliases.json` (`[]`)
- Test: `resolve-station.test.ts`

**Interfaces:**
- Consumes: `CrosswalkRow`(1단계 `crosswalk/match.ts`), `normalizeStationName`(1단계)
- Produces:
  - `interface StationAlias { source: TimetableSourceKind | "*"; lineKey: LineKey; sourceStation: string; statnId: string }`
  - `createStationResolver(crosswalk: CrosswalkRow[], aliases: StationAlias[]): StationResolver`
  - `StationResolver.resolve(args: { source: TimetableSourceKind; lineKey: LineKey; code?: string; name?: string }): { statnId: string; method: "code" | "name" | "alias" } | { error: "unknown" | "ambiguous"; candidates: string[] }`
  - 순서: (1) `code`가 있고 같은 lineKey의 `stationCd`와 일치, (2) `name` 정규화가 같은 lineKey의 `nameCanonical`/`nameAliases` 정규화와 일치(후보 2개 이상이면 ambiguous), (3) 별칭표(`source` 일치 또는 `"*"`, `sourceStation`은 code 또는 name 원문과 비교). 어느 단계도 lineKey 밖을 보지 않는다.
  - `StationResolver.unresolved(): { source; lineKey; code?; name?; count }[]` — resolve가 실패한 입력을 집계(보고서용).

- [ ] **Step 1: 실패하는 테스트** — 코드 일치, 코드 없음→이름, 괄호 병기 이름(`"총신대입구(이수)"` → 정규화로 일치), 이름 모호(같은 노선에 정규화 동명 2개 fixture) → ambiguous, 별칭표로 해석, 다른 노선 같은 코드는 매칭 안 됨, unresolved 집계 count.
- [ ] **Step 2~5** — 구현, 통과, 커밋 `feat(transit-static): resolve timetable stations through the crosswalk`

---

### Task 4: 서울교통공사 CSV 어댑터

**Files:**
- Create: `packages/transit-static/src/sources/seoul-metro-csv.ts`, `src/jobs/fetch-timetable-sources.ts`(이 Task에서는 CSV 부분만)
- Modify: `packages/transit-static/package.json`(`csv-parse`, `iconv-lite` 추가), `src/cli.ts`(`fetch:timetable-sources`)
- Test: `seoul-metro-csv.test.ts` (fixture: `src/sources/__fixtures__/seoul-metro-sample.csv`, 실제 파일에서 머리글 + 1호선 K802 열차 일부 + 2호선 본선·지선 열차 일부 + `00:00:00` 행 + 중복 역 행을 뽑아 cp949로 저장)

**Interfaces:**
- Consumes: `saveRaw`, `readRaw`, `resolveDataDir`(1단계), `parseClock`, `normalizeTripTimes`, `SourceStop`(Task 2), `lineKeyBySubwayId`·`LINES`(1단계)
- Produces:
  - `SEOUL_METRO_CSV_URL`(상수, 연구 보고서 3장의 data.go.kr 파일 URL; 판이 바뀌면 `timetable-sources.json`에서 덮어쓸 수 있게 `fetchSeoulMetroCsv(dataDir, url = SEOUL_METRO_CSV_URL)`)
  - `decodeCp949(bytes: Uint8Array): string`
  - `parseSeoulMetroCsv(text: string): { trips: SourceTrip[]; errors: string[]; header: string[] }` — `SourceTrip`은 Task 2. 머리글을 이름으로 찾는다(위치 의존 금지). 호선 문자열(`"1호선"`…`"9호선"`) → lineKey. 요일 `DAY`/`SAT`/`END` → `weekday`/`saturday`/`holiday`. 방향 `UP`/`DOWN` → `up`/`down`, `IN`/`OUT` → `up`/`down`(2호선). 급행여부 `1` → `express`, 그 외 `local`. 그룹 키 (호선, 요일, 열차코드). `00:00:00`은 null(`midnightIsNull: true`). 역사코드는 문자열 그대로(앞자리 0 보존). 같은 그룹에 같은 역사코드가 다시 나오면 `duplicate-stop` 플래그. 알 수 없는 호선·요일·방향 값은 `errors`에 행 번호와 함께.
  - `seoulMetroSourceVersion(fileName: string): string` — 파일명의 `_YYYYMMDD` → `YYYY-MM-DD`, 없으면 `"unknown"`.

- [ ] **Step 1: 실제 파일 내려받아 머리글 확인(테스트 전 조사)** — `curl -L -o /tmp/x.csv "<URL>"`(또는 bun fetch), `iconv -f cp949` 첫 3행 출력. 머리글 문자열을 테스트 fixture와 구현에 그대로 쓴다. 이 단계의 출력(머리글, 행 수)을 보고서에 적는다.
- [ ] **Step 2: 실패하는 테스트** — fixture로: 1호선 K802가 1편이고 정차가 파일 순서대로 seq를 가진다; `00:00:00` 행의 arrive가 null; 2호선 `IN`→`up`; 급행여부 1→`express`; 역사코드 `"0151"` 그대로; 중복 역 행에 `duplicate-stop`; 알 수 없는 요일 값 → errors 1건; `seoulMetroSourceVersion("..._20260914.csv")==="2026-09-14"`.
- [ ] **Step 3: 실패 확인**
- [ ] **Step 4: 구현** — `csv-parse/sync`로 파싱(`columns: true`, `bom: true`), 42만 행은 메모리에 올려도 된다(약 50MB). 다운로드는 `saveRaw(dataDir, "seoul-metro-timetable", "<원본 파일명>", bytes)`; Content-Disposition에서 파일명을 얻고 없으면 `timetable.csv`.
- [ ] **Step 5: 통과 확인**, 실제 파일로 `parseSeoulMetroCsv` 돌려 trips 수(연구: 12,565 조합)와 errors를 보고서에 기록.
- [ ] **Step 6: 커밋** — `feat(transit-static): download and parse the Seoul Metro timetable CSV`

---

### Task 5: KRIC id=900 파일과 코레일 행 형식 어댑터

**Files:**
- Create: `src/sources/kric-file.ts`, `src/sources/kric-korail-rows.ts`
- Modify: `src/jobs/fetch-timetable-sources.ts`(id=900 다운로드 추가)
- Test: `kric-korail-rows.test.ts` (fixture: 실제 파일에서 경의중앙선·서해선 열차 몇 편의 행, 평일·휴일 모두)

**Interfaces:**
- Consumes: `read-excel-file`(1단계 `station-xlsx.ts`의 사용법), Task 2·3
- Produces:
  - `KRIC_FILE_URL`(상수: `https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1`), `fetchKricFile(dataDir)`, `readKricRows(bytes): Promise<KricRow[]>` — 13개 컬럼을 머리글 이름으로 읽어 `KricRow { lineName: string; operator: string; dayLabel: string; trainNo: string; stationName: string; arrive: string | null; depart: string | null; raw: Record<string, unknown> }` 형태로. 묶음 문자열 노선은 그대로 raw에 남긴다(Task 6이 읽음).
  - `KRIC_LINE_NAMES: Record<string, LineKey>` — 코레일 행 형식 노선명 → lineKey(경의중앙, 수인분당, 경춘, 서해, 경강). 파일의 실제 표기를 Step 1에서 확인해 넣는다.
  - `parseKricKorailRows(rows: KricRow[]): { trips: SourceTrip[]; errors: string[]; sourceVersion: string }` — 평일/휴일만 있으면 토요일은 휴일 복제(`serviceDaySource: "holiday-copied"`). 방향은 행 순서와 종착역으로 판단: 1단계 `osm-routes.json`의 `up` 기준(경의중앙 상행=문산 방면, 수인분당 상행=청량리 방면, 경춘 상행=청량리/광운대 방면, 경강 상행=판교 방면, 서해 상행=일산 방면)과 같은 규칙을 `KORAIL_UP_TERMINALS: Record<LineKey, string[]>`로 두고 종착역이 그 목록에 있으면 `up`. 판단 못 하면 `direction-unknown` 플래그, `up`으로 두지 않고 trip을 errors로.
  - `express`: 행에 급행 표기가 있으면 `express`, 없으면 `local`.

- [ ] **Step 1: 실제 파일 내려받아 구조 확인** — 머리글 13개, 노선명 목록(distinct), 코레일 노선의 요일 표기, 기준일 칸. 결과를 보고서에 적고 상수에 반영.
- [ ] **Step 2: 실패하는 테스트** — fixture로 경의중앙선 열차 1편: 정차 순서·시각, 종착역으로 방향 결정, 휴일→토요일 복제가 `holiday-copied`로 1편 더 생김, 모르는 종착역이면 errors.
- [ ] **Step 3~5** — 실패 확인, 구현, 통과. 실제 파일로 코레일 5노선 trips 수를 보고서에.
- [ ] **Step 6: 커밋** — `feat(transit-static): KRIC timetable file download and Korail row adapter`

---

### Task 6: KRIC id=900 묶음 문자열 어댑터

**Files:**
- Create: `src/sources/kric-packed.ts`
- Test: `kric-packed.test.ts` (fixture: 실제 파일에서 신분당·공항철도·우이신설·신림 각 2~3행)

**Interfaces:**
- Consumes: Task 5 `KricRow`
- Produces:
  - `parseKricPacked(rows: KricRow[]): { trips: SourceTrip[]; errors: string[]; skipped: { lineName: string; reason: "headway-only" | "unknown-format" }[]; sourceVersion: Record<LineKey, string> }`
  - 형식별 파서를 노선명으로 고른다(연구 3장): 신분당 `'D19-10:17+…'`(열차번호 D19, `+`로 역/시각 쌍 구분, `-`로 역과 시각 분리), 공항철도 `'001+06:00+…'`, 우이신설 `'001-:+…'`(빈 시각 `:`는 null), 신림은 Step 1에서 확인. `'운행시격'` 텍스트만 있는 노선(인천2, 에버라인)은 `skipped`에 `headway-only`로. 범위 밖 노선(인천1 `,`, 의정부 `/`)은 파싱하지 않고 `skipped`에 넣지 않는다(범위 밖은 무시).
  - 역 이름은 `SourceStop.station.name`으로만 준다(코드 없음). 방향은 파일의 방향 칸이 있으면 쓰고, 없으면 Task 5와 같은 `UP_TERMINALS` 규칙(신분당 상행=신사 방면, 공항철도 상행=서울역 방면, 우이신설 상행=북한산우이 방면, 신림 상행=샛강 방면).
  - 공항철도: `express` 판단은 열차번호 접두(연구: A10xx 직통 `directAt=1`)가 아니라 정차 역 수로 한다 — 중간역을 건너뛰면 `direct`. 이유: 파일의 번호 체계가 실시간과 같다는 보장이 없다.

- [ ] **Step 1: 실제 파일에서 네 노선의 행 형식 확인** — 각 노선 첫 2행을 raw로 출력해 구분자·요일 표기·기준일을 보고서에 적는다. 신림의 형식도 여기서 정한다.
- [ ] **Step 2: 실패하는 테스트** — 신분당 1편: 열차번호 `D19`, 첫 정차 `10:17`; 우이신설 빈 시각이 null; 공항철도 직통 1편이 `direct`; `운행시격` 행이 skipped `headway-only`; 알 수 없는 형식 → `unknown-format`.
- [ ] **Step 3~5** — 실패 확인, 구현, 통과. 실제 파일로 노선별 trips 수와 skipped를 보고서에.
- [ ] **Step 6: 커밋** — `feat(transit-static): parse packed KRIC timetable strings for non-Korail lines`

---

### Task 7: 수동 투입 파일 어댑터와 GTX-A KRIC API 어댑터

**Files:**
- Create: `src/sources/korail-xlsx.ts`, `src/sources/airport-express-csv.ts`, `src/sources/kric-api.ts`
- Test: `korail-xlsx.test.ts`(fixture: 2시트 작은 xlsx를 테스트에서 생성하거나 `__fixtures__`에 둔다), `airport-express-csv.test.ts`, `kric-api.test.ts`(fetch 목)

**Interfaces:**
- Produces:
  - `parseKorailXlsx(bytes, lineKey): Promise<{ trips: SourceTrip[]; errors: string[]; sheets: string[] }>` — 시트 이름에 `평일`/`휴일`이 들어간 두 시트. 열차 1편이 열(column) 하나이고 행이 역인 형태가 일반적이지만 **Step 1에서 사용자가 넣은 실제 파일로 확인**한 뒤 고정한다. 파일이 없으면 이 Task는 fixture로만 테스트하고 README에 "파일 형식 확인 필요" 표시.
  - `AIRPORT_EXPRESS_CSV_COLUMNS = ["direction", "departStation", "departTime", "arriveStation", "arriveTime"]`; `parseAirportExpressCsv(text): { trips: SourceTrip[]; errors: string[] }` — 사용자가 공식 직통 시각표를 옮겨 적는 단순 CSV. 열차번호가 없으므로 `trainNo`는 `"DIRECT-<direction>-<HHMM>"`로 만들고 `qualityFlags`에 `synthetic-train-no`. `express: "direct"`. 정차는 서울역과 인천공항1·2터미널만.
  - `kric-api.ts`: `KRIC_API_BASE = "https://openapi.kric.go.kr/openapi/trainUseInfo/subwayTimetable"`, `fetchKricTimetable(args: { serviceKey; lnCd; railOprIsttCd; stinCd; dayCd: "7" | "8" | "9" }, fetchImpl = fetch): Promise<KricTimetableRow[]>`, `assembleKricApiTrips(rowsByStation: Map<string, KricTimetableRow[]>, lineKey): SourceTrip[]` — 역 단위 응답을 `trnNo`로 묶어 trip으로. GTX-A 코드(`lnCd` A, 운영기관 코드)는 연구 3장 후속의 KRIC 코드표 값을 상수로 두되 Step 1에서 `KRIC_SERVICE_KEY`가 있으면 실호출로 확인하고 없으면 fixture만.
  - 키: `process.env.KRIC_SERVICE_KEY`. 없으면 `fetch:timetable-sources --gtx-a`가 "KRIC_SERVICE_KEY가 없습니다. 국가철도공단 철도산업정보센터(KRIC)에서 서비스키를 발급받아 설정하세요." 안내 후 exit 1(1단계 `cli.ts`의 `SEOUL_OPEN_API_KEY` 처리와 같은 방식). `KRIC_API_BASE`의 정확한 경로는 연구 보고서 3장의 KRIC id=162 명세 페이지에서 Step 1에 확인한다.

- [ ] **Step 1: 수동 파일 유무 확인** — `data/manual/timetables/`에 korail XLSX가 있으면 시트 구조를 보고서에 적고 fixture를 거기서 만든다. 없으면 연구 보고서의 XLSX 예 URL 파일을 사용자가 받아 넣도록 README에 적고, 테스트용 최소 xlsx를 `__fixtures__`에 만든다.
- [ ] **Step 2: 실패하는 테스트** — korail: 평일 시트 열차 1편 파싱, 휴일→토요일 복제; airport: CSV 2행이 trip 2편, synthetic 번호와 `direct`; kric-api: 목 응답 2역 × 열차 2편 → trip 2편에 정차 2개씩, 키 없음 메시지.
- [ ] **Step 3~5** — 실패 확인, 구현, 통과
- [ ] **Step 6: 커밋** — `feat(transit-static): manual timetable file adapters and KRIC API client`

---

### Task 8: 출처 레지스트리, `build:timetable` 잡, 보고서, 적재

**Files:**
- Create: `src/timetable/registry.ts`, `src/jobs/build-timetable.ts`, `src/manual/timetable-sources.json`
- Modify: `src/db/load.ts`(`loadTimetable`, `loadCurrentTrips`), `src/cli.ts`(`build:timetable [--dry-run]`)
- Test: `registry.test.ts`, `build-timetable.test.ts`, `db/load.test.ts`에 timetable 적재·manifest 버전 테스트 추가

**Interfaces:**
- Consumes: Task 2~7 전부, 1단계 `loadCurrentCrosswalk`, `isCurrentManifest`, `withLogicVersion`, `writeReport`
- Produces:
  - `timetable-sources.json`: `{ lines: Record<LineKey, { primary: TimetableSourceKind; secondary?: TimetableSourceKind[]; manualFile?: string }> }`. 초기값(§4.4 표): line1~line9 → `seoul-metro-csv`; gyeongui-jungang, suin-bundang, gyeongchun, seohae, gyeonggang → `korail-xlsx`(manualFile 지정) 있으면 그것, 없으면 `kric-korail`; shinbundang, ui-sinseol, sillim → `kric-packed`; airport → `kric-packed` + `airport-express-csv`(직통은 별도 출처라 두 출처의 trip을 합친다); gtx-a → `kric-api`.
  - `registry.ts`: `resolveSources(config, available: { manualFiles: string[]; hasKricKey: boolean }): { lineKey; sources: TimetableSourceKind[]; missing: string[] }[]` — 노선마다 실제 쓸 출처 목록. 1차 출처의 파일이 없으면 2차로 내려가고, 전부 없으면 `missing`.
  - `TIMETABLE_LOGIC_VERSION = 1`(manifest 키 `timetableVersion`).
  - `buildTimetable(input: { dataDir; db; dryRun: boolean; now?: Date }): Promise<BuildTimetableResult>` — `BuildTimetableResult { ok: boolean; tripsByLine: Record<LineKey, number>; linesWithoutTimetable: LineKey[]; issues: TimetableIssue[]; unresolvedStations: ...; sourceVersions: Record<string, string>; loaded: boolean; reportPaths }`. `ok` = error 등급 issue 0건(warn은 허용) **그리고** unresolved 역 0건. `linesWithoutTimetable`은 ok에 영향 없음(전역 제약). ok이고 dryRun이 아니면 적재.
  - 적재 규칙(1단계와 같음): 트랜잭션 하나, `reference_batch(kind="timetable")` 생성, trip 500행·stop_time 2,000행 청크 insert, `is_current` demote→promote. manifest = 원본 파일(CSV, id=900, 수동 파일들) 해시 + `timetable-sources.json` + `timetable-station-aliases.json` 해시 + crosswalk current 배치 행 해시 + `timetableVersion`.
  - `loadCurrentTrips(db, lineKey?): Promise<(Trip & { id: number })[]>` — Task 10이 쓴다.
  - 보고서(md/json, `data/reports/build-timetable/`): 노선별 출처·기준일·trip 수·요일별 수, `linesWithoutTimetable`, issues(코드별 집계 + 상위 50건), unresolved 역 목록(출처·노선·원문·빈도), 토요일 복제 노선 목록, 신선도(기준일이 오늘보다 180일 넘게 오래된 출처 표시).

- [ ] **Step 1: 실패하는 테스트** — registry: 수동 파일 없으면 코레일 노선이 `kric-korail`로 내려감, KRIC 키 없으면 gtx-a가 missing; build: fixture 어댑터 결과로 ok/적재/보고서 생성, error issue 1건이면 ok false·적재 안 함, dry-run은 보고서만; load: 적재 후 `loadCurrentTrips("line2")` 행 수, manifest 버전만 다르면 재적재.
- [ ] **Step 2~4** — 실패 확인, 구현, 통과
- [ ] **Step 5: 커밋** — `feat(transit-static): build timetable job with source registry, reports, and loading`

---

### Task 9: 실시간 응답 파서와 sample 표본 수집

**Files:**
- Create: `src/realtime/position-parser.ts`, `src/jobs/fetch-realtime-sample.ts`
- Modify: `src/cli.ts`(`fetch:realtime-sample`)
- Test: `position-parser.test.ts`(fixture: 연구 1장의 실제 응답 형태 2종 — 성공 `{errorMessage:{...}, realtimePositionList:[...]}`, 실패 `{status:500, code:"INFO-200", ...}`)

**Interfaces:**
- Produces:
  - `interface RealtimeTrainRow { subwayId: string; lineKey: LineKey; statnId: string; statnNm: string; trainNo: string; updnLine: "0" | "1"; direction: TrackDirection; statnTid: string; statnTnm: string; trainSttus: "0" | "1" | "2" | "3"; directAt: string; lstcarAt: string; recptnDt: string; lastRecptnDt: string }`
  - `parseRealtimePosition(json: unknown): { ok: true; rows: RealtimeTrainRow[]; total: number } | { ok: false; code: string; message: string }` — 성공 봉투는 `errorMessage.code === "INFO-000"`와 `realtimePositionList`; 실패 봉투는 루트에 `code`. `updnLine "0"`→`up`, `"1"`→`down`. `subwayId`가 19개 밖이면 그 행은 버리고 `dropped`에 센다. zod 스키마로 형태를 강제한다.
  - `SAMPLE_POSITION_URL = (lineName: string) => \`http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/${encodeURIComponent(lineName)}\`` — 노선명은 `LINES[].nameKo`(1단계 `lines.ts`의 `LineInfo.nameKo`, 실시간 API가 받는 한글 노선명).
  - `fetchRealtimeSample(dataDir, fetchImpl = fetch): Promise<{ lineKey; rows: number; code: string }[]>` — 19노선 순차 호출(간격 200ms), 원본을 `saveRaw(dataDir, "realtime-sample", \`${lineKey}-${yyyymmddHHMM}.json\`)`로 저장. 실패 봉투도 저장한다(형식 표본).

- [ ] **Step 1: 실패하는 테스트** — 성공 봉투 파싱(행 수, direction 변환), 실패 봉투 `{ok:false, code:"INFO-200"}`, 모르는 subwayId 행 drop, 잘못된 형태 throw 대신 `{ok:false, code:"MALFORMED"}`.
- [ ] **Step 2~4** — 실패 확인, 구현, 통과
- [ ] **Step 5: 실행** — `bun transit fetch:realtime-sample` → 19노선 저장. 결과 표(노선별 행 수·코드)를 보고서에. 5행씩 최대 95대.
- [ ] **Step 6: 커밋** — `feat(transit-static): parse realtimePosition responses and collect sample fixtures`

---

### Task 10: 노선별 열차번호 규칙과 매칭률 보고서

**Files:**
- Create: `src/realtime/train-no-rules.ts`, `src/jobs/report-match-rate.ts`
- Modify: `src/cli.ts`(`report:match-rate`)
- Test: `train-no-rules.test.ts`, `report-match-rate.test.ts`

**Interfaces:**
- Consumes: Task 8 `loadCurrentTrips`, Task 9 파서·표본
- Produces:
  - `interface TrainNoMatch { candidates: string[]; rule: string; branchHint?: "main" | "branch" }`
  - `trainNoCandidates(lineKey: LineKey, rawTrainNo: string): TrainNoMatch | null` — §4.3 규칙:
    - `line1`: 앞의 `K`/`S` 접두를 떼고 4자리로 0 채움(`"S186"`→`["0186"]`, `"K802"`→`["0802"]`; 이미 4자리 숫자면 그대로)
    - `line3`, `line5`, `line6`, `line7`, `line8`: 그대로. 3호선은 `K` 접미 변형도 후보(`"3002"`→`["3002","3002K"]`)
    - `line4`: `["4327", "K4327"]`
    - `line9`: `["C9207", "E9207"]`(급행 여부를 모르면 둘 다; `directAt`를 알면 하나만 — 두 번째 인자 `opts?: { express?: boolean }`)
    - `line2`: 번호가 `1xxx`/`5xxx`(지선, 4자리 전체) → `[raw]`, `branchHint:"branch"`; 그 외 → `["2" + 끝 3자리]`, `branchHint:"main"`
    - 코레일 5노선(`gyeongui-jungang`, `suin-bundang`, `gyeongchun`, `seohae`, `gyeonggang`): `["K" + raw, raw]`
    - `airport`, `ui-sinseol`, `sillim`: `[raw]`
    - `shinbundang`, `gtx-a`: `null`(규칙 없음 → 시간표 없음)
  - `interface MatchRateRow { lineKey: LineKey; observed: number; matched: number; unmatched: string[]; noRule: boolean; rate: number | null }`
  - `matchObservations(rows: RealtimeTrainRow[], tripsByLine: Map<LineKey, Trip[]>, serviceDay: ServiceDay): MatchRateRow[]` — 후보 번호 중 하나라도 같은 (lineKey, serviceDay) trip에 있으면 매칭. 방향은 참고만 하고 조건에 넣지 않는다(2호선 성수 번호 변경 때문). `rate = matched / observed`, 시간표가 없는 노선은 `rate: null`.
  - `reportMatchRate({ dataDir, db, sampleDir?, serviceDay? })` — `data/raw/realtime-sample/`의 최신 표본(노선별 가장 최근 파일)을 읽어 `loadCurrentTrips`와 대조, 보고서 `data/reports/match-rate/`. `serviceDay`를 안 주면 표본 파일 날짜의 요일로 정한다(토요일 `saturday`, 일요일 `holiday`, 공휴일 판정은 하지 않고 README에 적는다).

- [ ] **Step 1: 실패하는 테스트** — 규칙별 1건씩(위 예시 값 그대로), 2호선 지선/본선 혼합, 신분당 null; `matchObservations`: 표본 3대 중 2대 매칭 → rate 2/3, 시간표 없는 노선 null, 후보 2개 중 두 번째가 맞는 경우.
- [ ] **Step 2~4** — 실패 확인, 구현, 통과
- [ ] **Step 5: 커밋** — `feat(transit-static): per-line train number rules and match rate report`

---

### Task 11: 실데이터 적재, 표본 매칭률 측정, README

**Files:**
- Modify: `src/manual/timetable-station-aliases.json`, `src/manual/timetable-sources.json`, `README.md`

- [ ] **Step 1: 원본 다운로드** — `bun transit fetch:timetable-sources` → CSV(약 42만 행)와 id=900 xlsx 저장. KRIC 키가 있으면 `--gtx-a`도. korail XLSX·공항철도 직통 CSV는 사용자가 `data/manual/timetables/`에 넣었으면 쓰고, 없으면 레지스트리가 `kric-korail`로 내려간다(보고서에 표시).
- [ ] **Step 2: dry-run 반복** — `bun transit build:timetable --dry-run`. unresolved 역 목록을 보고 `timetable-station-aliases.json`을 채운다(KRIC 축약 `디엠시`→디지털미디어시티 같은 것). 같은 역이 여러 출처에서 unresolved면 `source: "*"`. error issue(non-monotonic 등)는 원인을 적고, 데이터 오류로 판단되면 README "알려진 시간표 문제"에 기록한다(코드로 억지로 통과시키지 않는다). 최종 `ok: true`.
- [ ] **Step 3: 적재** — `bun transit build:timetable`. 확인 쿼리(packages/transit-static에서): `select line_key, service_day, count(*) from timetable_trip t join reference_batch b on b.id=t.batch_id where b.is_current=1 and b.kind='timetable' group by 1,2`. 기대: 1~9호선은 세 요일 모두, 코레일·KRIC 노선은 토요일이 `holiday-copied`. 재실행 시 건너뜀 확인.
- [ ] **Step 4: 표본 매칭률** — `bun transit fetch:realtime-sample`(Task 9에서 이미 받았으면 생략) → `bun transit report:match-rate`. 노선별 rate를 보고서에 옮긴다. 기대(연구 3장 기준): 1·3~9호선, 코레일 노선, 공항철도 일반, 우이신설은 높음; 2호선 본선은 끝 3자리 규칙으로 대부분; 신분당·GTX-A는 null. 기대와 크게 다른 노선은 원인(표본의 번호 예, 시간표의 번호 예)을 보고서에 적는다. 규칙을 고치려면 Task 10 테스트를 먼저 바꾼다.
- [ ] **Step 5: README** — "시간표 명령 순서", "수동 투입 파일(어디에 어떤 형식으로)", "매뉴얼 표(`timetable-sources.json`, `timetable-station-aliases.json`) 수정 규칙", "알려진 시간표 문제", "열차번호 규칙 표와 표본 매칭률", "토요일 복제 노선", "출처별 기준일".
- [ ] **Step 6: 전체 검사와 커밋** — 루트 `bun test`, 두 패키지 `tsc --noEmit`, 바꾼 파일 `biome check`. 커밋 `feat(transit-static): load real timetables and measure sample train number match rates`

---

## 완료 기준 (설계 13장 2단계)

- `timetable` current 배치에 출처가 있는 모든 노선의 trip·stop_time이 있고, error 등급 issue와 unresolved 역이 0이다.
- `linesWithoutTimetable`이 비어 있거나, 비어 있지 않다면 그 이유(키 없음, 수동 파일 없음)가 보고서와 README에 있다.
- `report:match-rate` 보고서가 있고 노선별 매칭률과 규칙 없는 노선(신분당, GTX-A)이 표시돼 있다.
- 매뉴얼 표 2개가 커밋돼 있고 README에 수정 절차가 있다.

## 범위 밖 (다음 계획)

- OA-22750 getTrainSch 비교 보고(§6.3 표의 "2호선 본선 보정"): 기준일(2025-06)이 서울교통공사 CSV(2026-09)보다 오래돼 보정 가치가 낮다. 2호선 매칭률이 낮게 나오면 후속 계획에서 다룬다.
- OA-101 역별 시간표 API로 CSV 신선도 교차 검증.
- "번호 변경 후보" 이벤트 표시(§6.4 2호선 성수), 관측 이벤트 모델과 수집기(§7, §8) — 4단계.
- 시간표 자동 갱신 스케줄(주 1회·월 1회)과 30일 경보(§6.3 갱신) — 6단계.
- 공휴일 달력(어느 날이 `holiday`인지): 지금은 요일만 본다. 수집기 단계에서 공휴일 표를 넣는다.
