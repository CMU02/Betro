# @Betro/realtime

실시간 수집기의 순수 로직. 상류 응답 파싱, 정규화, 최신 상태, 호출 스케줄과 예산, 이력 버퍼, 지표·일일 보고서·알림 판단을 담는다.

- Cloudflare API에 의존하지 않는다. 시계, 저장소, R2, fetch는 모두 인자로 받는다. 그래서 `bun test`로 전부 테스트한다.
- 이 패키지를 Durable Object에 연결하는 코드는 `apps/server/src/collector`에 있다(`apps/server/README.md`).
- 설계: `docs/superpowers/specs/2026-11-04-phase4-realtime-collector-design.md`

## 모듈 지도

| 파일 | 하는 일 |
|---|---|
| `time.ts` | KST 날짜·시각 분해, 운행 시간 판정(`isOperatingTime`), 서비스일(`serviceDayAt`) |
| `holidays.ts` | 시간표 요일 구분에 쓰는 공휴일 |
| `upstream/urls.ts` | 상류 URL 만들기와 키 가리기(`redactKeys`) |
| `upstream/subway-arrival.ts` | 지하철 `realtimeStationArrival/ALL` 봉투·행 파서 |
| `upstream/bus-position.ts` | 버스 `getBusPosByRtid` 봉투·행 파서 |
| `upstream/classify.ts` | 응답을 결과 종류(`UpstreamOutcome`)로 분류 |
| `reference.ts` | 정규화에 쓰는 참조(역 대응표, 선로, 시간표, 버스 노선 구간)의 메모리 구조 |
| `subway/reduce-arrivals.ts` | ALL 응답의 역별 도착 행을 열차 하나당 한 줄로 줄임 |
| `subway/normalize.ts` | 열차를 관측으로 정규화(역·선로 거리, 시간표 매칭, 플래그) |
| `bus/normalize.ts` | 버스 위치를 노선 구간 위 거리로 정규화 |
| `observation.ts` | 관측 이벤트 타입 |
| `state.ts` | 차량별 최신 상태, 변화 감지, 스냅샷, TTL(지하철·버스 5분) |
| `budget.ts` | KST 하루 단위 호출 예산 |
| `schedule.ts` | `dev`/`prod` 설정과 `planTick`(지금 부를 소스와 다음 alarm 시각) |
| `history.ts` | 시간 단위 gzip NDJSON 버퍼(`raw/`, `events/`), 본문 중복 제거, 이력 줄 수 요약(`summarizeHistory`) |
| `metrics.ts` | 5분 지표, 상태 페이지 값(`buildStatus`), 일일 보고서 |
| `alerts.ts` | 알림 판단(멈춤, 키 오류, 회복)과 FCM 요청 만들기 |

## 규칙

- **키를 남기지 않는다.** 상류 URL, 응답 본문, 오류 문구를 기록하기 전에 `redactKeys`를 거친다. 키 원문과 `encodeURIComponent(key)` 둘 다 지운다.
- **관측을 버리지 않는다.** 품질 문제는 `qualityFlags`에 남긴다.
- **시각**은 내부에서 UTC epoch ms로 다루고, 원본 KST 문자열(`recptnDt`, `dataTm`)도 `sourceAtRaw`에 보존한다. 거리는 m, 좌표는 WGS84 `[lng, lat]`.
- **예산은 KST 00:00에 초기화**되고 운행은 01:00까지 이어진다. 00:00~01:00의 호출은 새 날 예산을 쓰고, 열차 매칭은 전날 서비스일 시간표로 한다.
- **재시도도 예산 1건**이다.
- **원천이 잠깐 비어도 최신 상태를 통째로 비우지 않는다.** 사라진 차량은 TTL 동안 유지하고 스냅샷에 `staleSince`를 붙인다.

## 모드와 설정

`devConfig`/`prodConfig`(`schedule.ts`)가 환경 변수에서 설정을 만든다.

| 항목 | `dev` | `prod` |
|---|---|---|
| 지하철 | `realtimeStationArrival/ALL` 한 번으로 전 노선, 최소 간격 80초 | 노선별 위치 API, 최소 간격 20초 |
| 버스 | 6411(`100100290`), 150(`100100029`)을 번갈아, 노선당 최소 간격 160초 | D1 현재 배치의 전 노선, 최소 간격 30초, 초당 호출 상한 |

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `DAILY_BUDGET_SUBWAY`, `DAILY_BUDGET_BUS` | 900 | 소스별 하루 호출 예산 |
| `OPERATING_START_KST`, `OPERATING_END_KST` | `05:00`, `01:00` | 운행 시간 |
| `BUS_REQUESTS_PER_SECOND` | 10 | `prod` 버스 초당 호출 상한 |

호출 간격은 남은 예산을 남은 운행 시간에 고르게 편 값과 최소 간격 중 큰 쪽이다. `dev` 기본값(900건, 운행 20시간)에서는 지하철 80초, 버스 노선당 160초로 예산이 딱 맞는다. 재시도로 예산을 더 쓰면 그날 남은 시간의 간격이 늘어난다.

## 결과 종류와 처리

`classify.ts`의 `UpstreamOutcome`:

| 결과 | 처리 |
|---|---|
| `ok`, `no-data`, `service-ended` | 성공으로 센다. `service-ended`(버스 headerCd 8)는 10분 뒤 다시 확인 |
| `network`, `temporary`, `rate-limited` | 1초, 2초 뒤 최대 2번 재시도 |
| `auth`, `quota-exhausted` | 그 소스를 그날(KST) 멈춤. `auth`는 "키 오류" 알림 |
| `request-error` | 재시도하지 않고 오류로 센다 |

## 품질 플래그

- 지하철: `invalid-source-time`, `future-source-time`(원천 시각이 미래, `sourceAt=null`), `stale-source`, `unknown-direction`, `unknown-station`, `no-track-station`, `conflicting-rows`, `missing-prev-station`, `position-unknown`
- 버스: `unknown-route`, `unknown-segment`, `zero-full-sect`, `sect-dist-over`, `distance-mismatch`, `bad-source-time`, `backwards`, `time-backwards`(원천 시각 역행)

플래그가 붙는 정확한 조건은 `subway/normalize.ts`, `subway/reduce-arrivals.ts`, `bus/normalize.ts`에 있다. 지하철 관측의 시간표 매칭 결과는 `matchStatus`(`matched`, `no-timetable`, `ambiguous`)에 따로 둔다.

## 상태 기준값

| 상수 | 값 | 뜻 |
|---|---|---|
| `DELAYED_AFTER_MS` | 5분 | 마지막 성공 뒤 "지연" |
| `STALLED_AFTER_MS` | 15분 | 마지막 성공 뒤 "멈춤" |
| `METRICS_BUCKET_MS`, `METRICS_RETENTION_DAYS` | 5분, 7일 | 지표 단위와 보관 기간 |
| `ALERT_REPEAT_MS` | 30분 | 같은 종류 알림을 다시 보내는 간격 |
| `HISTORY_FLUSH_BYTES`, `HISTORY_FLUSH_MS` | 8MB, 5분 | 이력 버퍼를 R2에 쓰는 크기·시간 기준 |

## 테스트

```bash
bun test packages/realtime
```

표본은 `src/__fixtures__/`에 있다(지하철 ALL, 2·7호선 위치, 버스 6411·150, 참조 표본). 테스트는 상류를 부르지 않는다.
