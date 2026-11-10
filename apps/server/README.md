# server

Betro API와 실시간 수집기. Cloudflare Worker 하나(`betro-server`)에 Hono 앱과 Durable Object `Collector`가 함께 있다.

| 주소 | 내용 |
|---|---|
| `https://betro.cmu02-studio.com` | API: `/`(헬스 체크), `/api/auth/*`(better-auth), `/rpc/*`(oRPC), `/api-reference/*`, `/v1/snapshot/subway`, `/v1/snapshot/bus` |
| `https://betro-status.cmu02-studio.com` | 상태 페이지 `/`, `/status.json`, `POST /internal/collector/start`. Cloudflare Access 뒤에 있다 |

한 Worker가 요청의 호스트로 둘을 나눈다(`src/app.ts`). 상태 호스트가 아닌 요청은 모두 API로 본다.

| 자원 | 이름 |
|---|---|
| D1 | `betro` (바인딩 `DB`) |
| R2 | `betro-data` (바인딩 `DATA`, APAC). 수명 주기: `raw/` 30일, `events/` 365일 |
| Durable Object | 클래스 `Collector` (바인딩 `COLLECTOR`), 인스턴스 하나 |
| cron | 5분마다. 알림 판단, 사라진 alarm 다시 걸기 |

수집 로직은 `packages/realtime`에 있고(`packages/realtime/README.md`), `src/collector`는 그것을 Durable Object, D1, R2, FCM에 연결한다.

## 로컬 개발

```bash
cd apps/server
cp .dev.vars.example .dev.vars        # BETTER_AUTH_SECRET을 채운다 (openssl rand -base64 32)
bun run d1:migrate:local              # 로컬 D1 스키마
bun transit publish:d1                # (저장소 루트에서) 참조 데이터를 로컬 D1에 올림
bun run dev                           # wrangler dev, http://localhost:8787
```

- `.dev.vars`는 `UPSTREAM_MODE=fixture`로 둔다. 이 값이면 상류 API를 부르지 않고 `packages/realtime/src/__fixtures__`의 표본을 돌려준다. `wrangler.jsonc`의 `live`는 배포된 Worker에만 적용된다. 정확히 `live`일 때만 상류를 부른다.
- `bun run dev`는 `--infer-origin-from-routes=false`를 붙인다. 이 플래그가 없으면 wrangler가 Host 헤더를 첫 route로 바꿔 상태 호스트를 시험할 수 없다.
- 상태 호스트는 Host 헤더로 고른다.

```bash
curl -X POST -H 'Host: betro-status.cmu02-studio.com' localhost:8787/internal/collector/start
curl -H 'Host: betro-status.cmu02-studio.com' localhost:8787/status.json
```

## 테스트

```bash
bun test apps/server
bun run check-types
```

`src/collector/durable-object.ts`와 `cf-ports.ts`는 `cloudflare:workers`를 쓰므로 bun 테스트에서 import하지 않는다. 수집기 동작은 포트를 메모리 가짜로 바꾼 `core.test.ts`에서 확인한다.

## 설정

vars는 `wrangler.jsonc`, secret은 `wrangler secret put <NAME>`(로컬은 `.dev.vars`)에 둔다. 전체 목록과 설명은 `src/worker-env.ts`에 있다.

| secret | 내용 |
|---|---|
| `BETTER_AUTH_SECRET` | 운영용으로 따로 만든 값. `.dev.vars` 값과 다르다 |
| `SEOUL_OPEN_API_KEY` | 서울 열린데이터광장 키(지하철) |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 키(버스) |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase 서비스 계정 JSON. 없으면 알림은 로그로만 남는다 |
| `ALERT_FCM_TOKEN` | 알림을 받을 기기의 FCM 토큰. 앱을 다시 설치하면 바뀌므로 다시 넣는다 |

값은 화면에 찍지 않고 표준입력으로 넣는다. 키는 로그, R2 이력, 보고서, 상태 페이지, 응답 본문 어디에도 남기지 않는다.

| var | 기본값 | 내용 |
|---|---|---|
| `COLLECTOR_MODE` | `dev` | `dev`는 지하철 ALL과 버스 2개 노선, `prod`는 전체 |
| `UPSTREAM_MODE` | `fixture` | `live`일 때만 상류 호출 |
| `DAILY_BUDGET_SUBWAY`, `DAILY_BUDGET_BUS` | 900 | 소스별 하루 호출 예산 |
| `OPERATING_START_KST`, `OPERATING_END_KST` | `05:00`, `01:00` | 운행 시간 |
| `HISTORY_IDLE_FLUSH_MS` | 5000 | 다음 alarm까지 이 시간 이상 남으면 이력을 미리 R2에 쓴다 |

`HISTORY_IDLE_FLUSH_MS`는 10000보다 작아야 한다. Cloudflare는 요청이나 alarm 없이 10초가 지나면 Durable Object를 재우고 메모리를 비운다. 이력 버퍼는 메모리에 있으므로, 그 전에 쓰지 않으면 그 주기의 원본과 관측 이벤트가 사라진다. 이때도 예산과 지표는 저장되므로 호출 수와 멈춤 구간에는 드러나지 않고, 일일 보고서의 `history`에만 드러난다.

## 배포

순서를 지킨다. 스키마가 먼저, 참조 데이터가 그다음, Worker가 마지막이다.

```bash
# 1. D1 마이그레이션 (packages/db 마이그레이션이 바뀌었을 때)
cd packages/db && bun run db:d1-migrations          # d1-migrations/ 다시 생성
cd apps/server && bunx wrangler d1 migrations apply betro --remote

# 2. 참조 데이터 (현재 배치가 바뀌었을 때, 저장소 루트에서)
bun transit publish:d1 --dry-run
bun transit publish:d1 --remote

# 3. Worker
cd apps/server && bun run deploy
```

- 수집기는 5분마다 D1의 현재 배치를 확인하고, 바뀌었으면 참조를 다시 읽는다. 참조 데이터만 바꿀 때는 Worker를 다시 배포하지 않아도 된다.
- 배포하면 Durable Object가 다시 시작한다. 그날 호출 수, 스케줄, 최신 상태는 저장소에서 되살아나므로 수집은 이어진다.
- 되돌릴 때는 `bunx wrangler rollback`을 쓴다.

## 수집기 시작과 중지

- **시작**: 첫 배포 뒤 한 번만 `POST /internal/collector/start`를 부른다. 이미 돌고 있으면 그대로 둔다. 그 뒤로는 alarm이 스스로 이어지고, alarm이 사라지면 cron이 다시 건다.
- **중지**: 중지 엔드포인트는 없다. 호출을 멈추려면 `DAILY_BUDGET_SUBWAY`와 `DAILY_BUDGET_BUS`를 `0`으로 두고 배포한다.
- 운행 시간(05:00~01:00 KST) 밖에서는 상류를 부르지 않고 다음 05:00까지 쉰다.
- 상류가 401(`auth`)이나 하루 한도 초과(`quota-exhausted`)를 주면 그 소스는 그날(KST) 멈추고 다음 날 다시 시작한다.

## 상태 확인

상태 호스트는 Cloudflare Access 앱 "Betro status"로 막혀 있다. 허용된 이메일로 일회용 코드를 받아 로그인한다.

```bash
cloudflared access login https://betro-status.cmu02-studio.com
cloudflared access curl https://betro-status.cmu02-studio.com/status.json
cloudflared access curl -X POST https://betro-status.cmu02-studio.com/internal/collector/start
```

- 상태: 마지막 성공에서 5분이 지나면 "지연", 15분이 지나면 "멈춤"이다.
- 알림: "멈춤"이 되거나 401이 나면 FCM으로 보낸다. 같은 종류는 30분에 한 번, 회복하면 한 번 보낸다.
- 401로 그날 멈춘 소스는 상태 페이지에 따로 표시되지 않는다. `errorsToday.auth`로 확인한다.
- 로그: `cd apps/server && bunx wrangler tail betro-server`

## 이력과 일일 보고서 (R2)

| 키 | 내용 |
|---|---|
| `raw/<source>/<YYYY>/<MM>/<DD>/<HH>-<n>.ndjson.gz` | 상류 응답 원본. 한 줄에 요청(키는 `<key>`), 받은 시각, HTTP 상태, 본문 해시, 본문 |
| `events/<subway\|bus>/<YYYY>/<MM>/<DD>/<HH>-<n>.ndjson.gz` | 관측 이벤트 |
| `reports/<운행일>.json` | 일일 보고서: 호출 수, 오류 수, 멈춤 구간, 이력 줄 수, 노선별 평균 차량 수와 매칭률 |

날짜와 시각은 KST다. `<n>`은 그 시간 파일의 조각 번호다.

```bash
cd apps/server
bunx wrangler r2 object get betro-data/reports/2026-11-05.json --remote --file /tmp/report.json
bunx wrangler r2 bucket info betro-data          # 객체 수, 용량
```

보고서의 `history`는 원본(`raw`)과 이벤트(`events`)를 지하철·버스로 나눠 버퍼에 넣은 줄 수(`buffered`)와 R2에 쓴 줄 수(`written`)를 담는다. `written`이 `buffered`보다 작으면 그만큼 R2에 남지 않은 것이고 `ok`가 `false`가 된다. 줄 수는 오늘과 어제(KST) 것만 들고 있어서, 그보다 늦게 쓰는 보고서에는 `history: null`로 남고 이력으로는 판정하지 않는다.

R2에서 직접 확인하려면 객체 목록에서 그날 `raw/` 조각 수를 세어 보고서의 `calls`와 비교한다. `dev`에서는 호출 한 번이 조각 하나다.

## 비용 확인

`dev` 모드 하루 사용량(2026-11-05~09 측정):

| 항목 | 하루 |
|---|---|
| Worker 요청 | 약 300건(cron 288건 포함) |
| Durable Object 요청 | 약 2,100건(alarm 1,800, RPC 290) |
| Durable Object 실행 시간 | 약 4시간(약 1,900 GB-s) |
| Durable Object SQLite 쓰기 | 약 12,400행 |
| R2 쓰기(Class A) | 약 3,500건 |
| R2 용량 | `raw/` 약 165MB, `events/` 약 11MB |

- R2는 보관 기간이 다 차면 `raw/` 약 5.0GB(30일), `events/` 약 4.2GB(365일)가 된다. 무료 10GB에 가깝다.
- 사용량은 Cloudflare 대시보드의 Workers, Durable Objects, R2 지표에서 본다.
