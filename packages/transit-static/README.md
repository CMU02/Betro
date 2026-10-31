# @Betro/transit-static

서울 지하철 역 크로스워크와 OSM 선로 모양(정적 참조 데이터)을 수집하고 DB에 적재하는 패키지.

- CLI: 저장소 루트에서 `bun transit <command>`
- 데이터 디렉터리: `BETRO_DATA_DIR` (기본 `<repo>/data`). 받은 원본은 `data/raw/<source>/`에 그대로 보관한다.
- 서울 열린데이터광장 키: 환경 변수 `SEOUL_OPEN_API_KEY` (코드와 저장소에 넣지 않는다).
- 적재 DB: `DATABASE_URL` (없으면 저장소 루트의 `local.db`). 적재 전에 `packages/db`에서 `bun run db:migrate`로 스키마를 맞춘다.
- 선로 데이터 출처: © OpenStreetMap contributors (ODbL)

## 인증키 발급

역사마스터(OA-21232)와 역 검색(OA-121)은 서울 열린데이터광장 일반 인증키가 필요하다. 실시간도착_역정보 xlsx(OA-12764)와 OSM은 키가 없어도 된다.

1. [서울 열린데이터광장](https://data.seoul.go.kr)에 로그인한다.
2. 마이페이지 → 인증키 관리에서 일반 인증키를 발급받는다.
3. 셸 환경 변수로 설정한다. 예: `export SEOUL_OPEN_API_KEY=...` (`.env` 파일을 쓰면 커밋하지 않는다).

## 역 대응표 명령 순서

```bash
bun transit fetch:station-xlsx [--seq 57]   # 실시간도착_역정보 xlsx (키 불필요)
bun transit fetch:station-master            # 역사마스터, 키 필요
bun transit fetch:station-search            # 역명별 OA-121 검색, 키 필요. 하루 1,000건 한도. 중단되면 다시 실행하면 이어서 받는다
bun transit build:crosswalk --dry-run       # 대응표를 만들고 보고서만 쓴다
bun transit build:crosswalk                 # 검증을 통과하면 DB에 적재한다
```

- 원본이 없으면 `build:crosswalk`는 먼저 돌릴 fetch 명령을 알려주고 실패한다.
- 매칭 안 된 역, 매뉴얼 표에 없는 노선 문자열이 하나라도 있으면 실패(exit 1)하고 적재하지 않는다. OA-121 코드가 없는 역은 경고만 한다.
- 적재는 한 트랜잭션으로 `reference_batch(kind="station_crosswalk")`를 새로 만들고 그 배치를 현재 배치(`is_current`)로 바꾼다. 이전 배치는 남아 있어 되돌릴 수 있다.
- 원본 해시와 매뉴얼 표 내용이 현재 배치와 같으면 다시 적재하지 않는다.
- xlsx 판이 둘 이상 있으면 가장 큰 seq를 쓰고, 바로 이전 판과의 차이(추가·삭제·개명)를 보고서에 적는다.

## 보고서

`data/reports/<job>/<YYYYMMDDTHHmmss>.json|.md` (시각은 UTC). 대응표는 `data/reports/build-crosswalk/`에 쓴다.

- `.md`: 사람이 읽는 보고서. 매칭 수(`매칭 N / M`), 매칭 방법별 건수, 공용역(auto-shared) 검토 목록, 미매칭 역, 매핑 안 된 노선 문자열, 범위 밖 노선, 코드 없는 역, 판 차이, 원본 manifest(파일명과 sha256).
- `.json`: 같은 내용의 요약. 다른 도구에서 읽는 용도.

## 매뉴얼 표 (`src/manual/`)

코드 저장소에 두고 **리뷰를 거쳐서만** 바꾼다. 바꿀 때는 `build:crosswalk --dry-run` 보고서를 PR에 붙여 무엇이 달라지는지 보인다.

- `source-line-names.json`
  - `stationMasterRoute`: 역사마스터 `ROUTE` 문자열 → lineKey
  - `stationSearchLineNum`: OA-121 `LINE_NUM` 문자열 → lineKey
  - `ignoredRoutes`: 범위 밖 노선 문자열(인천1호선, 김포골드라인 등). 매핑하지 않고 "범위 밖"으로 보고서에만 남긴다. 두 출처에 같은 목록을 쓴다.
  - 값은 `src/lines.ts`의 19개 lineKey 중 하나여야 한다. 1호선 구간명(경부선, 경인선, 경원선 등)과 2호선 지선은 각각 `line1`, `line2`로 보낸다.
- `station-aliases.json`: `{ "statnId": "...", "masterName": "..." }` 배열. 이름이 달라 자동으로 못 맞춘 역에만 넣는다. `statnId`는 xlsx의 10자리 문자열 그대로 쓴다.
