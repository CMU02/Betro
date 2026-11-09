# MVP 2단계 사전 실험 결과

계획: `docs/superpowers/plans/2026-11-06-mvp-2a-experiments.md`. 설계: `docs/superpowers/specs/2026-11-05-mvp-design.md` 9장.

각 절은 같은 순서로 씁니다: 질문 / 기준 / 결과 / 측정값 / 재현 방법 / 2-C~2-F에 주는 결정.

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
