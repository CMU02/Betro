# server

Betro API, 실시간 수집기, 출퇴근 세션 실행기. Cloudflare Worker 하나(`betro-server`)에 Hono 앱과 Durable Object `Collector`, `CommuteRunner`가 함께 있다.

| 주소 | 내용 |
|---|---|
| `https://betro.cmu02-studio.com` | API: `/`(헬스 체크), `/api/auth/*`(better-auth), `/rpc/*`(oRPC), `/api-reference/*`, `/v1/snapshot/subway`, `/v1/snapshot/bus`, `/v1/commute/*`와 `/v1/installs`·`/v1/push-tokens`(출퇴근 절) |
| `https://betro-status.cmu02-studio.com` | 상태 페이지 `/`, `/status.json`, `POST /internal/collector/start`. Cloudflare Access 뒤에 있다 |

한 Worker가 요청의 호스트로 둘을 나눈다(`src/app.ts`). 상태 호스트가 아닌 요청은 모두 API로 본다.

| 자원 | 이름 |
|---|---|
| D1 | `betro` (바인딩 `DB`) |
| R2 | `betro-data` (바인딩 `DATA`, APAC). 수명 주기: `raw/` 30일, `events/` 365일 |
| Durable Object | 클래스 `Collector` (바인딩 `COLLECTOR`), 인스턴스 하나 |
| Durable Object | 클래스 `CommuteRunner` (바인딩 `COMMUTE`), 인스턴스 하나(`commute-v1`, 아시아·태평양) |
| cron | 5분마다. 알림 판단, 사라진 alarm 다시 걸기(수집기·출퇴근 실행기), 공휴일 갱신, 출퇴근 일일 보고서 |

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
| `APNS_KEY_P8` | APNs 인증 키(.p8) PEM. 출퇴근 Live Activity 푸시용. 없으면 iOS 푸시는 보낼 수 없다 |

값은 화면에 찍지 않고 표준입력으로 넣는다. 키는 로그, R2 이력, 보고서, 상태 페이지, 응답 본문 어디에도 남기지 않는다.

| var | 기본값 | 내용 |
|---|---|---|
| `COLLECTOR_MODE` | `dev` | `dev`는 지하철 ALL과 버스 2개 노선, `prod`는 전체 |
| `UPSTREAM_MODE` | `fixture` | `live`일 때만 상류 호출 |
| `DAILY_BUDGET_SUBWAY`, `DAILY_BUDGET_BUS` | 900 | 소스별 하루 호출 예산 |
| `OPERATING_START_KST`, `OPERATING_END_KST` | `05:00`, `01:00` | 운행 시간 |
| `HISTORY_IDLE_FLUSH_MS` | 5000 | 다음 alarm까지 이 시간 이상 남으면 이력을 미리 R2에 쓴다 |
| `PUSH_MODE` | `send` | 출퇴근 푸시. `send`일 때만 APNs·FCM에 보내고, 그 밖의 값은 로그만 남긴다 |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` | `wrangler.jsonc` 참고 | APNs 키 ID, 팀 ID, 앱 번들 ID. 키가 아니라 식별자라 vars에 둔다 |
| `COMMUTE_*` | 코드의 기본값 | 출퇴근 실행기 설정. 아래 출퇴근 절 |

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

## 출퇴근

출퇴근 로직은 `packages/commute`에 있고(`packages/commute/README.md`), `src/commute`가 그것을 Durable Object `CommuteRunner`, D1, R2, APNs·FCM에 연결한다. 계획 문서: `docs/superpowers/plans/2026-11-10-mvp-2c-commute-server.md`.

### 라우트

모두 API 호스트(`betro.cmu02-studio.com`)에 있다. `POST /v1/installs`만 인증이 없고, 나머지는 `X-Betro-Install: <installId>`와 `Authorization: Bearer <설치 비밀값>`이 맞아야 한다. 모르는 설치와 틀린 비밀값은 구분하지 않고 둘 다 401이다. 서버에는 비밀값의 SHA-256 hex만 저장한다.

| 라우트 | 내용 |
|---|---|
| `POST /v1/installs` | 설치 등록. 본문 `{ installId, platform: "ios" \| "android", secretHash }`. 201, 같은 설치·같은 해시면 200, 해시가 다르면 409 |
| `PUT /v1/push-tokens` | 푸시 토큰 등록·갱신. `kind`는 `apns-start`, `apns-activity`, `fcm`. 204 |
| `PUT /v1/commute/plans/:planId` | 경로 계획 저장(`parsePlan` 검증). 위반하면 400과 `issues`(`schedule.days: …` 같은 경로 문자열), 설치당 16개를 넘으면 409, 다른 설치의 계획이면 404. 204 |
| `GET /v1/commute/plans` | 내 계획 목록 `{ plans }` |
| `DELETE /v1/commute/plans/:planId` | 계획 삭제. 204 |
| `DELETE /v1/installs/me` | 설치와 토큰·계획·세션 기록을 모두 삭제. 204 |
| `POST /v1/commute/sessions/:sessionId/input` | 본문 `{ kind: "boarded" \| "next" \| "end" }`. 없는 세션 404, 이미 끝난 세션 409, 성공 204 |
| `POST /v1/commute/sessions/:sessionId/ack` | 본문 `{ shownAt }`(앱이 값을 화면에 표시한 시각, epoch ms). 없는 세션 404, 성공 204 |
| `GET /v1/commute/sessions/active` | 진행 중인 세션 `{ session }`(없으면 `null`). `session`은 `{ sessionId, planId, content, routes }`이고 `routes`는 등록한 경로마다 하나(`rank` 오름차순)로 `{ rank, boardEtaEpoch, destinationEtaEpoch, etaState, positionState, stopsAway }`다. 시각은 초 단위, 기본 경로는 지금 구간·대안은 첫 구간 기준이며 추정이 아직 없으면 시각은 `null`, `etaState` `estimated`, `positionState` `none`. `Cache-Control: no-store` |

세션 라우트는 실행기가 연결돼 있지 않으면 503이다.

### 실행기

- alarm 하나가 돌며 `tick`을 부른다(기본 30초, `COMMUTE_TICK_MS`). 처음 alarm과 사라진 alarm은 cron의 `healthCheck`가 건다.
- 5분 cron이 아니라 tick이 예약 시작 시각을 확인한다. 시작 3분 창 안에 든 계획(요일, 공휴일 포함 여부 반영)마다 세션을 연다. 같은 계획·같은 서비스일에는 세션이 하나뿐이다(D1 고유 인덱스).
- 설정은 `COMMUTE_*` 환경 변수에서 읽고, 없거나 잘못된 값은 기본값으로 돌아간다. 이름과 기본값은 `packages/commute/src/config.ts`의 `commuteConfig`. 예: `COMMUTE_TICK_MS`, `COMMUTE_BUS_POLL_MS`, `COMMUTE_HEARTBEAT_MS`, `COMMUTE_DAILY_BUDGET_BUS_ARRIVAL`(버스 도착 API 하루 예산, 기본 900), `COMMUTE_SUBWAY_ETA_BIAS_SEC`(JSON). 예약을 확인할 시간대는 `COMMUTE_TIMEZONES`(쉼표로 구분, 기본 `Asia/Seoul`).
- 지하철은 수집기의 역별 도착 행을 받아 쓰고, 버스는 노선별 도착 API를 직접 부른다. 상류 401·429, 한도 초과가 나면 그날은 버스 호출을 멈춘다.
- 로컬 `.dev.vars`의 `UPSTREAM_MODE=fixture`에서는 상류를 부르지 않고 `packages/commute/src/__fixtures__`의 표본을 쓴다.

### 푸시 값

푸시(APNs `content-state`, FCM `data.state`)와 `GET /v1/commute/sessions/active`의 `content`는 같은 값 `ContentState` v1이다. 필드와 보낼지 판단은 스펙 5.3 "푸시 값 v1"과 `packages/commute/src/session/content.ts`가 원본이다.

- `nextLegs`(2026-11-11에 더함): 기본 경로에서 지금 구간 뒤에 남은 구간을 순서대로 담는다(최대 3개). 항목은 `{ mode, lineName, stopName, boardEtaEpoch, etaState }`이고 `stopName`은 그 구간의 승차 정류장(역), `boardEtaEpoch`는 그 구간 추정의 승차 예상(초, 내림, 없으면 `null`)이다. 마지막 구간이거나 `arrived`·`ended`면 `[]`다. 서버는 키를 늘 보낸다.
- `v`는 1 그대로다. 옛 앱은 `nextLegs`를 무시하고, 새 앱은 키가 없는 옛 서버의 값을 `[]`로 읽는다. 배포 전에 실행기에 저장된 마지막 값에 키가 없어도 `decideSend`는 `[]`로 본다.
- 보낼지 판단: `nextLegs`의 길이나 어느 항목의 `lineName`이 바뀌면 높은 우선순위(10), 어느 항목의 `boardEtaEpoch` 분이나 `etaState`가 바뀌면 낮은 우선순위(5).

### 푸시 모드 (`PUSH_MODE`)

- `log`: APNs·FCM을 부르지 않고 `push (log) <이벤트> host=<호스트>` 줄만 남긴다. 보낸 것으로 치고 상태 200을 돌려받은 것처럼 이어간다. 로컬 `.dev.vars`의 값이고, 변수가 없을 때의 기본값이다.
- `send`: iOS는 APNs(`apns-start` 토큰으로 Live Activity 시작, `apns-activity` 토큰으로 갱신·종료), Android는 FCM으로 보낸다. 세션의 플랫폼은 설치가 가진 토큰으로 정한다(`apns-start`가 있으면 iOS, 아니면 `fcm`이 있으면 Android, 둘 다 없으면 `no-token`으로 닫는다).
- 배포된 Worker는 `send`다(`wrangler.jsonc`의 vars). `APNS_KEY_P8`와 `FCM_SERVICE_ACCOUNT_JSON` secret이 있어야 한다.

### 실행기 상태 보는 법

실행기에는 상태 엔드포인트가 없다. 로그와 D1, R2로 본다.

```bash
cd apps/server
bunx wrangler tail betro-server                   # 로그(키는 가려서 나온다)
bunx wrangler d1 execute betro --remote --command \
  "SELECT id, plan_id, service_date, status, end_reason, started_at, ended_at FROM commute_session ORDER BY started_at DESC LIMIT 10"
```

로그 줄은 `commute`로 시작한다.

| 로그 | 뜻 |
|---|---|
| `commute runner core push=<모드> upstream=<모드>` | 실행기가 뜰 때 한 번. 지금 푸시·상류 모드 |
| `commute runner alarm missing, arming` | cron이 사라진 alarm을 다시 걸었다 |
| `commute start session=<id> plan=<id> platform=<ios\|android\|none>` | 세션 시작 |
| `commute push <이벤트> session=<id> via=… status=<HTTP 상태> outcome=…` | 푸시 한 번. 토큰은 앞 몇 글자만 나온다 |
| `commute end session=<id> reason=<arrived\|user\|timeout\|no-token\|plan-removed\|push-rejected>` | 세션 종료 |
| `commute session=<id> update rejected <n> times, closing` | 갱신이 설정 오류로 상한(3번)만큼 거절돼 세션을 닫는다 |
| `commute records session=<id> written …` | 정확도 기록·요약을 R2에 썼다 |
| `commute report commute/reports/<날짜>.json written sessions=<n>` | 일일 보고서를 썼다 |
| `… failed: …` | 단계 실패. 한 세션이 실패해도 다른 세션은 계속 돈다 |

- `commute_session.status`는 `active` 또는 `ended`. `end_reason`은 위 종료 이유다.
- 보낸 푸시가 `token-dead`로 끝나면 해당 토큰(FCM `UNREGISTERED`면 설치 전체)을 지운다.
- `retry`(429·5xx)는 받지 않은 것이 확실하니 다음 tick에 다시 보낸다. 요청이 예외나 10초 타임아웃으로 끝나면 `outcome=unconfirmed`다(상대가 받았는지 모른다). iOS 시작이 `unconfirmed`면 Live Activity가 둘 생기지 않게 다시 보내지 않고, 정상 시작처럼 업데이트 토큰을 기다린다(안 오면 갱신 불가). Android 시작과 갱신은 다음 tick에 다시 보낸다.
- `config`(토큰이 아닌 400·403, 예: `TopicDisallowed`, FCM 403)는 다시 보내도 같다. 시작이 `config`면 바로 `push-rejected`로 닫고(다음 날 다시 시도된다), 갱신은 세션당 3번 거절되면 종료를 한 번 보내고 `push-rejected`로 닫는다. 종료 푸시는 원래 세션당 한 번이다. 새로 만든 APNs JWT·FCM 액세스 토큰으로 다시 보내도 인증 오류면 `config`로 본다.

### 기록 위치

| 위치 | 내용 |
|---|---|
| D1 `install`, `push_token`, `commute_plan`, `commute_session`, `holiday` | 설치, 토큰, 계획, 세션 목록, 공휴일 |
| R2 `commute/records/<서비스일>/<세션ID>.ndjson.gz` | 세션의 정확도 기록(예측, 도착, 입력, 제안, 푸시 전송, 시작·종료) |
| R2 `commute/summaries/<서비스일>/<세션ID>.json` | 세션 요약(예측 오차, 시작 지연, 최대 전송 간격, 제안 판정, 종료 이유) |
| R2 `commute/reports/<서비스일>.json` | 출퇴근 일일 보고서. 서비스일 다음 날 04:00(KST) 이후 cron이 한 번 쓴다 |
| 실행기 SQLite | 진행 중인 세션, 역·버스 직전 값, 버스 도착 호출 수 같은 내부 상태. 밖에서 직접 읽는 엔드포인트는 없다 |

- 기록에는 설치 ID, 푸시 토큰, 키가 들어가지 않는다. 세션 ID, 경로 ID, 교통 데이터만 있다.
- 제안을 보낸 세션은 제안한 차량의 실제 도착을 보려고 요약을 종료 뒤 최대 30분 늦게 쓴다.
- 공휴일은 cron이 24시간에 한 번 공공데이터포털(`DATA_GO_KR_API_KEY`)에서 올해와 내년 것을 받아 `holiday`에 둔다. `UPSTREAM_MODE`가 `live`가 아니거나 키가 비어 있으면 받지 않고, 고정 목록(`KOREAN_PUBLIC_HOLIDAYS`)만 쓴다.

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
