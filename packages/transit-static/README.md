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

## 선로 모양 명령 순서

선로 모양은 OSM에서만 가져온다(© OpenStreetMap contributors, ODbL). 다른 출처의 선로 데이터와 섞지 않는다.

```bash
bun transit osm:discover                    # 수도권 route relation 목록을 보고서로 쓴다 (키 불필요)
# 보고서를 보고 src/manual/osm-routes.json을 채운다 (아래 "매뉴얼 표" 참고)
bun transit fetch:osm                       # osm-routes.json의 relation과 멤버를 data/raw/osm/routes.json으로 받는다
bun transit build:tracks --dry-run          # 선로를 조립하고 보고서만 쓴다
bun transit build:tracks                    # 검증을 통과하면 DB에 적재한다
```

- `build:tracks`는 `data/raw/osm/routes.json`, `src/manual/osm-routes.json`, DB의 현재 `station_crosswalk` 배치를 읽는다. 대응표를 먼저 적재해야 한다(`--dry-run`이어도 DB를 읽는다).
- relation마다 way를 한 줄로 잇고(끝점이 1m 넘게 떨어지면 gap으로 실패), 같은 노선의 crosswalk 역을 선에 투영한다. 선에서 150m 안의 역만 그 선 위의 역으로 보고, 80m를 넘으면 경고한다.
- 다음 중 하나라도 있으면 실패(exit 1)하고 적재하지 않는다: stitch 실패(relation 없음, gap, 노드 없음), error 수준 검증 결과(OSM 정차 순서와 투영 순서가 다름, 선 위 역이 2개 미만), 자기 노선의 어떤 shape에도 올라가지 않은 역(미커버 역), crosswalk에 역이 있는데 shape가 없는 노선.
- 적재는 한 트랜잭션으로 `reference_batch(kind="track")`를 새로 만들고 `track_shape`, `track_station`을 넣은 뒤 현재 배치로 바꾼다. OSM 원본, osm-routes.json, 현재 대응표 내용의 해시가 현재 배치와 같으면 다시 적재하지 않는다.

## 보고서

`data/reports/<job>/<YYYYMMDDTHHmmss>.json|.md` (시각은 UTC). 대응표는 `data/reports/build-crosswalk/`, 선로는 `data/reports/build-tracks/`에 쓴다.

- `.md`: 사람이 읽는 보고서. 매칭 수(`매칭 N / M`), 매칭 방법별 건수, 공용역(auto-shared) 검토 목록, 미매칭 역, 매핑 안 된 노선 문자열, 범위 밖 노선, 코드 없는 역, 판 차이, 원본 manifest(파일명과 sha256).
- `.json`: 같은 내용의 요약. 다른 도구에서 읽는 용도.
- 선로 `.md`: 노선별 shape 수, shape마다 길이·역 수·warn 수, error 목록, stitch 실패, shape 없는 노선, 미커버 역(가장 가까운 선로까지 거리), 선로 투영 경고(`station-offset`, `short-gap`, `long-gap`), OSM stop 미매칭(`unmatched-osm-stop`). 경고는 사람이 훑어보고, OSM 오류로 판단되면 아래 "알려진 OSM 문제"에 적는다.

## 매뉴얼 표 (`src/manual/`)

코드 저장소에 두고 **리뷰를 거쳐서만** 바꾼다. 바꿀 때는 `build:crosswalk --dry-run` 보고서를 PR에 붙여 무엇이 달라지는지 보인다.

- `source-line-names.json`
  - `stationMasterRoute`: 역사마스터 `ROUTE` 문자열 → lineKey
  - `stationSearchLineNum`: OA-121 `LINE_NUM` 문자열 → lineKey
  - `ignoredRoutes`: 범위 밖 노선 문자열(인천1호선, 김포골드라인 등). 매핑하지 않고 "범위 밖"으로 보고서에만 남긴다. 두 출처에 같은 목록을 쓴다.
  - 값은 `src/lines.ts`의 19개 lineKey 중 하나여야 한다. 1호선 구간명(경부선, 경인선, 경원선 등)과 2호선 지선은 각각 `line1`, `line2`로 보낸다.
- `station-aliases.json`: `{ "statnId": "...", "masterName": "..." }` 배열. 이름이 달라 자동으로 못 맞춘 역에만 넣는다. `statnId`는 xlsx의 10자리 문자열 그대로 쓴다.
- `osm-routes.json`: `{ "lineKey", "branchKey", "direction", "osmRelationId", "note"? }` 배열. 노선·갈래·방향마다 OSM route relation 하나.
  - 고르는 기준: `route=subway|train|light_rail`이고 route_master가 해당 노선인 relation. 실시간 역을 전부 덮는 것이 목표이므로 미커버 역이 사라질 때까지 갈래를 더한다(1호선 `gyeongbu`·`gyeongin`·`gyeongwon` 등, 5호선 `main`·`macheon`, 2호선 성수·신정지선 등).
  - `direction`: `up`은 실시간 API `updnLine=0`, `down`은 `1`. 2호선은 내선=`up`, 외선=`down`. relation의 `from`/`to` 태그로 판단하고 근거를 `note`에 적는다.
  - 같은 relation id를 두 번 넣지 않는다(`track_shape`는 배치 안에서 relation id가 유일하다).
  - 수정 절차: `bun transit osm:discover` 보고서로 relation을 고른다 → `bun transit fetch:osm` → `bun transit build:tracks --dry-run` 보고서를 보고 stitch 실패나 미커버 역이 없어질 때까지 반복한다. gap이 나면 다른 relation 변형을 고르거나 두 갈래로 나눠 등록한다. PR에 `build:tracks --dry-run` 보고서를 붙인다.

## 알려진 OSM 문제

OSM 데이터 자체의 오류로 갈래를 빼거나 경고를 남겨 둔 경우 relation id와 증상을 적는다. 갈래를 빼서 생긴 미커버 역은 보고서에 그대로 드러나므로 숨길 수 없다.

- (아직 없음)
