# @Betro/transit-static

서울 지하철 역 크로스워크, OSM 선로 모양, 시간표(정적 참조 데이터)를 수집하고 DB에 적재하는 패키지.

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
bun transit fetch:station-search            # 역명별 OA-121 검색, 키 필요. 호출 횟수 제한 없음(1회 최대 1,000건). 중단되면 다시 실행하면 이어서 받는다
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
- `build:tracks` 전에 `packages/db` 마이그레이션(`bun run db:migrate`)을 먼저 적용한다. `track_station.anchor`는 기본값 없는 NOT NULL 컬럼이라, track 행이 생기기 전에 마이그레이션이 돌아야 한다.
- relation마다 way를 한 줄로 잇고(끝점이 1m 넘게 떨어지면 gap으로 실패), 같은 노선의 crosswalk 역을 선 위에 놓는다. 닫힌 선(2호선 본선 고리)은 relation의 첫 정차 노드에서 시작하도록 돌린다.
- 역 배치 우선순위(`track_station.anchor`에 남는다):
  1. `osm-stop`: relation 정차 노드(이름·별칭 → ref 순으로 매칭)가 선 위 노드면 그 노드의 누적 거리. 정차 노드를 relation 순서대로 보며, 같은 노드를 두 번 지나면 앞 역 이후 첫 등장을 쓴다. 역사마스터 좌표와 2000m 넘게 떨어지면 오매칭으로 버린다(`stop-anchor-rejected`).
  2. `osm-stop-projected`: 정차 노드가 선 밖(승강장 노드 등)이면 그 노드를 선에 투영해 150m 이내일 때 그 위치.
  3. `station-master`: 정차 노드가 없거나 위 둘이 안 되면 역사마스터 좌표를 투영해 150m 이내일 때 그 위치.
- `offsetM`은 역사마스터 좌표에서 역을 놓은 지점까지의 거리이고 80m를 넘으면 `station-offset` 경고를 낸다. `osm-stop`이면 선로 방향 차이(승강장 중심과 역사 좌표)까지 포함하므로 150~300m도 흔하다.
- 정차 노드 매칭은 이름(정규화한 `nameCanonical`·`nameAliases`)이 먼저이고, 이름으로 못 찾을 때만 `ref` = `frCode`를 쓴다. 노드 이름이 같은 노선의 다른 역을 가리키는데 ref만 이 역의 frCode이면 그 ref 매칭은 버린다. 이름으로 맞은 노드의 ref가 그 역의 frCode를 담고 있지 않을 때도 노드는 쓰되 같은 경고를 낸다. 두 경우 모두 `stop-ref-conflict`(노드당 한 번)다. frCode 비교는 `;`로 나눈 여러 값과 앞자리 0 차이(`D08` = `D8`)를 같은 것으로 본다.
- 다음 중 하나라도 있으면 실패(exit 1)하고 적재하지 않는다: stitch 실패(relation 없음, gap, 노드 없음), error 수준 검증 결과(OSM 정차 순서와 투영 순서가 다름, 선 위 역이 2개 미만), 자기 노선의 어떤 shape에도 올라가지 않은 역(미커버 역), crosswalk에 역이 있는데 shape가 없는 노선.
- 적재는 한 트랜잭션으로 `reference_batch(kind="track")`를 새로 만들고 `track_shape`, `track_station`을 넣은 뒤 현재 배치로 바꾼다. OSM 원본, osm-routes.json, 현재 대응표 내용의 해시가 현재 배치와 같으면 다시 적재하지 않는다. manifest에는 로직 버전(track `placementVersion` = `TRACK_PLACEMENT_VERSION`, 대응표 `matchVersion` = `CROSSWALK_MATCH_VERSION`)도 들어가므로, 배치·매칭 결과가 달라지는 코드를 고칠 때 그 상수를 올리면 다음 실행에서 다시 적재된다.

## 보고서

`data/reports/<job>/<YYYYMMDDTHHmmss>.json|.md` (시각은 UTC). 대응표는 `data/reports/build-crosswalk/`, 선로는 `data/reports/build-tracks/`, 시간표는 `data/reports/build-timetable/`, 열차번호 매칭률은 `data/reports/match-rate/`에 쓴다.

- `.md`: 사람이 읽는 보고서. 매칭 수(`매칭 N / M`), 매칭 방법별 건수, 공용역(auto-shared) 검토 목록, 미매칭 역, 매핑 안 된 노선 문자열, 범위 밖 노선, 코드 없는 역, 판 차이, 원본 manifest(파일명과 sha256).
- `.json`: 같은 내용의 요약. 다른 도구에서 읽는 용도.
- 선로 `.md`: 노선별 shape 수, shape마다 길이·역 수·배치 방식별 역 수(osm-stop / projected / master)·warn 수, error 목록, stitch 실패, shape 없는 노선, 미커버 역(가장 가까운 선로까지 거리), 버린 정차 노드(`stop-anchor-rejected`), 정차 노드 ref 충돌(`stop-ref-conflict`), 선로 투영 경고(`station-offset`, `short-gap`, `long-gap`), OSM stop 미매칭(`unmatched-osm-stop`). `.json`은 shape마다 `anchors` 집계와 `stopAnchorRejected` 목록을 담는다. 경고는 사람이 훑어보고, OSM 오류로 판단되면 아래 "알려진 OSM 문제"에 적는다.

## 매뉴얼 표 (`src/manual/`)

코드 저장소에 두고 **리뷰를 거쳐서만** 바꾼다. 바꿀 때는 `build:crosswalk --dry-run` 보고서를 PR에 붙여 무엇이 달라지는지 보인다.

- `source-line-names.json`
  - `stationMasterRoute`: 역사마스터 `ROUTE` 문자열 → lineKey
  - `stationSearchLineNum`: OA-121 `LINE_NUM` 문자열 → lineKey
  - `ignoredRoutes`: 범위 밖 노선 문자열(인천1호선, 김포골드라인 등). 매핑하지 않고 "범위 밖"으로 보고서에만 남긴다. 두 출처에 같은 목록을 쓴다.
  - 값은 `src/lines.ts`의 19개 lineKey 중 하나여야 한다. 1호선 구간명(경부선, 경인선, 경원선 등)과 2호선 지선은 각각 `line1`, `line2`로 보낸다.
  - 현재 내용(xlsx seq57 기준): 역사마스터 ROUTE 34개, OA-121 LINE_NUM 19개를 매핑했다. 역사마스터 `경원선`은 경의중앙선 용산~청량리 역도 담고 있지만 `line1`로 보내며, 그 역들은 공용역(auto-shared)으로 맞춰진다. `ignoredRoutes`: 인천1호선·인천선, 인천2호선, 김포골드라인·김포도시철도, 에버라인선·용인경전철, 의정부선·의정부경전철.
- `station-aliases.json`: `{ "statnId": "...", "masterName": "..." }` 배열. 이름이 달라 자동으로 못 맞춘 역에만 넣는다. `statnId`는 xlsx의 10자리 문자열 그대로 쓴다.
  - 현재 5건: 응암순환(상선)→응암, 운정중앙→운정, 한국항공대→화전, 세종왕릉→세종대왕릉, 시우→원곡.
- `osm-routes.json`: `{ "lineKey", "branchKey", "direction", "osmRelationId", "note"? }` 배열. 노선·갈래·방향마다 OSM route relation 하나.
  - 고르는 기준: `route=subway|train|light_rail`이고 route_master가 해당 노선인 relation. 실시간 역을 전부 덮는 것이 목표이므로 미커버 역이 사라질 때까지 갈래를 더한다(1호선 `gyeongbu`·`gyeongin`·`gyeongwon` 등, 5호선 `main`·`macheon`, 2호선 성수·신정지선 등).
  - `direction`: `up`은 실시간 API `updnLine=0`, `down`은 `1`. 2호선은 내선=`up`, 외선=`down`. relation의 `from`/`to` 태그로 판단하고 근거를 `note`에 적는다.
  - 같은 relation id를 두 번 넣지 않는다(`track_shape`는 배치 안에서 relation id가 유일하다).
  - 수정 절차: `bun transit osm:discover` 보고서로 relation을 고른다 → `bun transit fetch:osm` → `bun transit build:tracks --dry-run` 보고서를 보고 stitch 실패나 미커버 역이 없어질 때까지 반복한다. gap이 나면 다른 relation 변형을 고르거나 두 갈래로 나눠 등록한다. PR에 `build:tracks --dry-run` 보고서를 붙인다.

## 알려진 OSM 문제

OSM 데이터 자체의 오류로 갈래를 빼거나 경고를 남겨 둔 경우 relation id와 증상을 적는다. 갈래를 빼서 생긴 미커버 역은 보고서에 그대로 드러나므로 숨길 수 없다.

- `12623856` (경의·중앙선: 지평 → 문산): 멤버가 불완전해 실제 선은 지평~원덕 13.6km뿐이다. 용문~지평을 덮으려고 `jipyeong` 갈래로 넣었다. relation이 문산 방면이므로 `direction`은 `up`이다. `12623857`(문산 → 지평)은 용문~지평 way가 없어 쓰지 않는다.
- `7919018`, `2718901` (8호선): 모란·암사역사공원 정차 노드의 `ref`가 한 칸 밀려 있다(모란 노드 ref=826은 수진, 암사역사공원 노드 ref=808은 장자호수공원의 코드). 이름이 우선이라 두 노드는 자기 역에 쓰이고, 밀린 ref는 `stop-ref-conflict`로 보고된다.
- 정차 노드 `ref`가 frCode 체계와 다른 relation이 많다(경의중앙 `5993211` 등의 `1`·`2`·`3` 승강장 번호, 우이신설 `L01`~`L10` vs `941`~`950`, 경춘 중랑 `K119` vs `P119`, 광운대 `119` vs `P116`, 공항철도 마곡나루 `A041` vs `A042` 등). 매칭은 이름으로 되므로 영향은 없고 `stop-ref-conflict` 정보성 경고만 난다.
- `7533583`, `7533582` (우이신설선): stop 노드 287323400, 9459739653에 name 태그가 없어 `unmatched-osm-stop` 경고가 난다. `7533582`에는 `삼양` 이름·ref L06인 정차 노드가 둘 있고 하나는 역에서 674m 떨어져 있다(삼양사거리 위치로 보인다). 가까운 노드가 relation에서 먼저 나와 그쪽이 쓰이고, 삼양사거리는 역사마스터 좌표로 놓인다.
- `12746498`, `12746493` (7호선): 정차 노드 이름이 `이수`, `자양`이라 crosswalk 이름(총신대입구, 뚝섬유원지)과 맞지 않아 `unmatched-osm-stop` 경고가 난다. 두 역은 역사마스터 좌표로 놓인다.
- `14138331`, `14181832` (1호선 경부선): OSM 정차 노드 이름은 `평택지제`이고 crosswalk 이름은 `지제`라 이름이 맞지 않아 `unmatched-osm-stop` 경고가 난다(이수·자양과 같은 경우). 지제는 역사마스터 좌표로 놓인다.
- `18828088`, `18828089` (GTX-A 서울역~운정중앙), `14191876`, `14191877` (신림선): 노선 전체가 way 1개다. 형상 정밀도가 낮을 수 있다.
- GTX-A 서울역~수서 구간 relation이 없어 `north`, `south` 두 갈래로 나눴다. 그 구간 선로는 그려지지 않는다.
- 방향 미확정(실시간 API `updnLine` 실측 필요): 2호선 `seongsu`·`sinjeong` 지선, 경의중앙 `imjingang`·`seoul-station`, 6호선 응암순환 구간(`12080315`).

## 알려진 한계

- 6호선 응암 재통과: `12080315`(응암순환 → 신내)는 응암을 두 번 지나지만 shape에는 응암을 한 번(첫 통과, 0m)만 놓는다(`track_station`은 shape당 역 하나). 두 번째 통과는 2단계 실시간 매칭에서 처리한다.
- 역사마스터 좌표가 선로에서 150m 넘게 떨어진 역(청산 718m, 인천공항2터미널 1149m, 청량리 경의중앙·경춘·수인분당 206~314m, 미사 243m, 임진강 216m, 옥수 182m, 세종왕릉 186m 등)은 OSM 정차 노드로 놓인다. 정차 노드가 없는 relation이 이런 역을 지나면 다시 미커버가 된다.

## 시간표 명령 순서

```bash
bun transit fetch:timetable-sources          # 서울교통공사 CSV(15098251)와 KRIC id=900 xlsx를 data/raw/에 받는다 (키 불필요, 해시가 같으면 unchanged)
bun transit build:timetable --dry-run        # 출처를 읽고, 대응표로 역을 잇고, 검증한 보고서만 쓴다
bun transit build:timetable                  # ok이면 DB에 적재한다
bun transit fetch:realtime-sample            # 공개 sample 키로 노선별 실시간 위치 5건씩 받는다 (키 불필요)
bun transit report:match-rate                # 표본 열차번호를 현재 timetable 배치와 대조한다
```

- `build:timetable`은 DB의 현재 `station_crosswalk` 배치로 역을 잇는다. 대응표를 먼저 적재해야 한다(`--dry-run`이어도 DB를 읽는다).
- 노선마다 `src/manual/timetable-sources.json`으로 출처를 고른다. 1차 출처의 수동 파일이 없으면 2차로 내려가고, 쓸 수 있는 출처가 처음부터 없는 노선(GTX-A 키 대기)은 `linesWithoutTimetable`로 보고서에만 남긴다(다른 노선의 적재를 막지 않는다).
- 고른 출처가 실패하면 그 노선을 조용히 빼지 않고 막는다(노선 단위 error issue):
  - `source-missing`: 고른 출처의 원본이 `data/raw/`에 없다. 콘솔에 `fetch:timetable-sources`를 먼저 실행하라는 안내와 노선 목록이 나오고 exit 1이다.
  - `source-empty`: 고른 출처가 그 노선 trip을 하나도 만들지 못했다(예: 형식이 다른 korail XLSX, 시트 이름이 다른 파일). 보고서 "출처 오류"에서 원인을 본다. 수동 파일이 원인이면 파일을 고치거나 빼면 2차 출처로 내려간다.
  - `line-dropped`: 현재 배치에 trip이 있던 노선이 이번에 0건이다. 적재하면 그 노선 시간표가 사라지므로 막는다.
- `ok` = error 등급 검증 결과 0건 **그리고** 대응표에 없는 역 0건. ok가 아니면 exit 1이고 적재하지 않는다. 어댑터가 버린 행·열차(출처 오류)와 범위 밖으로 뺀 역은 보고서에 남지만 ok에는 들어가지 않는다.
- 검증: 모든 정차의 역이 대응표에 있는지, 한 열차 안에서 시각이 줄지 않는지(24시 넘김 처리 후), 정차가 2곳 이상인지(error). 역간 소요시간이 같은 구간 중앙값의 3배 이상이거나 1/3 미만이면 warn, 같은 역 재통과는 `duplicate-stop` warn.
- 적재는 한 트랜잭션으로 `reference_batch(kind="timetable")`를 만들고 `timetable_trip`, `timetable_stop_time`을 넣은 뒤 현재 배치로 바꾼다. manifest는 원본 해시, 현재 대응표 내용, 두 매뉴얼 표 내용, 로직 버전(`timetableVersion` = `TIMETABLE_LOGIC_VERSION`)이다. 모두 같으면 다시 적재하지 않는다. 변환·검증 결과가 달라지는 코드를 고치면 그 상수를 올린다.
- 2026-10-31 실적재: batch 4, trip 19,745, stop_time 556,108. 1~9호선은 세 요일 모두 원문이고, 코레일 5노선과 공항철도는 토요일이 `holiday-copied`다.

### 키와 수동 파일 의존성

| 출처 | 노선 | 필요한 것 | 현재 |
|---|---|---|---|
| `seoul-metro-csv` 서울교통공사 CSV | 1~9호선(코레일 직결 구간 포함) | 없음 | 2026-09-14판 적재 |
| `kric-korail` KRIC id=900 xlsx | 경의중앙, 경춘, 수인분당, 서해, 경강 | 없음 | korail XLSX가 없어 이 출처로 내려감 |
| `kric-packed` KRIC id=900 xlsx | 공항철도(일반·직통), 신분당, 우이신설, 신림 | 없음 | 적재. 공항철도 직통은 정차를 건너뛰는 열차로 요일마다 52편(trip 156건, `express="direct"`) |
| `korail-xlsx` korail.com 시각표 | 코레일 5노선(1차 출처) | `data/manual/timetables/` 파일 | 없음 |
| `airport-express-csv` 공항철도 직통 | 공항철도 직통(부분 대체) | `data/manual/timetables/` 파일 | 없음. 넣으면 `kric-packed`의 직통 trip을 빼고 이 파일의 직통으로 바꾼다 |
| `kric-api` KRIC subwayTimetable | GTX-A | `KRIC_SERVICE_KEY` | 키 대기. GTX-A는 `linesWithoutTimetable` |

## 수동 투입 시간표 파일

사람이 받아서 `<BETRO_DATA_DIR>/manual/timetables/`(기본 `data/manual/timetables/`)에 넣는다. 자동 수집하지 않는다(약관 미확인). 파일 이름이 `timetable-sources.json`의 `manualFile`과 정확히 같아야 그 노선이 이 출처를 쓴다. 파일을 읽는 코드는 경로(또는 바이트)를 인자로 받는다.

| 파일 | 노선 | 형식 |
|---|---|---|
| `korail-gyeongui-jungang.xlsx` | 경의중앙 | korail.com 노선별 시간표 XLSX |
| `korail-gyeongchun.xlsx` | 경춘 | 같음 |
| `korail-suin-bundang.xlsx` | 수인분당 | 같음 |
| `korail-seohae.xlsx` | 서해 | 같음 |
| `korail-gyeonggang.xlsx` | 경강 | 같음 |
| `airport-express.csv` | 공항철도 직통 | UTF-8 CSV |

- korail.com XLSX (`src/sources/korail-xlsx.ts`): **실제 파일 형식은 확인 필요.** 아직 실제 파일을 받지 못해 `src/sources/__fixtures__/korail-sample.xlsx`(평일·휴일 2시트)로만 테스트했다. 현재 가정: 시트 이름에 `평일`/`휴일`, 열 하나 = 열차 1편, 0행 `열차번호`, 1행 `방향`(상행/하행), 2행부터 `역명` + `HH:MM`. 실제 파일을 받으면 이 가정을 대조해 고정한다. 휴일 시트는 토요일로 복제한다(`holiday-copied`).
- 공항철도 직통 CSV (`src/sources/airport-express-csv.ts`): 헤더 `direction,departStation,departTime,arriveStation,arriveTime`. `direction`은 `up`/`down`(또는 상행/하행). 정차는 서울역, 인천공항1터미널, 인천공항2터미널만 허용한다. 열차번호가 없어 `DIRECT-<direction>-<HHMM>`으로 만들고 `synthetic-train-no`를 표시한다. 요일 열이 없어 세 요일에 모두 넣는다.
- 기준일은 파일 이름의 `_YYYYMMDD`에서 읽는다. 기준일을 남기려면 `manualFile`을 `korail-seohae_20261101.xlsx`처럼 날짜를 붙인 이름으로 바꾸고 같은 이름으로 넣는다(날짜가 없으면 `unknown`이고 신선도에서 STALE로 보인다).
- GTX-A KRIC API (`src/sources/kric-api.ts`): `KRIC_SERVICE_KEY` 환경 변수가 필요하다. 키가 없어 실호출로 확인하지 못했다(키 대기). 노선 코드 `A`와 운영기관 코드(`GX`, 동탄 X111만 `SR`)는 연구 보고서 코드표로 확인했지만 응답 필드명과 `dayCd` 의미(8 평일, 7 토요일, 9 휴일)는 확인 필요다. `fetch:timetable-sources --gtx-a`는 키가 없으면 안내 후 exit 1 한다. GTX-A 역별 호출과 적재 경로는 키를 받은 뒤 실응답으로 맞춘다. 테스트는 `fetchImpl` 목으로만 한다. 공공데이터포털 키(`DATA_GO_KR_API_KEY`)는 KRIC 키가 아니다.

## 매뉴얼 표 수정 규칙 (시간표)

`src/manual/timetable-sources.json`과 `src/manual/timetable-station-aliases.json`도 **리뷰를 거쳐서만** 바꾼다. 바꿀 때는 `build:timetable --dry-run` 보고서를 PR에 붙인다. 두 표의 내용은 manifest에 들어가므로 바꾸면 다음 `build:timetable`에서 다시 적재된다.

- `timetable-sources.json`: `{ "lines": { "<lineKey>": { "primary", "secondary"?, "manualFile"? } } }`. 19개 lineKey가 모두 있어야 하고 모르는 노선·출처는 실패한다.
  - 출처 이름: `seoul-metro-csv`, `kric-korail`, `kric-packed`, `korail-xlsx`, `airport-express-csv`, `kric-api`.
  - `primary`, `secondary` 순으로 처음 쓸 수 있는 기본 출처 하나를 쓴다. `korail-xlsx`·`airport-express-csv`는 `manualFile`이 있고 그 파일이 있어야, `kric-api`는 `KRIC_SERVICE_KEY`가 있어야 쓸 수 있다. `airport-express-csv`는 부분 대체 출처다. 기본 출처(`kric-packed`) 전체가 아니라 그 안의 직통 trip(`express="direct"`)만 대신한다. 이 파일이 trip을 내면 KRIC 직통 trip을 빼고(두 출처의 열차번호가 달라 `duplicate-trip`으로는 겹침을 잡을 수 없다) 보고서 노선 표에 바꾼 trip 수를 적는다.
  - 출처를 바꾸면 그 노선의 열차번호 체계가 달라질 수 있으니 `report:match-rate`를 다시 돌린다.
- `timetable-station-aliases.json`: `{ "lineKey", "source", "sourceStation", "statnId" }` 배열. 코드·이름으로 못 맞춘 시간표 역에만 넣는다.
  - `source`는 출처 이름 또는 `"*"`(모든 출처). 같은 역이 여러 출처에서 안 맞으면 `"*"`를 쓴다. 출처 이름이 맞는 별칭을 `"*"`보다 먼저 본다.
  - `sourceStation`은 출처 원문의 역사코드(서울교통공사 CSV는 앞자리 0 포함 문자열) 또는 역명이다. 해석 순서는 대응표 `stationCd` → 정규화한 역명 → 별칭이다(같은 노선 안에서만).
  - `statnId`는 대응표의 10자리 문자열이다. **`null`은 대응표(실시간 API 역 목록) 범위 밖의 역**이라는 뜻이다. 그 정차는 빼고 보고서 "대응표 범위 밖으로 뺀 역"에 센다. 빼고 나서 정차가 2곳 미만 남는 열차는 버리고 출처 오류로 남긴다. 대응표에 있어야 할 역을 `null`로 숨기지 않는다.
  - 절차: `build:timetable --dry-run` → 보고서 "대응표에 없는 역"(출처, 노선, 코드, 역명, 빈도)을 보고 별칭을 넣는다 → `ok: true`가 될 때까지 반복한다.
  - 현재 38건: 서울교통공사 CSV 역명 변경 3건(7호선 `2738` 이수→총신대입구, `2730` 자양→뚝섬유원지, 1호선 `1723` 평택지제→지제), 진접선 3역 `null`(4호선 `0405` 진접, `0406` 오남, `0408` 별내별가람), KRIC 코레일 축약 역명 32건(3글자 자르기: `디엠시`→디지털미디어시티, `강남구`→강남구청 등, 수인선·서해선·경강선 신설역의 `신` 접두: `신수원`→수원, `신인천`→인천, `신김포`→김포공항, `신판교`→판교 등, 경의중앙 `1양원`·`1양정`).

## 알려진 시간표 문제

원문 데이터의 오류로 판단해 버리거나 경고로 남겨 둔 것이다. 어댑터가 버린 행·열차는 보고서 "출처 오류"에 그대로 나온다. 값을 고쳐서 통과시키지 않는다.

- **9호선 DAY C9247 신반포** (서울교통공사 CSV 20260914, 407,672행): 도착 24:12:35, 출발 24:12:00으로 출발이 도착보다 이르다. 어느 쪽이 틀렸는지 알 수 없어 `seoul-metro-csv` 어댑터가 그 행을 버린다(`depart ... before arrive ...`). C9247은 신반포 정차 없이 적재된다.
- **신림선 주말+공휴일 30편** (KRIC id=900, 기준일 2025-09-23): 1011~1015, 1020, 1021, 1024, 1025, 1029~1031, 1064~1068, 1088~1094, 1215~1217, 1221~1223. 출발 칸 시각이 역 순서와 반대로 줄어든다(예: 1011 샛강 6:40 → 대방 6:35 → … → 서울대벤처타운 6:21, 도착 칸은 정상). `kric-packed` 어댑터가 `time-column-reversed`로 행을 버린다. 신림선 토·휴일 trip은 312편에서 282편이 됐다.
- **진접선** (4호선 진접·오남·별내별가람): 실시간 API 역 목록에 없어 대응표에 없다(선로도 불암산~오이도만 쓴다). 별칭 `null`로 정차를 뺀다. 진접까지 가는 열차는 불암산에서 끝나는 것으로 적재되고, 진접선 안에서만 다니는 셔틀(4002, 4179, 4223; 요일 합계 6 trip)은 버린다.
- **신분당선 segment-outlier 39건**: 원문 시각이 분 단위라 역간 0초 구간이 생긴다(1077000684→1077000685). warn만 낸다.
- **2호선 2118 토·휴일**: 1002000224→1002000225 30초(중앙값 120초). warn만 낸다.
- **duplicate-stop**: 2호선 1,142건, 6호선 404건. 순환 열차(2호선 본선, 6호선 응암순환)가 같은 역을 두 번 지나는 정상 운행이며 warn만 낸다.
- **수인분당 토요일**: 토요일은 KRIC 휴일 시간표 복제(`holiday-copied`)인데, 2026-10-31(토) 표본에 휴일표에 없는 6138(평일표에만 `K6138`)이 나왔다. 코레일 토요일 운행이 휴일과 다를 수 있다. korail.com XLSX를 넣거나 토요일 출처를 찾으면 해소된다.
- **낡은 기준일**: 우이신설 2022-05-30, 신림 2025-09-23, 공항철도 2025-12-31은 180일을 넘어 보고서 신선도에서 STALE이다. 우이신설 표본의 1905는 시간표 번호 범위(1001~1516) 밖이다.

## 토요일 복제 노선

토요일 시간표가 없는 출처는 휴일 trip을 토요일로 복제하고 `service_day_source = "holiday-copied"`로 표시한다(설계 §6.3, 공식 확인 필요).

- 경의중앙, 경춘, 수인분당, 서해, 경강: `kric-korail`(id=900 코레일 행은 평일·휴일만 있다). korail.com XLSX도 평일·휴일 두 시트라 같은 방식이다.
- 공항철도: `kric-packed` 인천국제공항선 행에 토요일이 없다.
- 1~9호선(CSV `SAT`), 신분당·우이신설·신림(원문 `주말+공휴일`, `토요일+휴일` 묶음)은 원문 토요일(`source`)이다.

## 출처별 기준일 (2026-10-31 적재 기준)

| 출처 | 노선 | 기준일 | 근거 |
|---|---|---|---|
| `seoul-metro-csv` | 1~9호선 | 2026-09-14 | 파일 이름 `서울교통공사_도시철도열차운행시각표_20260914.csv` |
| `kric-korail` | 경의중앙, 경춘, 수인분당, 서해, 경강 | 2026-05-31 | 행의 데이터기준일자(파일 `전체_도시철도운행정보_20260630.xlsx`) |
| `kric-packed` | 신분당 | 2026-06-18 | 같음 |
| `kric-packed` | 공항철도 | 2025-12-31 | 같음 |
| `kric-packed` | 신림 | 2025-09-23 | 같음 |
| `kric-packed` | 우이신설 | 2022-05-30 | 같음 |
| - | GTX-A | - | 시간표 없음(KRIC 키 대기) |

## 열차번호 규칙 표와 표본 매칭률

`bun transit report:match-rate [--service-day weekday|saturday|holiday]`는 `data/raw/realtime-sample/`의 노선별 최신 표본(`<lineKey>-<KST yyyymmddHHMM>.json`)을 현재 timetable 배치와 대조해 `data/reports/match-rate/`에 노선별 매칭률을 쓴다.

- 규칙은 `src/realtime/train-no-rules.ts`의 `TRAIN_NO_RULES`(노선별 함수, 설계 §4.3)다. 신분당·GTX-A는 규칙이 없어(null) "시간표 없음"으로 넘기고 매칭률은 `-`(null)다. 그 요일 시간표가 없는 노선도 null이다. 규칙을 고칠 때는 `train-no-rules.test.ts`를 먼저 바꾼다.
- 후보 번호 중 하나라도 같은 (노선, 서비스일) trip 번호에 있으면 매칭이다. 방향은 조건에 넣지 않는다(2호선은 성수에서 번호가 바뀐다). 9호선은 실시간 `directAt`(1 급행 / 0 일반)으로 `E`/`C` 접두 하나만 본다.
- 1호선은 시간표 번호가 `K802`·`S902`처럼 접두를 달고 실시간은 `0802`라, 시간표 쪽 번호에도 같은 정규화(K/S 떼고 4자리 0 채움)를 건다(`timetableTrainNoKey`). 정규화하면 K·S 번호가 겹치는 열차가 있어(서울교통공사 CSV 2026-09-14판 986개 → 865개) 1호선 매칭률은 다소 후하게 나올 수 있다.
- `--service-day`를 안 주면 표본 파일 이름의 날짜(KST) 요일로 정한다: 토요일 `saturday`, 일요일 `holiday`, 그 밖은 `weekday`. **공휴일은 판정하지 않는다**(평일 공휴일 표본은 `--service-day holiday`로 다시 돌린다). 자정~첫차 전 표본도 날짜 그대로의 요일로 본다.

표본 매칭률: 공개 sample 키는 노선당 5건만 주므로 2026-10-31(토)에 두 번 받은 표본(16:53, 17:19 KST)의 결과를 함께 적는다. 표본이 작아 노선 규칙이 깨졌는지 보는 신호로만 쓴다.

| 노선 | 규칙 | 실시간 → 시간표 번호 | 16:53 | 17:19 | 미매칭 |
|---|---|---|---|---|---|
| line1 | `line1-strip-ks-pad4` | `0802` ↔ `K802`/`S802` (양쪽 정규화) | 5/5 | 5/5 | |
| line2 | `line2-main-2xxx` / `line2-branch` | 본선은 끝 3자리 앞에 `2`, 지선 `1xxx`·`5xxx`는 그대로 | 5/5 | 5/5 | |
| line3 | `line3-k-suffix` | `3237` → `3237`, `3237K` | 5/5 | 5/5 | |
| line4 | `line4-k-prefix` | `4614` → `4614`, `K4614` | 5/5 | 5/5 | |
| line5 | `same` | 그대로 | 4/5 | 4/5 | 5721 |
| line6, line7, line8 | `same` | 그대로 | 5/5 | 5/5 | |
| line9 | `line9-c-e-prefix` | `9622` → `C9622`(일반) / `E9622`(급행) | 5/5 | 5/5 | |
| suin-bundang | `korail-k-prefix` | `6130` → `K6130`, `6130` | 5/5 | 4/5 | 6138 |
| 경의중앙, 경춘, 서해, 경강 | `korail-k-prefix` | 같음 | 5/5 | 5/5 | |
| airport | `same` | `A2167` 그대로 | 5/5 | 5/5 | |
| ui-sinseol | `same` | 그대로 | 5/5 | 4/5 | 1905 |
| sillim | `same` | 그대로 | 5/5 | 5/5 | |
| shinbundang | 없음(null) | 시간표 없음으로 넘김 | - | - | |
| gtx-a | 없음(null) | 시간표 없음으로 넘김 | - | - | |

미매칭 원인:

- 5호선 5721: 두 표본 모두 마천역(종착)에 있었다(16:53, 17:19). 토요일 시간표 번호는 5001~5175, 5501~5671뿐이고 57xx 계열(5701~5727, 하행)은 평일표에만 있다. 종착역에 머무는 유치·회송 열차가 평일 번호를 달고 있는 것으로 보이며, 규칙 문제는 아니다.
- 수인분당 6138: 휴일표(토요일 복제)에 `K6138`이 없고 평일표에만 있다. 위 "알려진 시간표 문제"의 토요일=휴일 가정 문제다.
- 우이신설 1905: 시간표(2022-05-30) 번호 범위 1001~1516 밖이다. 북한산우이에 있던 열차로, 기준일이 낡았거나 입·출고 열차 번호로 보인다.
