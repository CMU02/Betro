# MVP 2단계 사전 실험 결과

계획: `docs/superpowers/plans/2026-11-06-mvp-2a-experiments.md`. 설계: `docs/superpowers/specs/2026-11-05-mvp-design.md` 9장.

각 절은 같은 순서로 씁니다: 질문 / 기준 / 결과 / 측정값 / 재현 방법 / 2-C~2-F에 주는 결정.

## 요약

2026-11-10 기준입니다. 실패한 실험은 없고, 실험 6의 버스 측정만 남았습니다.

| # | 실험 | 결과 | 결론 | 2-C~2-F에 주는 결정 |
|---|---|---|---|---|
| 1 | 경기·인천 버스 | 부분 | 서울을 오가는 노선은 서울 API가 위치와 도착 예측을 준다. 그 밖의 경기·인천 노선은 TAGO로 받을 수 있지만 경기 마을버스는 없다. 위치는 두 출처 모두 약 1분마다 바뀌어 30초 기준에 못 미친다 | **[사용자 결정, 2026-11-10]** 범위는 경기 마을버스까지 전체, 위치 갱신 기준은 1분. 서울을 오가는 노선은 서울 API, 그 밖은 TAGO 어댑터, 경기 마을버스는 GBIS를 따로 신청해 실험한다. 정류장 ID는 규칙 하나로 맞는다(경기 `GGB` + `stId`, 인천은 첫 자리 + 2) |
| 2 | Worker에서 APNs 발송 | 통과 | Worker의 일반 `fetch`와 WebCrypto 서명으로 APNs에 직접 보낸다. 3초 안에 도착했다 | iOS는 Worker → APNs 직접, FCM은 Android와 iOS 예비 경로. JWT는 약 50분 재사용, 토큰마다 환경(sandbox/운영)을 저장 |
| 3 | Live Activity 위젯 확장 빌드 | 통과 | `@bacons/apple-targets`로 로컬 빌드가 된다 | 확장 타깃 이름은 로컬 모듈과 겹치지 않게 짓고, Activity 정의 파일은 하나를 심볼릭 링크로 공유 |
| 4 | push-to-start와 업데이트 토큰 | 통과 (10/10) | 앱이 꺼져 있어도, 마지막으로 연 지 16시간이 지나도 10초 안에 뜨고, 업데이트 토큰은 4초 안에 온다 | 로컬 알림 보조 경로는 필요 없다. 토큰은 네이티브 AppDelegate 구독자가 보낸다. 끝난 Activity의 토큰은 서버가 지운다 |
| 5 | Android 갱신 | 통과 | Doze, rare 버킷, 절전 모드, 삼성 "절전 앱"에서도 30분 동안 30회를 모두 받았고 최대 간격은 67초였다 | 포그라운드 서비스는 필요 없다. 서버는 짧은 `ttl`과 세션별 `collapse_key`를 주고, 앱은 이미 반영한 것보다 오래된 메시지를 버린다 |
| 6 | 도착 정확도 기준선 | 진행 중 (지하철만 끝남) | 지하철 공식 예측은 약 1분 일찍 잡는다. 그대로는 7.1 기준에 못 미치고, 편향을 빼면 ±2분 95%는 넘는다. `dev` 수집 간격으로는 실제 도착을 ±45초로만 알 수 있어 ±1분은 확정하지 못한다. 버스는 11-11, 11-12 아침에 잰다 | 잠정: 지하철은 "공식 예측 + 보정". ±1분 검증에는 세션 노선을 더 촘촘히 봐야 한다. 버스 결과가 나오면 확정한다 |

남은 측정:

- 실험 6의 버스: 임시 Worker `betro-spike-accuracy`가 2026-11-11, 11-12 07:30~09:30에 도착 예측을 모은다. 11-12에 평가하고 Worker를 지운다.

## 1. 경기·인천 버스

실험일: 2026-11-09(월) 17:10~17:40 KST, 퇴근 시간대.

### 질문

1. 서울 버스 API가 경기·인천 면허 노선의 차량 위치를 주는가?
2. 안 주면 국토교통부 TAGO 버스 API로 경기·인천의 위치·도착 정보를 받을 수 있는가? (2026-11-09 사용자 결정: 경기 GBIS·인천 API 대신 TAGO 하나로 본다.)
3. 정류장 ID를 서울 정류장과 맞출 수 있는가?
4. 한도와 갱신 간격은 얼마인가?

### 기준

- "전체 범위 가능": 경기(마을 포함)와 인천 모두 차량별 위치(최소 정류장 순번)를 30초 이하 간격으로 받을 수 있고, 서울 정류장과 ID를 기계적으로 맞출 수 있다.
- "최소 범위만 가능": 서울을 오가는 노선만 위와 같다.
- 둘 다 안 되면 "위치 없음(도착 예측만)"이다.

### 결과: 부분

- **질문 1: 준다. 서울을 오가는 노선만 준다.** 서울 노선 마스터(OA-1095)에는 없지만, 서울 API 자체는 서울에 들어오는 경기·인천 노선을 알고 있다.
  - 노선 이름에 지역이 붙는다. 예: `M5107광주`, `9003성남`, `M6450인천`, `M4101광주`.
  - routeType은 경기 8, 인천 7이다.
  - 위치(`buspos/getBusPosByRouteSt`)와 서울 정류장의 도착 예측(`arrive/getArrInfoByRoute`)이 정상으로 온다.
  - 서울에 들어오지 않는 노선은 없다. 수원 13, 인천 82·534로 확인했다.
- **질문 2: 받을 수 있다. 경기 마을버스는 빼고.**
  - TAGO 도시코드 138곳 중 인천(23)과 경기 31개 시·군이 모두 있다. 서울은 없다.
  - 위치에는 좌표, 정류장 순번, 차량번호가 있다.
  - 경기 노선 2,168개에 "마을버스" 유형이 하나도 없다. 인천은 마을버스 13개 중 3개만 위치가 나왔다. 강화 마을버스 10개는 0대였다.
  - TAGO는 서울 정류장의 도착 예측을 주지 않는다. M5107을 서울역버스환승센터에서 부르면 0건이고, 경기 구간 정류장(영통역)에서는 2건이 왔다.
- **질문 3: 맞출 수 있다. 규칙 하나로 기계적으로 된다.**
  - 경기: TAGO `nodeid` = `GGB` + 서울 `stId`. 노선 ID도 같다(TAGO `GGB234001243` = 서울 `busRouteId` 234001243). M5107 정류장 61개 중 61개가 맞았다.
  - 인천: TAGO `nodeid` = `ICB` + (서울 `stId` 첫 자리 + 2) + 나머지. 예: `121000221` → `ICB321000221`, `277103297` → `ICB477103297`. M6450 정류장 46개 중 46개가 맞았다.
  - 정류소번호(`nodeno`)는 기준으로 쓸 수 없다. 서울 `arsId`와 경기는 0/6, 인천은 5/12만 같고, 경기 노선의 서울 구간에는 값이 비어 있다.
- **질문 4: 위치는 약 1분마다 바뀐다. 30초 기준에 못 미친다.** 측정값을 보라. TAGO 개발계정 한도는 오퍼레이션마다 하루 10,000건이고, 활용사례를 등록하면 늘릴 수 있다(공공데이터포털 신청 정보, 2026-11-09 사용자 확인). 서울 API는 오퍼레이션마다 하루 1,000건이다.

기준대로 보면 두 출처 모두 갱신 간격(중앙값 60초)이 30초 기준을 넘는다. 그래서 엄밀한 판정은 "위치 없음(도착 예측만)"이다. 다만 좌표, 정류장 순번, 차량번호는 모두 있다. 30초 기준을 1분으로 완화하면 "최소 범위만 가능"이다. 경기 마을버스가 TAGO에 없어서 "전체"는 어느 쪽이든 안 된다. 기준을 완화할지는 Task 7에서 사용자와 정한다.

**사용자 결정(2026-11-10)**: 기준을 1분으로 완화하고, 범위는 경기 마을버스까지 전체로 한다. 경기 마을버스는 TAGO에 없으므로 경기도 GBIS API를 따로 신청해 같은 질문(위치, 도착 예측, 정류장 ID 연결, 한도)을 실험으로 한 번 더 확인한다.

### 측정값

**TAGO 응답 필드** (표본 5개 노선, 각 1회)

| 표본 | 노선 | 정류소 | 위치(차량) | 도착 |
|---|---|---|---|---|
| (a) 경기 광역, 서울행 | M5107 `GGB234001243` (수원 31010, 광역급행버스) | 61 | 18대, 18대 모두 좌표 있음 | 경기 정류장 2건, 서울 정류장 0건 |
| (b) 경기 시내 | 13 `GGB200000037` (수원, 일반버스) | 83 | 16대, 16대 모두 좌표 있음 | 2건 |
| (c) 경기 마을 | 없음 | | | |
| (d) 인천 광역, 서울행 | M6450 `ICB361000004` (광역버스) | 46 | 7대, 7대 모두 좌표 있음 | 1건 |
| (d) 인천 간선 | 82 `ICB361000005` | 122 | 14대, 14대 모두 좌표 있음 | 2건 |
| (참고) 인천 마을 | 905-1(강화) `ICB169000021` | 76 | 0대 | 0건 |

- 위치(`getRouteAcctoBusLcList`): `gpslati`, `gpslong`, `nodeid`, `nodenm`, `nodeord`, `routenm`, `routetp`, `vehicleno`.
  - 수신 시각, 잔여석, 혼잡도는 없다.
- 도착(`getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList`): `arrtime`(초), `arrprevstationcnt`, `vehicletp`, `nodeid`, `routeid`, `routeno`, `routetp`.
  - 차량번호가 없어 위치의 차량과 바로 잇지 못한다.
- 경유 정류소(`getRouteAcctoThrghSttnList`): `nodeid`, `nodeno`, `nodenm`, `nodeord`, `gpslati`, `gpslong`. 인천에는 `updowncd`도 있다.
  - 노선 경로 좌표를 주는 오퍼레이션은 없다.
- `gpslong`이 숫자로 올 때와 문자열로 올 때가 섞여 있다(인천).

**경기 노선 유형** (TAGO `getRouteNoList`, 31개 시·군)

일반 1,359 / 직행좌석 423 / 농어촌(일반) 248 / 광역급행 56 / 좌석 14 / 농어촌(좌석) 4 / 유형 없음 64(똑버스 같은 수요응답형). 마을버스는 0이다.

**인천 노선 유형**: 지선 126 / 간선 86 / 순환 73 / 광역 34 / 좌석 25 / 마을 13 / 급행 4 / 공항 2. 합계 363이다.

**서울 API의 경기 노선 위치** (`getBusPosByRouteSt`, M5107)

`vehId`, `plainNo`, `sectOrd`, `sectionId`, `lastStnId`, `stopFlag`, `dataTm`, `tmX`·`tmY`(WGS84 경도·위도), `posX`·`posY`(TM), `isFullFlag`, `congetion`. `gpsX`·`gpsY`는 비어 있다.

**갱신 간격** (M5107, 15초 간격 40회, 17:23~17:33)

| 항목 | 값 |
|---|---|
| 서울 API `dataTm`이 바뀌는 간격(차량별) | 167건, 중앙값 60초, p90 141초, 최대 882초 |
| 가져온 순간 서울 `dataTm`의 나이 | 978건, 중앙값 58초, 최대 1,199초 |
| TAGO 좌표가 바뀌는 간격(차량별) | 77건, 중앙값 120초, 최대 419초 |
| 서울에 새 좌표가 나온 뒤 TAGO에 30m 안의 같은 좌표가 나오기까지 | 194건 중 106건 일치. 중앙값 15초, p90 30초. 88건은 TAGO에 끝내 나오지 않음 |
| 같은 시점 같은 차량의 TAGO와 서울 좌표 거리 | 788건, 중앙값 30m, 50m 안 459건(58%), 최대 4.3km |
| 오류 | TAGO 1회(40회 중), 서울 0회 |

TAGO는 서울 API와 같은 차량 좌표를 조금 늦게, 일부는 건너뛰고 보여준다. 두 출처 모두 원천은 경기 버스정보시스템으로 보인다. 위 측정에서 TAGO가 서울 API보다 더 자주 갱신된 경우는 없었다. 활용가이드의 "실시간(10~20초)"은 이 노선에서는 확인되지 않았다.

**Cloudflare 출구**: 임시 Worker `betro-spike-tago`에서 TAGO 위치를 3회 불렀다. 3회 모두 HTTP 200과 `resultCode 00`, 차량 19대, 498~852ms였다. Worker는 확인 뒤 지웠다(지운 뒤 404).

**한도와 호출 수**

| 오퍼레이션 | 한도 | 이번 실험 호출 |
|---|---|---|
| TAGO `getCtyCodeList` | 10,000/일 | 4(승인 전 403 4회 별도) |
| TAGO `getRouteNoList` | 10,000/일 | 34 |
| TAGO `getRouteAcctoThrghSttnList` | 10,000/일 | 5 |
| TAGO `getRouteAcctoBusLcList` | 10,000/일 | 58(Worker 3회 포함 61) |
| TAGO `getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList` | 10,000/일 | 8 |
| 서울 `getBusRouteList` | 1,000/일 | 13 |
| 서울 `getStaionByRoute` | 1,000/일 | 5 |
| 서울 `getBusPosByRouteSt` | 1,000/일 | 45 |
| 서울 `getArrInfoByRoute` | 1,000/일 | 1 |

수집기가 쓰는 `getBusPosByRtid`는 부르지 않았다. 같은 데이터를 주는 `getBusPosByRouteSt`(시작·끝 순번 1~300)를 대신 썼다.

### 재현 방법

- 키: `packages/transit-static/.env`의 `DATA_GO_KR_API_KEY`. 출력에서 키를 가린다.
- TAGO 기본 URL은 `http://apis.data.go.kr/1613000/<서비스>/<오퍼레이션>`이고, `_type=json`과 `cityCode`를 붙인다. 서비스는 `BusRouteInfoInqireService`, `BusLcInfoInqireService`, `ArvlInfoInqireService`, `BusSttnInfoInqireService`다.
- 서울 기본 URL은 `http://ws.bus.go.kr/api/rest/<busRouteInfo|buspos|arrive>/<오퍼레이션>`이고, `resultType=json`을 붙인다.
- 순서:
  1. 도시별 `getRouteNoList`(`numOfRows=3000`)로 노선 유형을 센다.
  2. 표본 노선마다 경유 정류소 → 위치 → 정류장 1곳의 도착을 부른다.
  3. 서울 `getBusRouteList`(`strSrch=M51` 등)로 경기 노선 ID를 찾아 `getBusPosByRouteSt`와 `getStaionByRoute`를 부른다.
  4. 정류장을 순번으로 짝지어 ID 규칙과 좌표 거리를 계산한다.
  5. M5107의 두 출처 위치를 15초마다 40회 받아 차량번호로 맞춘다.

### 2-C~2-F에 주는 결정

- **서울을 오가는 경기·인천 노선은 서울 API로 받을 수 있다.**
  - 지금 수집기와 같은 오퍼레이션, 같은 응답 형태라서 새 어댑터가 필요 없다.
  - 정적 데이터의 범위 필터(`scope.ts`의 routeType 7·8 제외)와 노선 목록 출처만 바꾸면 된다. OA-1095 마스터에는 이 노선들이 없으므로, `getBusRouteList`나 다른 목록에서 가져와야 한다.
  - 대신 하루 호출 예산이 빠듯하다. 서울 API는 오퍼레이션마다 하루 1,000건이라, 노선 하나를 1분 간격으로 2시간 부르면 120건이고 하루에 8개 노선 정도만 된다. 수집기가 쓰는 `getBusPosByRtid` 대신 `getBusPosByRouteSt`로 부르면 예산이 따로 1,000건 생긴다.
  - TAGO는 하루 10,000건이라 같은 조건으로 80개 노선 정도를 부를 수 있다. 서울을 오가는 노선이라도 노선 수가 많으면 TAGO가 예산 면에서 낫다. 두 API 모두 활용사례를 등록하면 한도를 늘릴 수 있으므로, 출시 전 한도 증가 신청 결과에 따라 고른다.
- **서울에 들어오지 않는 경기·인천 노선은 TAGO만 줄 수 있다.** 이 노선까지 넓히면 TAGO 어댑터가 하나 더 필요하다.
  - 모든 호출에 `cityCode`가 있어야 한다.
  - 수신 시각이 없어 받은 시각을 기준으로 써야 한다.
  - 노선 모양은 정류소 좌표를 잇거나 OSM에서 가져와야 한다.
- **경기 마을버스는 TAGO로 받을 수 없다.** 넣으려면 경기도 API(GBIS)를 따로 신청해서 확인해야 한다.
- **정류장 ID 연결**: 경기는 `GGB` 접두어만 붙이면 서울 `stId`와 같다. 인천은 첫 자리에 2를 더한다. 좌표 최근접 매칭은 필요 없다.
- **"몇 정거장 전"**: 두 출처 모두 정류장 순번(서울 `sectOrd`, TAGO `nodeord`)과 좌표가 있어 지금 서울 버스와 같은 방식으로 계산할 수 있다. 위치가 약 1분 간격이므로, 지도 보간은 1분 간격을 전제로 맞춘다.
- **도착 예측**: 서울 정류장은 서울 API로만 받을 수 있다. TAGO는 서울 정류장에서 0건이다.

## 2. APNs 발송 경로

실험일: 2026-11-09(월) 18:10~18:50 KST. 실험 코드는 로컬 브랜치 `spike/mvp2-apns`(병합·push 안 함)에 있다.

### 질문

- Cloudflare Worker의 `fetch`로 APNs(HTTP/2 전용, ES256 JWT)에 직접 보낼 수 있는가?
- 안 되면 FCM HTTP v1로 iOS 알림을 보낼 수 있는가? Live Activity 경로는 Task 4에서 본다.

### 기준

Worker가 보낸 알림이 iPhone에 5초 안에 도착하고, 응답이 200과 `apns-id`이면 통과다.

### 결과: 통과

- **직접 발송이 된다.** Worker의 일반 `fetch`로 `api.sandbox.push.apple.com`에 보낸 알림이 200과 `apns-id`를 받았고, iPhone 홈 화면에 3초 안에 배너가 떴다. Worker 쪽에 HTTP/2 설정이나 별도 라이브러리는 필요 없었다.
- **JWT 서명이 된다.** WebCrypto `importKey("pkcs8", …, {name:"ECDSA", namedCurve:"P-256"})`로 `.p8` 키를 그대로 읽어 서명했다.
- **FCM HTTP v1도 된다.** 같은 Worker에서 서비스 계정으로 RS256 JWT를 만들어 OAuth 토큰을 받고 FCM으로 보낸 알림도 200을 받고 도착했다.

### 측정값

- 기기: iPhone 16 Pro, 개발 빌드(sandbox). APNs 토큰 `FD7A47D8…`(64자), FCM 토큰 `el9XbwLw…`(142자).

| 경로 | 응답 | 처리 시간 | 도착 |
|---|---|---|---|
| Mac에서 `curl --http2`(기준선) | `HTTP/2 200`, `apns-id` | 0.84초(연결 포함) | 3초 안에 배너 |
| Worker → APNs 직접 | 200, `apns-id` `B26A088D…` | Worker 안 143ms | 3초 안에 배너 |
| Worker → FCM HTTP v1 | 200, `projects/betro-a77a2/messages/…` | Worker 안 527ms(OAuth 토큰 발급 포함) | 3초 안에 배너 |

- 앱이 화면에 떠 있을 때는 iOS가 직접 보낸 APNs 알림의 배너를 보여주지 않았다. 확인은 홈 화면에서 했다.
- 도착 시간은 보낸 직후 기기 화면을 캡처해 확인했다. 캡처까지 약 3초가 걸리므로 실제로는 그보다 짧다.

**오류 응답** (Worker → APNs sandbox)

| 경우 | 상태 | `reason` |
|---|---|---|
| 토큰 마지막 한 글자를 바꿈 | 400 | `BadDeviceToken` |
| JWT `iat`를 2시간 전으로 | 403 | `ExpiredProviderToken` |
| 다른 번들 토픽(`com.cmu02.other`) | 400 | `TopicDisallowed` |
| sandbox 토큰을 운영 호스트(`api.push.apple.com`)로 | 400 | `BadDeviceToken` |

앱 삭제 뒤의 `410 Unregistered`는 이번에 보지 않았다. 토큰이 바뀌는 경우와 함께 Task 4에서 본다.

### 재현 방법

- 실험 브랜치에서 앱의 `getPushToken`이 APNs·FCM 토큰을 Mac의 수신 서버(`:8787`)로 보내게 했다.
  - 이 설치는 알림 권한을 아직 묻지 않은 상태(`undetermined`)였다. 그래서 실험 브랜치에서만 앱을 켤 때 권한을 묻게 바꿨다.
  - Metro를 `CI=1`로 띄우면 앱 로그가 보이지 않아서 수신 서버를 썼다.
- 로컬 기준선: `bun spikes/apns-worker/sign.ts`로 JWT를 만들고 `curl --http2`로 sandbox에 보낸다.
- Worker: `spikes/apns-worker`를 `betro-spike-apns`로 배포한다.
  - secret `APNS_KEY_P8`·`FCM_SA_JSON`은 파일에서 표준입력으로 넣고, `SPIKE_SECRET`은 임의 값으로 둔다.
  - `POST /send`(APNs)와 `POST /send-fcm`(FCM)을 부른다. 헤더 `x-spike-secret`가 틀리면 403이다.
- 확인 뒤 `wrangler delete --name betro-spike-apns`로 지웠다.

### 2-C~2-F에 주는 결정

- **iOS 알림과 Live Activity 업데이트는 Worker에서 APNs로 직접 보낸다.** 중계 서버는 필요 없다. FCM은 Android용으로 쓰고, iOS의 예비 경로로 남긴다.
- **JWT 재사용**: APNs는 같은 JWT를 20분~1시간 동안 재사용하라고 권고하고, 너무 자주 바꾸면 `TooManyProviderTokenUpdates`를 돌려준다. 그래서 Worker(Durable Object)가 JWT 하나를 만들어 약 50분 동안 메모리에 두고 쓴다. 403 `ExpiredProviderToken`이 오면 새로 만들어 한 번 다시 보낸다.
- **토큰 정리 규칙**
  - 400 `BadDeviceToken`이나 410 `Unregistered`: 그 기기 토큰 등록을 지운다.
  - 403 `ExpiredProviderToken`이나 `InvalidProviderToken`: 서버 쪽 문제이므로 토큰은 지우지 않는다. JWT를 새로 만들고 경보를 남긴다.
  - 400 `TopicDisallowed`: 설정 오류이므로 경보만 남긴다.
- **환경 구분**: sandbox 토큰을 운영 호스트로 보내면 `BadDeviceToken`이 온다. 그래서 등록할 때 토큰마다 환경(개발 빌드는 sandbox, 배포 빌드는 운영)을 함께 저장한다. 그러지 않으면 정상 토큰을 지우게 된다.
- 호출 수: APNs 7회(로컬 2, Worker 5), FCM 1회.

## 3. 위젯 확장 빌드

실험일: 2026-11-09(월) 19:00~19:35 KST. 실험 코드는 로컬 브랜치 `spike/mvp2-live-activity`(병합·push 안 함)에 있고, Task 4가 이어 쓴다.

### 질문

지금 앱(Expo 58, RN 0.88, `useFrameworks: dynamic`, Firebase)에 ActivityKit 위젯 확장을 넣고, prebuild와 기기 빌드가 반복해서 되는가?

### 기준

- `npx expo prebuild --clean` 뒤 기기 빌드가 성공한다.
- 앱에서 시작한 Live Activity가 잠금화면과 다이내믹 아일랜드에 보인다.
- prebuild를 다시 해도 확장이 유지된다.

### 결과: 통과

- `@bacons/apple-targets` 5.0.0으로 위젯 확장을 넣었다. 1순위 도구로 끝까지 됐으므로 `expo-live-activity`는 쓰지 않았다.
- `prebuild --clean`을 세 번 했고, 매번 `CommuteActivityWidget.appex`가 앱에 들어간 채로 기기 빌드가 성공했다.
- iPhone 16 Pro에서 앱 버튼으로 시작한 Activity가 잠금화면 카드와 다이내믹 아일랜드(compact: `M5107` / `3`)에 보였다.
- Firebase, `useFrameworks: dynamic`과의 충돌은 없었다.

### 막힌 점과 해결

1. **확장 프로비저닝**: 확장 번들 ID `com.cmu02.betro.commute-activity`의 개발 프로파일이 없어 서명에서 멈췄다.
   - Xcode에 Apple 계정이 로그인되어 있지 않았다(`No Accounts`). 사용자가 로그인한 뒤 `xcodebuild … -allowProvisioningUpdates`로 빌드하자, 자동 서명이 App ID와 프로파일을 만들었다.
   - `bun run ios`(`expo run:ios`)는 이 옵션을 넘기지 않는다. 그래서 확장을 처음 넣을 때는 Xcode에서 한 번 빌드하거나 `xcodebuild`를 직접 써야 한다.
   - 앱 설정에 `ios.appleTeamId`(`5JKMP6D4C5`)를 넣었다.
2. **모듈 이름 충돌**: 확장 타깃 이름을 `CommuteActivity`로 두었더니 로컬 모듈 Pod의 Swift 모듈 이름과 같아졌다. 그 결과 `ExpoModulesProvider.swift`에서 `cannot find 'CommuteActivityModule' in scope`가 났다.
   - 확장 이름을 `CommuteActivityWidget`으로 바꿨다.
   - 첫 빌드가 남긴 `CommuteActivity.swiftmodule`이 빌드 폴더에 남아 같은 오류가 이어졌다. derived data를 비우고 나서 해결됐다.
3. **공유 파일**: apple-targets의 `_shared` 폴더는 앱 타깃과 확장에만 링크된다. Expo 로컬 모듈은 별도 Pod라서 그 파일을 보지 못한다.
   - 원본 `targets/commute-activity/CommuteActivityAttributes.swift` 하나를 두고, `modules/commute-activity/ios/`에는 심볼릭 링크로 넣었다. CocoaPods가 링크를 따라 컴파일했다.
   - 결과적으로 두 모듈에 같은 소스의 `CommuteActivityAttributes` 타입이 각각 생기지만, ActivityKit은 문제없이 같은 Activity로 다뤘다.
4. **JS 값 변환**: 상태를 `[String: Any]`로 받았더니 `stopsAway`가 0으로 나왔다. JS 숫자는 Double이라 `as? Int`가 실패했다. 모듈 입력을 Expo `Record`(`@Field var stopsAway: Int`)로 바꿔 해결했다.

### 측정값

| 항목 | 값 |
|---|---|
| `prebuild --clean -p ios`(Pod 설치 포함) | 73초, 57초, 63초 |
| 기기 Debug 빌드, derived data 비운 상태 | 219초 |
| 기기 Debug 빌드, prebuild 직후 증분 | 176초 |
| Activity 시작(`startLocal`) → 업데이트 토큰 이벤트 | 약 1.2초 |
| push-to-start 토큰 | 관찰을 시작하자 바로 옴. 160자 hex. 앱 재설치(덮어쓰기) 뒤에도 같은 값 |
| Activity 업데이트 토큰 | Activity마다 다름. 160자 hex |

### 재현 방법

- `apps/native/targets/commute-activity/`
  - `expo-target.config.js`: `type: "widget"`, `name: "CommuteActivityWidget"`, `deploymentTarget: "17.2"`, 프레임워크 SwiftUI·WidgetKit·ActivityKit
  - `CommuteActivityAttributes.swift`: 정적 값 `routeLabel`. `ContentState`는 `stage`, `stopsAway`, `etaEpoch`, `status`
  - `CommuteLiveActivity.swift`: 잠금화면 텍스트 네 줄, 다이내믹 아일랜드
- `apps/native/modules/commute-activity/`
  - Swift 모듈 `CommuteActivity`
  - `startLocal(routeLabel, state)`: activity id를 돌려준다
  - `areActivitiesEnabled()`
  - 이벤트 `onPushToStartToken`, `onActivityToken`
- `app.config.ts`
  - `plugins`에 `@bacons/apple-targets`
  - `ios.appleTeamId`
  - `ios.infoPlist`에 `NSSupportsLiveActivities`, `NSSupportsLiveActivitiesFrequentUpdates`
- 빌드: `npx expo prebuild --clean -p ios` 뒤 `xcodebuild -workspace ios/Betro.xcworkspace -scheme Betro -configuration Debug -destination id=<UDID> -allowProvisioningUpdates DEVELOPMENT_TEAM=5JKMP6D4C5 build`로 빌드하고, `xcrun devicectl device install app`으로 설치한다.

### 2-F에 주는 결정

- **확장 도구**: `@bacons/apple-targets`를 쓴다. 확장 타깃 이름은 로컬 모듈 이름과 겹치지 않게 `…Widget`으로 짓는다.
- **공유 파일 배치**: Activity 정의는 `targets/<확장>/` 아래 파일 하나를 원본으로 두고, 로컬 모듈에는 심볼릭 링크로 넣는다. 타입 이름 `CommuteActivityAttributes`가 push-to-start의 `attributes-type` 값이 된다.
- **모듈 API 모양**
  - `startLocal(routeLabel, state)`: id를 돌려준다
  - `areActivitiesEnabled()`
  - 이벤트 `onPushToStartToken({token})`, `onActivityToken({activityId, token})`
  - 상태는 `Record`로 받는다. 2-F에서는 `update`와 `end`를 더한다.
  - 토큰 이벤트는 관찰을 시작하자마자, 이미 있는 Activity까지 포함해 다시 온다. 그래서 서버에 보낼 때는 바뀐 경우만 보낸다.
- **빌드 절차**: 새 확장이나 새 번들 ID를 추가한 직후 첫 빌드에는 Xcode 계정 로그인과 `-allowProvisioningUpdates`가 필요하다. 그 뒤에는 `expo run:ios`로도 된다.

## 4. push-to-start와 업데이트 토큰

실험일: 2026-11-09(월) 19:45~20:25 KST(A~D), 2026-11-10(화) 12:14~12:16 KST(E). 실험 코드는 로컬 브랜치 `spike/mvp2-live-activity`에 있다.

### 질문

- 앱이 꺼진 상태에서 서버가 정한 시각에 Live Activity가 뜨는가?
- 업데이트 토큰이 서버에 제때 오는가?

### 기준

- 시나리오마다 2회, 합계 10회 모두 시작 푸시 뒤 10초 안에 잠금화면에 뜬다.
- 업데이트 토큰이 10회 모두 시작 뒤 60초 안에 `/token`에 도착한다.

### 결과: 통과(10/10)

- 시나리오 A~E 10회 모두 Live Activity가 떴고, 업데이트 토큰이 왔다.
- 표시 시간은 캡처로 확인한 9회 모두 10초 안이었다(A~D 7회는 5초 안, E 2회는 8.3초와 8.1초 캡처). B2는 캡처가 늦어 화면으로는 재지 못했다. 기기가 Activity를 만든 시각은 10회 모두 3초 안이다.
- 업데이트 토큰은 10회 모두 4초 안에 왔다. 기준 60초보다 훨씬 빠르다.
- 앱이 꺼져 있어도 시작 푸시를 받으면 iOS가 앱을 백그라운드로 깨운다. 이때 JS 없이 네이티브 코드(`ExpoAppDelegateSubscriber`)가 토큰을 서버로 보낼 수 있었다.
- 앱을 마지막으로 연 지 약 16시간이 지난 상태(E)에서도 A~D와 다르지 않았다. 오래 쓰지 않은 앱이라고 시작 푸시가 늦거나 막히지 않았다.

### 측정값

모든 시도는 Worker `/send` → APNs sandbox로 보냈다.
- 헤더: `apns-push-type: liveactivity`, `apns-topic: com.cmu02.betro.push-type.liveactivity`, `apns-priority: 10`
- 본문: `event: "start"`, `attributes-type: "CommuteActivityAttributes"`, `alert` 포함

"표시"는 보낸 뒤 처음으로 카드가 보인 캡처의 시각이다. 캡처 간격이 약 0.6~1.4초라 실제 표시는 그보다 이르다. "토큰"은 Worker가 업데이트 토큰을 받은 시각이다.

| # | 상태 | 앱 깨움 | 표시 | 토큰 |
|---|---|---|---|---|
| A1 | 앱 스와이프 종료, 잠김 | 백그라운드 실행 | ≤4.0초(첫 캡처) | 3.4초 |
| A2 | 앱 스와이프 종료, 잠김 | 백그라운드 실행 | 4.7초(3.3초 캡처엔 없음) | 2.4초 |
| B1 | 재부팅 → 한 번 해제 → 잠금 | 이미 떠 있음(재부팅 뒤 사전 실행으로 보임) | ≤4.7초(첫 캡처) | 3.3초 |
| B2 | 재부팅 → 한 번 해제 → 잠금 | 백그라운드 실행 | 캡처가 35초 늦어 재지 못함. 기기 기록상 2.6초에 Activity 있음 | 3.1초 |
| C1 | 저전력 모드, 잠김(미러링 중) | 백그라운드 | 미러링의 다이내믹 아일랜드와 Mac 메뉴 막대에 표시. 기기 기록상 1.6초에 생성 | 2.5초 |
| C2 | 저전력 모드, 잠김(미러링 중) | 백그라운드 | 약 1~2초(Mac 메뉴 막대) | 2.2초 |
| D1 | 방해금지, 잠김 | 백그라운드 | 2.6초(2.0초 캡처엔 없음) | 2.2초 |
| D2 | 방해금지, 잠김 | 백그라운드 | ≤2.7초(첫 캡처) | 3.2초 |
| E1 | 마지막 실행 약 16시간, 잠김 | 백그라운드 실행 | 8.3초(2.1초 캡처엔 없음). 기기 기록상 2.3초에 Activity 있음 | 2.3초 |
| E2 | 마지막 실행 약 16시간, 잠김 | 백그라운드 실행 | ≤8.1초(첫 캡처). 기기 기록상 1.8초에 Activity 있음 | 1.8초 |

- 방해금지에서는 화면이 켜지거나 소리가 나지 않았다. 그래도 카드는 잠금화면에 떴다.
- E: 사용자가 마지막으로 Betro를 연 것은 2026-11-09 20:25쯤이다. 그 뒤로 기기를 그대로 두었고, 11-10 12:13에 USB로 연결해 잠금을 한 번 풀었다가 다시 잠갔다.
  - E1 시작 푸시가 앱을 백그라운드로 깨웠고, 1분 뒤에도 프로세스가 메모리에 남아 있었다. 그대로 E2를 보내면 "앱이 떠 있는 상태"를 재게 되므로, `xcrun devicectl device process terminate`로 프로세스를 끝낸 뒤 E2를 보냈다(스와이프 종료와 같은 상태). 사용자가 마지막으로 연 시각은 바뀌지 않는다.
  - E1·E2 모두 종료 푸시(`event: "end"`, `dismissal-date: now`) 4초 뒤 캡처에서 카드가 사라졌다.
  - E는 USB 캡처 도구가 첫 장을 2~8초 뒤에야 찍어서, 표시 시각은 A~D보다 거칠게 잡혔다.
- iPhone 미러링 중에는 본체 화면이 꺼져 `devicectl` 캡처가 검게 나온다. 대신 미러링 창과 Mac 메뉴 막대에 Live Activity가 보였다. 미러링에서는 제어 센터를 열 수 없어서, 방해금지는 사용자가 본체에서 켰다.

**갱신과 종료** (A1의 Activity, 잠김 상태)

| 항목 | 결과 |
|---|---|
| `event: "update"` 30초 간격 10회, 우선순위 10과 5를 번갈아 | 10회 모두 반영. 두 우선순위 모두 보낸 뒤 약 1.5~2.1초 캡처에 새 값이 보였다. 이 짧은 시험에서는 우선순위 5도 늦지 않았다 |
| `event: "end"`, `dismissal-date: now` | 3초 뒤 캡처에서 카드가 사라졌다 |

**토큰 회전과 옛 토큰**

| 경우 | 결과 |
|---|---|
| push-to-start 토큰, 앱 재설치(덮어쓰기) 뒤 | 같은 값(`808c3b3d…`) |
| push-to-start 토큰, 재부팅 뒤(두 번) | 같은 값 |
| push-to-start 토큰, 앱 삭제 뒤 재설치 | 하지 않았다. 앱 데이터를 지우기 때문이다 |
| 업데이트 토큰 | Activity마다 새 값이다. 앱을 다시 띄울 때마다 같은 Activity의 같은 토큰이 다시 보고된다 |
| 끝난 Activity의 업데이트 토큰으로 `update` | 200(조용히 버려짐, 에러 없음) |
| 한 글자를 바꾼 업데이트 토큰 | 400 `BadDeviceToken` |

- 호출 수: APNs 시작 10회, 갱신 10회, 종료 10회, 옛 토큰 3회.

### 재현 방법

- 앱: Release 빌드(개발 서명, `aps-environment: development`).
- 로컬 모듈 `CommuteActivity`
  - `CommuteActivityAppDelegate`(`appDelegateSubscribers`)가 앱 시작 때 `CommuteTokenReporter`를 켠다.
  - `CommuteTokenReporter`는 `pushToStartTokenUpdates`, `activityUpdates`, 각 Activity의 `pushTokenUpdates`를 관찰한다. 바뀔 때마다 `URLSession`으로 Worker `/token`에 POST하고, 이때 `beginBackgroundTask`로 전송 시간을 확보한다.
- Worker `betro-spike-apns`
  - `/token`: 받은 시각과 함께 `console.log`로 남기고, `wrangler tail --format json`으로 파일에 받았다.
  - `/send`: APNs에 보낸다.
  - 실험 뒤 지웠다. E를 위해 2026-11-10에 같은 코드로 다시 올렸다가 끝나고 다시 지웠다.
- 잠금화면 확인: 보낸 직후 `xcrun devicectl device capture screenshot`을 6번 찍었다. 미러링 중일 때는 Mac 화면을 캡처했다.
- Cloudflare가 Python `urllib`의 기본 User-Agent 요청을 403으로 막아서 `user-agent: betro-spike/1`을 붙였다.

### 2-C와 2-F에 주는 결정

- **보조 경로**: "시작 직전 로컬 알림으로 앱을 깨우는 보조 경로"는 만들지 않는다. A~E 10회 모두 시작 푸시만으로 떴다. 출시 기준 7.1의 20/20은 실사용 검증에서 다시 센다.
- **토큰 등록 API 모양**: `POST /devices/{installId}/activity-tokens`
  - 본문: `{ kind: "pushToStart" | "activity", token, activityId?, route?, env: "sandbox" | "production", reportedAt }`
  - 같은 값이 여러 번 오므로 `(installId, kind, activityId)`로 덮어쓴다(멱등).
  - 앱은 JS가 아니라 네이티브 AppDelegate 구독자에서 보낸다. 백그라운드로 깨어난 짧은 시간에도 보내야 하기 때문이다.
- **Activity 수명은 서버가 관리한다.** APNs는 끝난 Activity의 토큰에도 200을 돌려준다. 그래서 서버가 `end`를 보낸 Activity의 토큰은 바로 지우고, 그 뒤에는 보내지 않는다.
- **토큰이 늦을 때 서버가 할 일**: 시작 푸시 뒤 업데이트 토큰이 오지 않으면 30초 간격으로 기다린다. 60초가 지나도 없으면 같은 노선의 시작 푸시를 한 번 다시 보내지 않는다. 중복 Activity가 생기기 때문이다. 대신 그 세션을 "갱신 불가"로 기록하고 일반 알림으로 바꾼다. 이번 측정에서는 토큰이 모두 4초 안에 왔다.
- **우선순위**: 우선순위 5도 짧은 시험에서는 바로 반영됐다. 다만 iOS가 우선순위 10의 하루 예산을 제한하므로, 2-C는 "몇 정거장 전" 변화와 도착 임박만 10으로 보내고 나머지는 5로 보낸다.

## 5. Android 갱신

실험일: 2026-11-09(월) 20:30~23:43 KST, 삼성 "절전 앱"(G)은 2026-11-10(화) 12:40~13:11 KST. 실험 코드는 로컬 브랜치 `spike/mvp2-android-update`에 있다.

- 절전 시나리오는 Galaxy S20 Ultra(Android 13, One UI)로 했다.
- 진행 중 알림의 Android 16 표시(ProgressStyle, 승격)는 에뮬레이터 두 개로 봤다: API 36.0(Android 16), API 36.1(Android 16 QPR1).

### 질문

앱이 꺼지고 Doze나 절전 상태일 때도 높은 우선순위 FCM 데이터 메시지로 진행 중 알림을 만들고 갱신할 수 있는가?

### 기준

- 각 시나리오 30분 동안 60초 간격으로 보낸 메시지가 기기에 반영된 시각 사이 간격이 2분을 넘지 않는다.
- 출시 기준 7.1 "끊김 0"을 위한 사전 확인이다.

### 결과: 통과(A~E, G 기준 통과)

- A~E 다섯 시나리오 모두 30분 동안 30회를 다 받았고, 최대 간격은 60초였다. 기준(2분)을 넘은 적이 없다.
- 지연은 최대 0.7초였다. Doze(C)와 rare 버킷(D)과 절전 모드(E)에서도 늦어지지 않았다.
- F(강제 종료)에서는 예상대로 하나도 오지 않았다. 그런데 이때 보낸 메시지는 버려지지 않았다. 앱을 다시 열자 3~7분 늦게, 순서가 섞여 도착했다(아래).
- 에뮬레이터 API 36.1에서는 상태바 칩과 잠금화면 카드로 승격됐다. API 36.0에서는 ProgressStyle만 보이고 승격되지 않았다.
- 삼성 "절전 앱"(G)에 넣고 앱을 열지 않은 상태에서도 30회를 다 받았다. 최대 간격 67초, 지연 최대 0.8초다. 절전 앱은 높은 우선순위 FCM 데이터 메시지를 막지 않았다.

### 측정값

- 보낸 쪽: Mac에서 `spikes/fcm-sender/send.ts`가 60초마다 FCM v1로 보냈다. `android.priority: HIGH`, 데이터 메시지만(`notification` 없음).
- 받은 쪽: `setBackgroundMessageHandler` → 로컬 모듈 `CommuteNotification.show` → `logcat` 태그 `CommuteSpike`에 `seq`, `sentAt`, `receivedAt`을 찍었다.
- "지연"은 기기 `receivedAt` − Mac `sentAt`이다. 두 시계가 모두 NTP라 음수(−0.02초)도 나온다. 시계 차이 이하의 지연은 0으로 본다.
- "최대 간격"은 기기에서 이웃한 두 메시지를 처리한 시각의 차이다. 60초면 한 번도 밀리지 않은 것이다.

| # | 상태 | 보냄/받음 | 누락 | 최대 간격 | 지연 중앙값 | 지연 최대 |
|---|---|---|---|---|---|---|
| A2 | 앱 백그라운드, 화면 켜짐, USB 충전 중 | 30/30 | 없음 | 60초 | 0.0초 | 0.0초 |
| A(첫 실행) | 같음 | 30/15 | seq 16~30 기록 끊김(아래) | 60초 | 0.0초 | 0.0초 |
| B | 앱 프로세스 종료(`am kill`), 화면 꺼짐, 충전 끊김 | 30/30 | 없음 | 60초 | 0.0초 | 0.7초 |
| C | B + Doze 강제 | 30/30 | 없음 | 60초 | 0.0초 | 0.0초 |
| D | Doze 유지 + rare 버킷 | 30/30 | 없음 | 60초 | 0.0초 | 0.1초 |
| E | Doze 유지 + 절전 모드, 버킷 active | 30/30 | 없음 | 60초 | 0.0초 | 0.1초 |
| F | 강제 종료, 5분 | 5/0 | 5 | - | - | - |
| G | 삼성 "절전 앱"에 넣음(사용자 설정), 앱 열지 않음, 프로세스 없음, 화면 꺼짐, 충전 끊김 | 30/30 | 없음 | 67초 | 0.0초 | 0.8초 |

- 상태는 시나리오 시작과 끝에 `dumpsys`로 기록했다.
  - B 끝: 화면 꺼짐 30분 뒤 deep=`IDLE_PENDING`, light=`IDLE`. 실제 대기로는 deep Doze까지 가지 않았다.
  - C: `force-idle` 뒤 deep=`IDLE` 30분 유지.
  - D·E: `unforce`를 했지만 화면이 꺼져 있고 충전이 끊겨 있어서 deep=`IDLE`가 그대로였다. 그래서 D는 "Doze + rare 버킷", E는 "Doze + 절전 모드"를 함께 시험한 셈이다.
- B~E 120회 모두 한 번도 밀리지 않았다. 높은 우선순위 메시지는 Doze의 유지 관리 창을 기다리지 않고 바로 앱을 깨웠다.
- B에서 프로세스를 죽인 뒤에도 지연 최대는 0.7초였다. 메시지마다 앱 프로세스와 JS(헤드리스 태스크)를 새로 띄우는 비용이 이 정도다.
- F(설정의 강제 종료와 같은 `am force-stop`): 5회 모두 FCM 200이었지만 기기에는 하나도 오지 않았다. Android가 강제 종료된 앱에는 브로드캐스트를 보내지 않기 때문이다. 사용자가 앱을 다시 열기 전까지 계속 이렇다.
- G: 사용자가 설정 → 배터리 → 백그라운드 사용 제한 → 절전 앱에 Betro를 넣었다. 시작과 끝 모두 대기 버킷 45(restricted), `RUN_ANY_IN_BACKGROUND: ignore`였다. 앱을 열면 버킷이 올라가 이 상태가 풀릴 수 있어서 앱은 열지 않았다. 시작 때 프로세스가 없었고, 끝에는 메시지가 띄운 프로세스가 남아 있었다. 끝 상태는 deep=`IDLE_PENDING`, light=`IDLE`(B와 같다).
  - 최대 간격 67초는 보내는 쪽(Mac) 간격이 한 번 67.3초로 밀린 탓이다. 기기 쪽 지연은 0.8초를 넘지 않았다.
- A 첫 실행은 seq 16부터 기록이 끊겼다. 같은 시각에 에뮬레이터를 빌드하면서 adb 서버가 다시 시작돼 `logcat` 수집이 끊긴 것으로 보인다. 기기 쪽 문제가 아니라서 A2로 다시 쟀다.

**화면(Step 4)**

| 기기 | 결과 |
|---|---|
| 에뮬레이터 API 36.0 | `Notification.ProgressStyle`(진행 점 4개)은 보였다. 승격은 되지 않았다. 상태바 칩도 없었다 |
| 에뮬레이터 API 36.1 | 승격됐다(`FLAG_PROMOTED_ONGOING`). 상태바 칩 `341 · 21분`, 잠금화면 맨 위 카드, 알림창의 ProgressStyle이 모두 보였다 |
| S20 Ultra(Android 13) | 일반 ongoing 알림이 같은 ID(4101) 하나로 갱신됐다. 23:43 기준 Betro 알림 기록은 ID 4101 하나뿐이고, 플래그는 `ONGOING_EVENT | ONLY_ALERT_ONCE`다. 갱신 때 소리나 진동이 다시 울리지 않았다 |

- API 36.0 빌드에는 `Notification.Builder.setRequestPromotedOngoing`, `setShortCriticalText`가 없다. 이 메서드는 36.1에서 들어왔다. API 36.0 기기에서 부르면 `NoSuchMethodError`가 난다.
- 리플렉션으로 부르면 R8이 Release 빌드에서 이름을 바꿔서 깨졌다.
- 그래서 두 setter가 쓰는 extras 키(`android.requestPromotedOngoing`, `android.shortCriticalText`)를 직접 넣었다. 36.1에서 이것만으로 승격됐다. 36.0에서는 아무 일도 없고 에러도 없다.
- 승격 조건 중 이번에 맞춘 것: 채널 중요도 HIGH, `setOngoing(true)`, 제목 있음, 사용자 정의 뷰 없음, 매니페스트 `POST_PROMOTED_NOTIFICATIONS`. 권한은 일반 권한이라 따로 묻지 않는다.

### 재현 방법

- 앱: Release APK(`expo run:android --variant release`), 기기에 USB로 설치.
- 로컬 모듈 `apps/native/modules/commute-notification/`(Kotlin)
  - `show(data)`: 채널 `commute-live`(HIGH), 알림 ID 4101로 만들고 덮어쓴다. API 36 이상은 `Notification.ProgressStyle`, 그 아래는 `NotificationCompat` ongoing 알림.
  - 받은 시각을 `Log.i("CommuteSpike", …)`로 찍는다.
- `apps/native/lib/push/background.ts`: `data.spike`가 있는 메시지만 `CommuteNotification.show`로 넘긴다.
- 시나리오 순서는 스크립트 하나로 돌렸다(`adb` 명령, 시나리오마다 30분).
  - A: `svc power stayon usb`, 앱 실행 뒤 홈으로.
  - B: `stayon false`, `dumpsys battery unplug`, `am kill`, 화면 끔.
  - C: `dumpsys deviceidle force-idle`.
  - D: `unforce`, `am set-standby-bucket com.cmu02.betro rare`.
  - E: 버킷 `active`, `settings put global low_power 1`.
  - F: `low_power 0`, `am force-stop`, 5분.
  - 끝: `unforce`, 버킷 `active`, `low_power 0`, `dumpsys battery reset`, `stayon false`.
  - G(따로 실행): 사용자가 절전 앱에 넣은 뒤 `stayon false`, `dumpsys battery unplug`, 화면 끔. 버킷은 건드리지 않았다. 끝에 `dumpsys battery reset`.
- 분석: `send.ndjson`(보낸 seq, FCM 응답)과 `logcat`(받은 seq)을 맞춰 누락, 간격, 지연을 셌다.
- 호출 수: FCM 215(S20, G 30 포함). 에뮬레이터 화면 확인용 발송은 따로 몇 회.

### 2-F에 주는 결정

- **포그라운드 서비스 대안은 필요 없다.** A~E와 삼성 "절전 앱"(G)에서 높은 우선순위 FCM 데이터 메시지만으로 끊김이 없었다. 그래서 `FOREGROUND_SERVICE_*` 권한과 스토어의 포그라운드 서비스 신고도 필요 없다.
- **삼성 "절전 앱"이나 "사용하지 않는 앱 자동으로 절전" 안내는 필요 없다.** 절전 앱에 들어가도 갱신이 끊기지 않았다. 막는 것은 강제 종료(F)뿐이다.
- **오래된 메시지는 버린다.** 이번에 가장 중요한 발견이다.
  - 강제 종료 중에 보낸 F 메시지 5개는 FCM이 보관했다. 앱을 다시 열자 123~442초 늦게, 순서가 섞여 왔다.
  - 그중 seq 2·3은 23:17:20에 와서, 그 24초 전에 받은 A2의 최신 값을 덮어썼다. 실제 서비스였다면 잠금화면에 7분 전 도착 정보가 다시 떴을 것이다.
  - 서버: 메시지마다 `android.ttl`을 짧게(120초 안팎) 주고, 세션마다 같은 `collapse_key`를 준다. 그러면 FCM이 오래된 것을 보관하거나 쌓지 않는다.
  - 앱: 세션마다 마지막으로 반영한 `sentAt`(또는 서버가 주는 버전 번호)을 기억한다. 그보다 오래된 메시지는 버린다. `etaEpoch`가 이미 지난 메시지도 버린다.
- **강제 종료는 막을 수 없다.** FCM은 200을 돌려주므로 서버가 알아챌 방법도 없다. 앱을 다시 열면 최신 상태를 받아 오게 하고, 그 전까지 알림이 멈춰 있을 수 있다는 것을 도움말에 적는다.
- **승격 API는 extras 키나 정식 setter로 쓰고, 리플렉션은 쓰지 않는다.**
  - compileSdk가 36.0이면 `android.requestPromotedOngoing`, `android.shortCriticalText` extras를 직접 넣는다. 승격은 36.1 이상에서만 되고, 36.0에서는 아무 효과가 없다.
  - compileSdk를 36.1로 올릴 수 있으면 `setRequestPromotedOngoing`, `setShortCriticalText`를 쓰고 `Build.VERSION.SDK_INT_FULL`로 나눈다.
- **처리는 지금처럼 JS 백그라운드 핸들러에서 해도 된다.** 프로세스가 죽은 상태(B)에서도 0.7초 안에 끝났다. 네이티브 `FirebaseMessagingService`로 옮길 필요는 아직 없다.
- **남은 확인**: Android 16 QPR1 이상 실기기에서 Step 4(상태바 칩, 잠금화면, 삼성이면 Now Bar)를 다시 본다.

## 6. 도착 정확도 기준선

실험일: 지하철은 2026-11-10에 이미 쌓인 수집기 기록(11-05 목, 11-06 금, 11-10 화의 07:30~09:30)으로 계산했다. 버스는 2026-11-11, 11-12 07:30~09:30에 잰다(아직). 실험 코드는 로컬 브랜치 `spike/mvp2-accuracy`에 있다.

### 질문

- 공식 도착 예측만으로 7.1 기준(5분 전 예측이 ±1분 안 80%, ±2분 안 95%)을 맞추는가?
- 출퇴근 세션 하나에 시간당 몇 건의 호출이 필요한가?

### 기준

기준선을 재는 실험이라 통과와 실패가 없다. 7.1을 넘으면 "공식 예측 + 보정"을, 못 넘으면 "자체 예측 필요"를 2-C에 권고한다.

### 결과: 진행 중(지하철만)

- **지하철 공식 예측은 그대로 쓰면 7.1에 못 미친다.** 강남역 2호선에서 5분 전 예측이 ±1분 안에 든 비율은 내선 54%, 외선 47%이고, ±2분은 내선 93%, 외선 68%다.
- **예측이 약 1분 이르다.** 오차 중앙값이 내선 −59초, 외선 −69초다(예측 시각이 실제보다 앞선다).
- **이 편향을 빼면 ±2분 95%는 넘는다.** 다른 날들의 오차 중앙값을 빼고 보면 내선은 ±1분 93%, ±2분 100%, 외선은 ±1분 63%, ±2분 98%다. ±1분 80%는 내선만 넘는다.
- **`dev` 수집 간격으로는 ±1분을 확정할 수 없다.** 실제 도착 시각을 ±45초(중앙값) 범위로만 알 수 있기 때문이다. 위 비율은 그 범위의 가운데 값으로 계산한 것이다.
- 버스는 아직 재지 않았다.

### 측정값

**표본**: 사용자 결정(2026-11-10)에 따라 실제 출근 경로 대신 수집기가 모으는 노선에서 골랐다. 실제 도착을 수집기 기록과 맞출 수 있어야 하기 때문이다.

| 수단 | 구간 |
|---|---|
| 지하철 | 2호선 강남역(`statnId` 1002000222), 내선(역삼 → 강남 → 교대)과 외선 |
| 버스 | 6411 노량진역(`stId` 119000011, 순번 39, 선릉역 방면), 150 서울역버스환승센터(`stId` 101000004, 순번 35, 시흥대교 방면) |

**지하철: 계산 방법**

- 예측: 수집기 원본(R2 `raw/subway-all`, `realtimeStationArrival/ALL`)에서 강남역 행의 `recptnDt + barvlDt`. 직접 호출은 하지 않았다.
- 실제 도착: 관측 이벤트(R2 `events/subway`)에서 그 열차가 강남역에 `arrive`로 처음 잡힌 원천 시각을 상한으로, 그 직전 원천 스냅샷 시각을 하한으로 둔다. 도착은 그 사이 어딘가다. 가운데 값을 실제 도착으로 쓰고, 구간의 절반을 불확실 폭으로 적는다.
- 5분 전 예측: 실제 도착(가운데 값) 5분 전에서 ±60초 안에 나온 예측 중 5분에 가장 가까운 것 하나. 계획의 ±30초는 수집 간격이 80초라 표본이 너무 줄어서 ±60초로 넓혔다.
- 괄호 안 "확실"은 불확실 폭을 다 더해도 기준 안인 비율, "가능"은 불확실 폭을 유리하게 봤을 때의 비율이다.

**지하철: 공식 예측 그대로** (3일 합계)

| 방향 | 도착 | 평가 | ±1분 (확실~가능) | ±2분 (확실~가능) | 오차 중앙값 | 절대 오차 중앙값 | 90% | 최대 | 불확실 폭 중앙값 |
|---|---|---|---|---|---|---|---|---|---|
| 내선 | 88 | 82 | 54% (0~84%) | 93% (71~100%) | −59초 | 59초 | 115초 | 139초 | ±45초 |
| 외선 | 102 | 88 | 47% (15~58%) | 68% (51~97%) | −69초 | 72초 | 141초 | 197초 | ±43초 |

- 평가하지 못한 20건(내선 6, 외선 14)은 모두 "5분 전 ±60초 안에 나온 예측이 없음"이다.
- 날짜별 ±1분: 내선 55%, 57%, 48%. 외선 38%, 61%, 39%. 날마다 비슷하다.

**지하철: 다른 날의 오차 중앙값을 뺀 경우** (같은 날 자료로는 보정하지 않았다)

| 방향 | ±1분 (확실~가능) | ±2분 (확실~가능) | 절대 오차 중앙값 | 90% | 최대 |
|---|---|---|---|---|---|
| 내선 | 93% (39~100%) | 100% (99~100%) | 16초 | 56초 | 81초 |
| 외선 | 63% (19~94%) | 98% (80~100%) | 49초 | 92초 | 138초 |

**지하철: 원천 정보의 성격**

- `barvlDt`는 10초 단위이고 역 사이 구간마다 거의 같은 값이 나온다(전역 도착 60, 두 역 전 140~150, 세 역 전 230~240). 정차 시간이 반영되지 않은 값으로 보인다. 약 1분 이른 편향과 맞는다.
- 받는 시점에 이미 지난 정보다. 받은 시각과 `recptnDt`의 차이는 중앙값 71초(최소 38초, 90% 111초)였다(11-10 강남역 내선).
- 80초 간격으로는 강남역 행에서 "도착"(`arvlCd` 1)이 거의 보이지 않는다(135회 중 1회). 실제 도착은 열차 상태가 바뀐 스냅샷 사이로만 잡힌다.
- `barvlDt`가 0보다 큰 행이 있는 노선은 2~7호선, 9호선, 우이신설선이고, 1호선은 일부 행(677개 중 22개)만 그렇다. 8호선, 경의중앙, 공항철도, 경춘, 수인분당, 신분당, 경강, 서해, 신림, GTX-A는 모두 0이라 이 방법으로는 예측을 꺼낼 수 없다(11-09 19:59 응답 한 건 기준).

**버스**: 아직 없다.

**호출 수**

- 지하철: 직접 호출 0건. 수집기 기록만 썼다(R2 객체 1,620개, 88MB).
- 버스 `getArrInfoByRoute`: 2026-11-10 응답 확인 4건(로컬 2, Worker 2). 측정일에는 하루 480건을 부른다(대상 2개 × 30초 간격 × 2시간). 오퍼레이션 한도는 하루 1,000건이다.

### 재현 방법

- 수집기 기록 받기: R2 `betro-data`에서 `raw/subway-all/<날짜>/07-*`, `08-*`, `09-*`와 `events/subway/…`를 같은 경로로 내려받는다(`wrangler r2 object get betro-data/<키> --remote --file <경로>`).
- 지하철 평가:

  ```bash
  bun spikes/accuracy/evaluate.ts subway --dir <받은 폴더> \
    --dates 2026-11-05,2026-11-06,2026-11-10 \
    --statn 1002000222 --direction up --line line2
  ```

  `--direction up`이 내선, `down`이 외선이다(수집기 이벤트의 방향 값).
- 버스 수집: 임시 Worker `betro-spike-accuracy`(`spikes/accuracy/collect-bus-arrivals.ts`, `wrangler.jsonc`).
  - cron이 07:30~09:30 KST에 분마다 깨워 0초와 30초에 `getArrInfoByRoute`를 부르고, Durable Object(`apac`) SQLite에 응답을 쌓는다.
  - `ACTIVE_DATES`에 적은 날에만 부른다. 401이나 게이트웨이 오류를 받으면 그날은 멈춘다.
  - `GET /dump?date=YYYY-MM-DD`로 NDJSON을 받는다(`x-spike-secret`).
  - 계획은 로컬 스크립트였지만, 이틀 아침에 Mac이 켜져 있어야 하는 조건을 없애려고 Worker로 바꿨다.

### 2-C에 주는 결정 (잠정, 버스 결과 뒤 확정)

- **지하철 도착 계산**: "공식 예측 + 보정"으로 간다. 공식 예측에서 노선·방향별 편향(강남역 2호선은 약 1분)을 빼는 것만으로 ±2분 95%를 넘는다. 자체 예측을 처음부터 만들 필요는 없어 보인다.
- **±1분 80%는 `dev` 수집 간격(80초)으로 검증할 수 없다.** 실제 도착을 ±45초로만 알기 때문이다. 7.1 실사용 검증에서는 세션이 도는 역을 더 촘촘히(20~30초) 보거나, 사람이 승강장에서 도착 시각을 직접 적어 맞춰야 한다.
- **`barvlDt`가 0인 노선**(8호선, 경의중앙, 공항철도, 경춘, 수인분당, 신분당, 경강, 서해, 신림, GTX-A, 1호선 대부분)은 공식 예측이 없으므로 시간표와 열차 위치로 도착을 계산해야 한다. 이 노선들은 따로 재야 한다.
- **세션당 호출 수(지하철)**: `dev`에서는 ALL 한 번이 전 노선을 덮으므로 세션 수와 상관없이 시간당 45건이다. 세션 때문에 늘어나는 호출이 없다.
- **세션당 호출 수(버스)**: 도착 예측을 30초마다 부르면 정류장·노선 하나에 시간당 120건이다. 오퍼레이션 한도 1,000건으로는 하루에 세션 약 8시간 분량이다. 간격과 검증 인원은 버스 결과를 보고 정한다.

