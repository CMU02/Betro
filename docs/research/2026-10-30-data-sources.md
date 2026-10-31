# Betro 데이터 소스 조사 보고서 (2026-10-30 기준)

**표기 규칙**
- **확인된 사실**: 검증자 2명 중 1명 이상이 확인했고 반박한 사람이 없는 내용입니다. 반박된 항목은 검증자가 정정한 내용으로 고쳐 넣었습니다.
- **후속 조사 (교차 검증 전)**: 2차 조사에서 직접 측정하거나 원문을 읽었지만, 다른 검증자가 다시 확인하지는 않은 내용입니다. 근거는 있지만 사실 항목보다 한 단계 약합니다.
- **확인 못 한 것**: 그럴듯하지만 공식 출처나 실측으로 확정하지 못한 내용입니다.

---

## 1) 지하철 실시간 API (swopenAPI.seoul.go.kr)

### 확인된 사실
- realtimePosition 호출 형식은 `http://swopenAPI.seoul.go.kr/api/subway/(인증키)/xml/realtimePosition/0/5/1호선`입니다. 인자 순서는 KEY / TYPE(xml, xmlf, xls, json) / SERVICE / START_INDEX / END_INDEX / subwayNm(필수)입니다. [OA-12601 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-12601&srvType=A)
- 출력 필드는 subwayId, subwayNm, statnId, statnNm, trainNo, lastRecptnDt(날짜), recptnDt(시각), updnLine(0 상행/내선, 1 하행/외선), statnTid, statnTnm, trainSttus(0 진입, 1 도착, 2 출발, 3 전역출발), directAt(1 급행, 0 아님, 7 특급), lstcarAt(1 막차)입니다. 좌표는 없습니다. [OA-12601 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-12601&srvType=A)
- 노선은 한글 노선명으로만 조회됩니다. 숫자 ID('1001')로는 데이터가 오지 않습니다. 노선명은 반드시 UTF-8로 퍼센트 인코딩해야 하며, 인코딩하지 않으면 정상 노선도 INFO-200이 나옵니다. [실측 1호선](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/1%ED%98%B8%EC%84%A0)
- 실측(20:5x KST)에서 19개 노선이 INFO-000을 반환했습니다. 1호선 1001, 2호선 1002, 3호선 1003, 4호선 1004, 5호선 1005, 6호선 1006, 7호선 1007, 8호선 1008, 9호선 1009, 경의중앙선 1063, 공항철도 1065, 경춘선 1067, 수인분당선 1075, 신분당선 1077, 우이신설선 1092, 서해선 1093, 경강선 1081, GTX-A 1032, 신림선 1094입니다. 공식 문서의 subwayId 목록에는 1081, 1093, 1094가 없습니다. [실측 신림선](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/%EC%8B%A0%EB%A6%BC%EC%84%A0)
- 다음 이름은 INFO-200(데이터 없음)이었습니다: 중앙선, 경의선, 분당선, 우이신설경전철, 김포골드라인, 김포도시철도, 인천1호선, 인천2호선, 의정부경전철, 용인경전철, 에버라인, 수인선. INFO-200은 인코딩 오류일 때도 나오므로, 미지원과 요청 오류를 응답만으로 구분할 수 없습니다. [실측 김포골드라인](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/%EA%B9%80%ED%8F%AC%EA%B3%A8%EB%93%9C%EB%9D%BC%EC%9D%B8)
- 응답 구조가 문서와 다릅니다. 성공하면 루트가 `errorMessage{status,code,message,link,developerMessage,total}`와 `realtimePositionList[]`(각 행에 totalCount, rowNum, selectedCount 포함)입니다. 실패하면 루트에 바로 `{status:500, code:"INFO-200", ..., total:0}`이 옵니다. 에러여도 HTTP 상태는 200입니다. 문서에는 list_total_count와 RESULT.CODE만 적혀 있습니다. [실측](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/1%ED%98%B8%EC%84%A0)
- updnLine 표기가 API마다 다릅니다. realtimePosition은 문자열 "0"/"1"이고, realtimeStationArrival은 "상행"/"하행"(2호선은 "내선"/"외선")입니다. OA-15799 문서의 0/1 표기는 실제 응답과 맞지 않습니다. [subway-now #2746](https://github.com/handokei/subway-now/issues/2746)
- lastRecptnDt는 "20261030"처럼 날짜만 옵니다. recptnDt는 "2026-10-30 20:55:18" 형식이고 타임존 표기가 없습니다. HTTP Date 헤더와 비교하면 9시간 차이가 나므로 KST로 보입니다(문서에는 명시 없음). [실측](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/1%ED%98%B8%EC%84%A0)
- recptnDt는 폴링 시각이 아니라 열차별 마지막 상태변화 시각처럼 움직입니다. 상태가 그대로인 열차는 경과시간(age)이 폴링 간격만큼 늘었고, 상태가 바뀐 직후의 age는 0~30초였습니다. 신분당선만 한 응답 안의 모든 열차가 같은 recptnDt(스냅샷 시각)를 공유했고 age는 0~22초였습니다. 그래서 갱신 주기를 '약 10초'로 단정할 수는 없습니다(검증자 정정 반영). [실측 신분당선](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/%EC%8B%A0%EB%B6%84%EB%8B%B9%EC%84%A0)
- 공항철도 직통(A1049, A1052)은 s2(출발) 상태로 1~3분 넘게 갱신되지 않았습니다. 다만 일반열차(2호선 3412, 공항철도 A3090 등)도 1분 넘게 갱신이 없었기 때문에, "통과역 이벤트가 없다"는 원인 해석은 확인되지 않았습니다. [실측 공항철도](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/%EA%B3%B5%ED%95%AD%EC%B2%A0%EB%8F%84)
- directAt의 문서 값은 1/0/7입니다. 실측에서 공항철도 A10xx는 1, A3090은 0이었습니다. [OA-12601 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-12601&srvType=A)
- realtimePosition에는 서울 밖 역에 있는 열차도 나옵니다(경춘선 김유정·남춘천, 경강선 여주·판교, 서해선 시흥시청, GTX-A 동탄, 공항철도 인천공항 등). 반면 도착정보 페이지에는 '서울시 이외의 역구간은 미제공(예: 광명, 서동탄, 춘천)'이라고 적혀 있습니다. [OA-12764 안내](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)
- 실시간 지하철 오픈API는 하루 최대 1,000건, 한 번에 최대 1,000건까지 요청할 수 있습니다. 인증키는 '일반'과 '실시간 지하철'을 따로 신청합니다. [이용안내](https://data.seoul.go.kr/together/guide/useGuide.do)
- 1,000건 제한은 활용사례(갤러리)에 인증키와 함께 만든 서비스를 등록하고 심사에서 승인되면 '호출 제한없이' 풀립니다. 앱은 앱스토어·구글플레이(원스토어)에 등록되어 있어야 하고, 웹은 실제 URL로 접속할 수 있어야 합니다. GitHub, APK 링크, 로컬 URL은 심사 대상이 아닙니다. 따라서 스토어 출시 전이라도 실제 웹 URL로 신청할 수 있습니다. [FAQ](https://data.seoul.go.kr/together/notice/faqList.do)
- sample 키로는 정확히 0/5 요청만 성공했습니다. 1/5, 0/4, 0/10 같은 요청은 문서상 코드인 ERROR-335가 아니라 ERROR-336('최대 1000건')을 돌려줘, 에러 코드가 실제 원인과 맞지 않습니다. [OA-12601 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-12601&srvType=A)
- realtimeStationArrival은 역명(statnNm)으로 조회합니다. 출력 필드에는 statnFid/statnTid(이전/다음역), btrainSttus(급행, ITX, 일반, 특급), barvlDt(초), btrainNo, recptnDt(도착정보 생성 시각), arvlCd(0 진입, 1 도착, 2 출발, 3 전역출발, 4 전역진입, 5 전역도착, 99 운행중) 등이 있습니다. 실제 응답에는 문서에 없는 subwayHeading과 trainCo(null)도 있었습니다. [OA-12764 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-12764&srvType=A)
- 일괄 버전은 `realtimeStationArrival/ALL`(OA-15799)입니다. sample 키로 인덱스 없이 호출하면 total 약 2,958~3,003건 중 30행이 옵니다. 문서에는 START/END가 '필수'라고 적혀 있습니다. [OA-15799 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-15799&srvType=A)
- 공식 안내에 따르면 recptnDt와 현재 시각의 차이만큼 열차가 더 진행한 것으로 보정해야 합니다. sample 키로는 '서울'역만 조회할 수 있습니다. [OA-12764 안내](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)
- 서드파티(subway-now)의 측정에 따르면 arvlCd 0 행은 실제 도착보다 60~87초 늦게 나타났고, 서울 피드 반영에 36~85초가 걸렸습니다. [#3223](https://github.com/handokei/subway-now/issues/3223) 같은 저장소는 역의 arvlCd {0,1} 창이 약 30초, realtimePosition 체류창이 약 80초라고 기록했습니다. [#2571](https://github.com/handokei/subway-now/issues/2571)
- HTTPS(443)로는 20초 동안 응답이 없어 시간초과됐고 HTTP만 응답했습니다. 응답 헤더는 Server: Apache, Access-Control-Allow-Origin: *였습니다. [subway-now #95](https://github.com/handokei/subway-now/issues/95)
- 라이선스는 공공누리 1유형(출처표시, 상업적 이용 가능)이고 원본시스템은 TOPIS, 제공부서는 미래첨단교통과(02-2133-4969)입니다. 과거 데이터는 따로 적재하지 않아 제공하지 않습니다. [OA-12601 정보](https://data.seoul.go.kr/dataList/OA-12601/A/1/datasetView.do)

### 후속 조사 (교차 검증 전)
- sample 키로 `ALL/1/5/`처럼 인덱스를 붙이면 ERROR-500이 납니다. [실측 ALL](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimeStationArrival/ALL) 서드파티 실측에 따르면 정식 키로 경로형(`/ALL`)을 부르면 전량(2,954행, 1.9MB)이 오고, start/end형은 1,000행에서 잘립니다. [ASAC-DAG](https://github.com/ASAC-DE-bigkk/ASAC-DAG/blob/73ff5665ffd5526c59de8be2969cf65dffaf468b/domains/transit/seoul_transit/api.py), [ThinkKat/metro](https://github.com/ThinkKat/metro/blob/d178e46d3a761926bd3962bb29c0adbc9cc1ca17/backend/services/collect/src/realtime_api.py)
- 2분 동안 10초 간격으로 호출해 보니 ALL과 realtimePosition 응답은 같은 시점에 바뀌었고, 바뀌는 간격은 10~30초(주로 약 20초)였습니다. [실측 ALL](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimeStationArrival/ALL)
- '분단위로 제공'이라는 문구는 과거 데이터를 제공할 수 없는 이유를 설명하는 공통 FAQ 문장이라 갱신 주기 명세로 보기 어렵습니다. [OA-12601 FAQ](https://data.seoul.go.kr/dataList/OA-12601/A/1/datasetView.do)
- 갤러리 등록 절차는 신청 → 검토(3~5일) → 승인 또는 거절입니다. 갤러리 취지는 '제공 데이터를 활용하여 제작한 내용'을 등록하는 것입니다. [갤러리](https://data.seoul.go.kr/dataVisual/gallery/galleryList.do)
- FAQ에 따르면 일반 인증키는 즉시 발급되지만 실시간 지하철 키는 제외입니다. 인증키는 여러 개 신청할 수 있습니다. [FAQ](https://data.seoul.go.kr/together/notice/faqList.do)
- 공식 메시지 표에는 일일 쿼터 초과 코드가 없습니다. ERROR-336은 한 번 요청할 때의 행 수 제한입니다. 'ERROR-337 시간당 초과'는 서드파티 기록에만 있습니다. [OA-15799 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-15799&srvType=A), [easysubway PR #405](https://github.com/AquilaXk/easysubway-backend/pull/405)
- data.go.kr의 '지하철 실시간 도착정보(일괄)'(15125683)은 서울시 포털로 연결되는 LINK일 뿐이라 우회 경로가 되지 않습니다. [15125683](https://www.data.go.kr/data/15125683/openapi.do)

### 확인 못 한 것
- directAt 값 '9'(경춘선 2029)는 재현되지 않았고 의미도 근거가 없습니다(ITX-청춘 추정은 근거 없음).
- 1,000건/일 한도가 키 단위인지 서비스(realtimePosition, 도착, ALL)별 단위인지, 일반 키로 swopenAPI를 쓸 수 있는지.
- 승인 후 '제한 없음'이 정말 무제한인지, 초당·시간당 제한이 있는지. 일일 한도를 넘었을 때 어떤 응답이 오는지.
- 실데이터를 보여주지 않는 랜딩만으로 승인되는지. 3~5일이 영업일 기준인지.
- 김포골드, 인천, 의정부, 용인 경전철이 다른 표기로 제공되는지. 서울 밖 구간 커버리지가 완전한지.
- 오픈API 원천의 공식 갱신 주기. 2014년 서울톡톡 기사의 '10초 단위 업데이트'는 '서울대중교통' 모바일 앱에 대한 설명이라 근거가 되지 않습니다. [기사](https://mediahub.seoul.go.kr/archives/173675)
- ALL 응답(약 1.9MB)을 gzip으로 받을 수 있는지.

---

## 2) 버스 실시간 API (ws.bus.go.kr)

### 확인된 사실
- 버스위치정보조회(15000332)의 오퍼레이션은 getBusPosByRouteStList, getBusPosByRtidList, getBusPosByVehIdItem, getLowBusPosByRtidList, getLowBusPosByRouteStList입니다. 실제 경로는 `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid` 등입니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- 포맷은 JSON+XML, 무료, 공공누리 1유형이며 개발단계와 운영단계 모두 '자동승인'입니다. 수정일은 2025-12-02입니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- 트래픽은 '개발계정 : 1,000 / 운영계정 : 활용사례 등록시 신청하면 트래픽 증가 가능'이고, 15000193과 15000314도 같습니다. 운영계정 상한 수치는 공개되어 있지 않습니다. GW 에러코드에 22(일일 허용량 초과)와 23(초당 허용량 초과)이 따로 있으므로 초당 한도도 별도로 존재합니다(수치는 미공개). [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- 활용가이드(20230530)에는 데이터 갱신주기 '매 5초'가 적혀 있고, 오퍼레이션마다 최대 3MB, 평균 응답 100ms, 초당 최대 30TPS입니다. 전송 암호화는 'SSL 없음', 방식은 REST(GET), XML/JSON입니다. [활용가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003552007&fileDetailSn=1)
- getBusPosByRtid의 요청은 serviceKey, busRouteId와 resultType(xml/json, 가이드에만 있음)입니다. 응답은 sectOrd, fullSectDist, sectDist, rtDist, stopFlag(0 운행중, 1 도착), sectionId, dataTm, gpsX/gpsY(맵매칭 WGS84), vehId, plainNo, busType(0 일반, 1 저상, 2 굴절), lastStTm, nextStTm, isrunyn, trnstnid, islastyn, isFullFlag, posX/posY(GRS80), lastStnId, congetion, nextStId입니다. [활용가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003552007&fileDetailSn=1)
- 좌표 필드 이름이 오퍼레이션마다 다릅니다. getBusPosByRtid는 gpsX/gpsY이고, RouteSt, VehId, LowRtid는 tmX/tmY(WGS84)입니다. 웹 명세에는 getBusPosByRtid의 GRS80 Y가 'posy'(소문자)로 적혀 있습니다. congetion 설명은 웹이 '0 없음, 3 여유, 4 보통, 5 혼잡, 6 매우혼잡'이고, 가이드는 여기에 'routeType 6이면 잔여 좌석 수(99 없음)'를 덧붙입니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- getBusPosByVehId 응답에는 노선 ID가 없습니다. getLowBusPosByRtid는 getBusPosByRtid와 비슷하지만 nextStId가 없습니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- getBusPosByRouteSt의 sectDist는 문서에 '구간옵셋거리(Km)'로 적혀 있지만 샘플 값은 183, 186, 30입니다. [활용가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003552007&fileDetailSn=1)
- 가이드 오류코드: 0 정상, 1 시스템 오류, 2 잘못된 쿼리, 3 정류소 없음, 4 노선 없음, 5 잘못된 위치, 6 실시간 정보를 읽을 수 없음, 7 경로 없음, 8 운행 종료. 응답 구조는 ServiceResult > msgHeader(headerCd, headerMsg, itemCount) > msgBody > itemList입니다. [활용가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003552007&fileDetailSn=1)
- 잘못된 키로 부르면 ServiceResult가 아니라 HTTP 401과 JSON `{"error":"Unauthorized","message":"유효하지 않은 서비스키입니다: 등록되지 않은 서비스키","status":401}`이 옵니다(Access-Control-Allow-Origin: *). 존재하지 않는 경로에서도 같은 401이 나오므로, 이 응답만으로는 엔드포인트가 살아 있다고 증명할 수 없습니다. [ws.bus.go.kr](http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid)
- `https://ws.bus.go.kr`과 `https://api.bus.go.kr`은 15초 타임아웃으로 실패했습니다(단일 네트워크에서의 결과). [ws.bus.go.kr](http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid)
- 노선정보조회(15000193)의 오퍼레이션은 getRouteInfoItem(/getRouteInfo), getRoutePathList(/getRoutePath), getBusRouteList(/getBusRouteList), getStaionsByRouteList(/getStaionByRoute)입니다. 가이드(20230308)의 갱신주기는 '매일 새벽 5시'입니다(검증자 정정 반영). [15000193](https://www.data.go.kr/data/15000193/openapi.do)
- getRoutePath는 busRouteId를 받아 no, gpsX/gpsY, posX/posY 좌표 목록을 줍니다. 정류소나 구간 경계 필드는 없습니다. [노선 가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002698621&fileDetailSn=1)
- getStaionsByRouteList는 seq, section, station, stationNm, gpsX/gpsY, fullSectDist, routeType(1 공항, 2 마을, 3 간선, 4 지선, 5 순환, 6 광역, 7 인천, 8 경기, 9 폐지, 0 공용), sectSpd, arsId, transYn 등을 줍니다. 웹 명세의 routeType 설명은 3~6만 적혀 있어 더 좁습니다. [노선 가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002698621&fileDetailSn=1)
- getBusRouteList는 가이드상 strSrch(노선번호)가 필수이고(웹 명세는 '옵션'), 전체 목록을 한 번에 받는 파라미터가 없습니다. 가이드는 busRouteId를 열린데이터광장 엑셀에서 참조하라고 안내합니다. [노선 가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002698621&fileDetailSn=1)
- 서울 전체 버스를 한 번에 주는 위치 엔드포인트는 공식 목록에 없습니다. 위치 조회는 모두 노선 또는 차량 단위입니다. [api.bus.go.kr 목록](http://api.bus.go.kr/contents/sub02/svcList.html)
- OA-1095 페이지에는 아직 '국가정보자원관리원 화재(25.9.26.)로 인해 신규 인증키 발급은 불가'라는 문구가 있고, 노선별 정류소 xlsx가 대체로 매월 올라옵니다(최신 20260902). OA-1093에는 화재 문구가 없습니다. [OA-1095](https://data.seoul.go.kr/dataList/OA-1095/A/1/datasetView.do)
- OA-1093은 9개 API를 소개하고, 라이선스는 공공누리 1유형입니다. [OA-1093](https://data.seoul.go.kr/dataList/OA-1093/A/1/datasetView.do)
- 버스도착정보(15000314)에는 getArrInfoByRouteAllList(`/arrive/getArrInfoByRouteAll`)가 있고, 개발계정은 1,000, 포맷 표기는 XML입니다. [15000314](https://www.data.go.kr/data/15000314/openapi.do)
- TAGO 버스위치(15098533)는 cityCode+routeId 단위로 조회하고, 개발계정 10,000, 갱신 '실시간(10~20초)'입니다. HTTPS 연결은 됩니다(가짜 키로 403 응답). 서울이 포함되는지는 미확인입니다. [15098533](https://www.data.go.kr/data/15098533/openapi.do)
- TOPIS 자료에 따르면 차량 위치는 정해진 주기와 특정 지점(교차로, 정류소) 두 가지 방식으로 전송됩니다. 주기의 초 값은 나와 있지 않습니다. [TOPIS BIS PDF](https://seoulsolution.kr/sites/default/files/vimeo/3.%20TOPIS%20Bus%20Information%20System.pdf)

### 후속 조사 (교차 검증 전)
- **위치 필드 해석.** 공개된 9404번 실제 응답 15,753건을 대조한 결과입니다. sectOrd는 차량이 마지막으로 지난 정류소의 getStaionByRoute seq와 100% 일치했습니다(lastStnId = seq=sectOrd 행의 station). sectionId와 fullSectDist×1000은 seq=sectOrd+1 행과 일치했습니다. [transit-log 9404](https://github.com/capstone-ootd/transit-log/tree/main/data/100100391)
- **단위.** getBusPosByRtid의 sectDist와 fullSectDist는 km, getStaionByRoute의 fullSectDist는 m(정수)입니다. sectDist가 fullSectDist보다 큰 경우는 0건이었습니다. [transit-log](https://github.com/capstone-ootd/transit-log/tree/main/data/100100391), [getStaionByRoute 문서](http://api.bus.go.kr/contents/sub02/getStaionByRoute.html) 2026년 개인 README의 예시로 보면 getBusPosByRouteSt의 sectDist는 m입니다. [BusR README](https://github.com/metapbl/BusR/blob/main/README.md)
- **rtDist는 차량 위치가 아닙니다.** 같은 노선이면 모든 차량이 같은 값을 받는 상수입니다(9404 전부 56, 162 전부 37.7). 162번에서는 getRouteInfo.length(37.7)와 같았지만, 9404는 구간거리 합 98.6km와 달랐고 0이 오는 경우도 있었습니다. [hanjari-ai 샘플](https://github.com/YONGJI04/hanjari-ai/tree/main/data/sample/20260930), [162 routeInfo](https://github.com/WasVelinn/ai/blob/main/Source/07_python/data/ch14_1busInfo.xml)
- nextStId는 '다음 주요정류소'입니다. 바로 다음 정류소와 같은 경우는 약 25~29%뿐이었습니다. [getBusPosByRtid 문서](http://api.bus.go.kr/contents/sub02/getBusPosByRtid.html)
- 순환 노선(종로03)은 같은 정류소 ID가 두 순번(staOrd 1, 30)에 나오므로, 정류소 ID로 조인하면 위치가 틀어집니다. [jr03 샘플](https://github.com/YONGJI04/hanjari-ai/blob/main/data/sample/20260930/jr03_arr_131133.json)
- dataTm 간격의 중앙값은 21초였습니다(수집 간격이 20초라 이보다 짧은 값은 측정 불가). 위치가 뒤로 가는 경우는 드물었습니다(sectOrd 감소 11/5,974건). [transit-log README](https://github.com/capstone-ootd/transit-log/blob/main/README.md)
- 공식 FAQ의 트래픽 정의는 '하나의 서비스키로 하루 동안 호출할 수 있는 건수'이고, 자정(00시)에 초기화되며, 예시는 오퍼레이션 단위입니다. 증설은 운영계정 전환 후 변경신청으로 하며 '서비스 부하 상황에 따라 일부 제한될 수 있습니다'라는 단서가 있습니다. 서비스키는 계정당 1개이고, 재발급하면 기존 키가 폐기됩니다. [data.go.kr FAQ](https://www.data.go.kr/bbs/faq/selectFaqList.do)
- api.bus.go.kr 자체 에러 안내에는 '7 일시 사용중지된 키', '8 요청 제한 초과'가 있습니다. [errGuide](http://api.bus.go.kr/contents/sub02/errGuide.html)
- 15000332의 활용신청 수는 16034(2025-11) → 16926(2026-06) → 17824(2026-10-30)로 늘었습니다. 화재 이후에도 신규 신청이 처리되고 있다는 정황입니다. [Wayback 2026-06](http://web.archive.org/web/20260615174612id_/https://www.data.go.kr/data/15000332/openapi.do) 공공데이터포털은 2025-10-23에 정상화되었다고 보도됐습니다. [경향신문](https://www.khan.co.kr/article/202510231843001)
- **상충 주의.** api.bus.go.kr 소개 페이지에는 '당해 오픈 API 서비스는 상업적으로 이용 불가합니다.'라고 되어 있고, data.go.kr은 공공누리 1유형(상업적 이용 가능)으로 표기합니다. [api.bus.go.kr 소개](http://api.bus.go.kr/contents/sub01/wisOpenApi.html)

### 확인 못 한 것
- 운영계정 증설의 숫자 상한과 승인 기준. 30TPS가 키별 제한인지 서비스 전체 용량인지. 일일 한도가 오퍼레이션별인지 키 합산인지.
- 화재 문구가 data.go.kr 신규 키 발급에도 해당하는지(정황상 해제되었을 가능성이 높음). 직접 키를 받아 호출해 봐야 확정됩니다.
- 한도 초과 시 ws.bus.go.kr의 실제 응답 형식(headerCd 8인지, 401/429인지, GW 22/23인지).
- resultType을 생략했을 때의 기본값과 JSON 래핑 구조. 실제 응답 키가 posY인지 posy인지.
- 마을버스(routeType 2) 위치가 buspos로 제공되는지. TAGO에 서울이 포함되는지. 경기 GBIS는 조사하지 않았습니다.
- getRoutePath 폴리라인 구간 길이가 fullSectDist와 얼마나 맞는지. stopFlag=1인데 sectDist 비율이 0.1 이상인 경우가 왜 생기는지.
- 상업적 이용 문구가 상충할 때 어느 쪽이 우선하는지.

---

## 3) 지하철 시간표

### 확인된 사실
- OA-101(역코드로 열차 시간표 검색)의 갱신주기는 '비정기'입니다. 설명란은 1~9호선, FAQ는 1~8호선으로 서로 다르게 적혀 있지만, 실제로 9호선 데이터도 나옵니다. [OA-101](https://data.seoul.go.kr/dataList/OA-101/S/1/datasetView.do)
- SearchSTNTimeTableByIDService의 경로는 `/{START}/{END}/{STATION_CD}/{WEEK_TAG}/{INOUT_TAG}/`이고, 행마다 TRAIN_NO, ARRIVETIME, LEFTTIME, EXPRESS_YN 등 17개 필드가 있습니다. 9호선 TRAIN_NO는 E/C 접두로 옵니다. [실측 0151](http://openapi.seoul.go.kr:8088/sample/json/SearchSTNTimeTableByIDService/1/5/0151/1/1/)
- 이 API는 1~9호선과 코레일 직결 구간(천안, 신창, 오이도, 금정, 대화)에서만 데이터를 줍니다. 공항철도, 신분당, 경의, 수인분당, 서해, 경강, 김포 역은 INFO-200입니다. [실측 4201](http://openapi.seoul.go.kr:8088/sample/json/SearchSTNTimeTableByIDService/1/1/4201/1/1/)
- 공식 명세는 없지만 CSV 건수 대조로 확인한 값입니다. WEEK_TAG는 1 평일, 2 토요일, 3 일요일·공휴일입니다(토요일과 일요일 건수가 다른 0200역으로 검증). INOUT_TAG는 1이 상행/외선, 2가 하행/내선과 건수가 일치합니다. 4나 3 같은 값은 INFO-200입니다. [실측 0200](http://openapi.seoul.go.kr:8088/sample/json/SearchSTNTimeTableByIDService/1/1/0200/2/1/)
- 서울교통공사 CSV(15098251)는 로그인 없이 받을 수 있습니다. 페이지 판은 _20260901이지만 실제 받은 파일명은 _20260914.csv입니다. 컬럼은 호선, 역사코드, 역사명, 주중주말(DAY/SAT/END), 방향(IN/OUT 또는 UP/DOWN), 급행여부(1/0), 열차코드, 도착·출발시간, 출발역, 도착역 등입니다. 24시는 익일 00시, 25시는 익일 01시를 뜻합니다. odcloud API로 받으면 역사코드가 integer 타입이라 앞자리 0이 사라질 수 있습니다. [15098251](https://www.data.go.kr/data/15098251/fileData.do)
- CSV는 cp949, 423,107행입니다(DAY 159,263 / SAT 131,926 / END 131,918). (호선, 요일, 열차코드) 조합은 12,565개이고, 열차코드가 trip id 역할을 합니다. 예를 들어 1호선 DAY K802는 구로(05:00 출발)부터 동두천(06:40 도착)까지 41개 역을 가집니다(검증자 정정: 44개가 아님). [CSV](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007671122&fileDetailSn=1)
- 1호선 역코드는 102개이며 코레일 구간(경부 1701~1729, 장항 1401~1408, 경인 1801~1823, 경원 1901~1919, 서동탄, 광명)이 들어 있습니다. 3호선은 K 접미(3002K), 4호선은 K 접두(K4302) 직결 열차가 있습니다. [CSV](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007671122&fileDetailSn=1)
- 결측 표기(검증자 정정 반영). CSV에는 빈칸 25,130행 외에 '00:00:00'이 7,074행 있고, 대부분 1호선 급행 열차의 중간역입니다. API는 시발·종착역 자리에 00:00:00을 넣습니다. 따라서 00:00:00은 어디서든 null로 처리해야 하고, 중간역도 도착이나 출발 한쪽만 있을 수 있습니다. [15098251](https://www.data.go.kr/data/15098251/fileData.do)
- 실시간 trainNo와 CSV를 비교하면, 1호선은 K/S 접두를 떼고 4자리로 0을 채우면 맞고(0186↔S186), 4호선은 일부에 K 접두(4327↔K4327), 9호선은 C 접두(9207↔C9207, 급행은 E)가 붙습니다. 3·5·6·7·8호선은 번호가 같습니다. '서울'/'서울역', '광나루(장신대)' 같은 역명 표기 차이 때문에 매칭이 안 되는 경우가 있습니다. [실측 4호선](<http://swopenapi.seoul.go.kr/api/subway/sample/xml/realtimePosition/0/5/4호선>)
- 2호선 본선은 번호가 맞지 않습니다. CSV 본선 코드는 20~26xx인데 실시간은 3xxx, 4xxx 등입니다. 지선(1685, 5681)은 그대로 일치합니다. [실측 2호선](<http://swopenapi.seoul.go.kr/api/subway/sample/xml/realtimePosition/0/5/2호선>)
- KRIC `trainUseInfo/subwayTimetable`은 이름이 '열차별'이지만 실제로는 역 단위 조회입니다. 요청은 serviceKey, format, dayCd(7 토, 8 평일, 9 휴일), lnCd, railOprIsttCd, stinCd이고, 출력에 trnNo가 있습니다. S1은 운영기관 코드이고 역은 stinCd입니다. [KRIC id=162](https://data.kric.go.kr/rips/M_01_02/detail.do?id=162&service=trainUseInfo&operation=subwayTimetable)
- `subwayTimetableExp`(급행, 2026-03-09 등록)는 출력에 exptCd가 추가됩니다. 잘못된 키로 부르면 존재하지 않는 경로에서도 resultCode 30이 나오므로, 이 응답으로는 엔드포인트가 살아 있는지 알 수 없습니다(검증자 정정). [KRIC id=434](https://data.kric.go.kr/rips/M_01_02/detail.do?id=434&service=trainUseInfo&operation=subwayTimetableExp)
- KRIC id=900 '전체_도시철도운행정보_20260630.xlsx'는 키 없이 GET으로 받을 수 있습니다(17,949,564바이트, 223,425행, 13개 컬럼). 업데이트주기는 '없음', 차기등록예정일은 2032-03-30입니다. [KRIC id=900](https://data.kric.go.kr/rips/M_01_01/detail.do?id=900)
- id=900에서 코레일 노선(경의중앙, 수인분당, 경춘, 서해, 경강 등)은 정차역마다 한 행이고, 요일은 평일과 휴일만 있으며 기준일은 2026-05-31입니다. [id=900 파일](https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1)
- 비코레일 노선은 열차당 한 행에 역과 시각을 묶어 담습니다(신분당 'D19-10:17+…', 공항철도 '001+06:00+…', 우이신설 '001-:+…', 인천1 ',' 구분, 의정부 '/' 구분, 인천2와 에버라인은 '운행시격' 텍스트). 요일 표기와 기준일도 기관마다 다릅니다(우이신설 2022-05-30, 공항철도 2025-12-31, 신분당 2026-06-18, 신림 2025-09-23). [id=900 파일](https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1)
- 코레일 노선은 실시간 번호에 K를 붙이면 KRIC 번호와 같습니다(2237↔K2237). 공항철도와 우이신설은 번호가 그대로 같습니다. 신분당은 실시간 1~2자리, KRIC B002~B344로 서로 맞지 않습니다. KRIC '서울 도시철도 1호선'의 정수 번호가 우이신설 번호와 겹치므로 노선명으로 먼저 걸러야 합니다. [실측 경의중앙선](<http://swopenapi.seoul.go.kr/api/subway/sample/xml/realtimePosition/0/5/경의중앙선>)
- 공항철도 직통 A1047은 KRIC상 서울 21:30 출발인데, 실시간으로는 20:58에 이미 인천공항1터미널에 있었습니다. 일반열차 A3090은 근접했습니다. [id=900 파일](https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1)
- TAGO 지하철(15098554)의 역별 시간표는 dailyTypeCode(01 평일, 02 토, 03 일)와 upDownTypeCode(U/D)를 받습니다. 응답 필드 상세는 페이지에 없습니다. [15098554](https://www.data.go.kr/data/15098554/openapi.do)
- 국가철도공단 15041665/15041674는 LINK형이고 엔드포인트 명세가 없습니다. [15041665](https://www.data.go.kr/data/15041665/openapi.do)
- MobilityData 카탈로그와 feeds_v2.csv에서 한국 GTFS 피드를 찾지 못했습니다. [mobility-database-catalogs](https://github.com/MobilityData/mobility-database-catalogs)
- 서드파티 seoulriders README도 '열차코드 = trip id', KRIC 역명 축약(디지털미디어시티→디엠시) 등 같은 경험을 기록하고 있습니다(행 수는 이전 판 기준). [README](https://github.com/circularsquare/maps/blob/main/riders/seoulriders/README.md)

### 후속 조사 (교차 검증 전)
- **2호선 본선 규칙.** 실시간 trainNo의 끝 3자리 앞에 '2'를 붙이면 OA-22750 시간표 trainno가 됩니다. 공개 캡처 74대 중 72대가 방향, 행선지, 시발시각까지 맞았고, 오늘 라이브 표본 5대도 모두 맞았습니다. 맞지 않은 9001과 9003은 시간표에 없는 번호입니다. [subway-now fixtures](https://github.com/handokei/subway-now/tree/dev/backend/alarm-worker/src/__tests__/fixtures), [실측](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/2%ED%98%B8%EC%84%A0)
- 앞자리(2/3/4/6/7/8)는 시간대에 따라 바뀌고, 성수 번호 변경 때 2→4, 3→6으로 바뀐 사례가 5건 있었습니다. 앞자리는 키로 쓰면 안 됩니다. [후속표](https://github.com/handokei/subway-now/blob/dev/backend/alarm-worker/src/data/line2RenumberSuccessors.json) 열차는 성수에서 번호가 바뀝니다. 저녁 실제 운행은 시간표보다 +8~+16분 어긋났습니다. [#3158](https://github.com/handokei/subway-now/issues/3158)
- 동시에 운행 중인 본선 열차끼리 끝 3자리가 겹친 적은 없었습니다. 지선끼리는 겹치므로(1510/5510) 지선은 4자리 전체를 키로 써야 합니다. [fixtures](https://github.com/handokei/subway-now/tree/dev/backend/alarm-worker/src/__tests__/fixtures)
- OA-22750 getTrainSch: 2호선 trainno는 2xxx이고 기준일(crtrYmd)이 20250619로 오래되었습니다. 신분당은 SA###(신사행)/GW###(광교행) 회차 번호이고, 차량이나 편성 필드는 없습니다. [getTrainSch 신분당](http://openapi.seoul.go.kr:8088/sample/json/getTrainSch/1/5/%20/N/%EC%83%81%ED%96%89/%ED%8F%89%EC%9D%BC/%EC%8B%A0%EB%B6%84%EB%8B%B9%EC%84%A0/SA001)
- 신분당 실시간 trainNo '2'는 신사에서 방향을 바꾼 뒤에도 같은 번호였습니다. 회차 번호가 아니라 차량 단위 ID로 보입니다. 이 노선의 recptnDt는 요청 시각과 같았습니다. [실측 신분당선](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/%EC%8B%A0%EB%B6%84%EB%8B%B9%EC%84%A0)
- KRIC 코드표(2026.07.11): AR 공항(lnCd A1), DX 신분당(D1), GX GTX-A(lnCd A, 동탄 X111만 SR), KR 코레일, SW 서해철도. dayCd는 0 전요일, 1~7 일~토, 8 평일, 9 휴일입니다. [KRIC 자료실](https://openapi.kric.go.kr/rips/M_04_02/detail.do?id=17), [코드표 파일](https://openapi.kric.go.kr/rips/download.file?answerId=17&fileId=1&id=17&type=L)
- 공항철도는 2026-10-23부터 직통을 하루 52회에서 56회로 늘렸습니다. [AREX 보도](https://www.arex.or.kr/contentView.do?menuNo=MN202602270000000001&contentNo=CT202610210000000001&etcNo=) 공식 직통 시각표는 방향별 28회이고 열차번호가 없으며, 08:51 이후 슬롯은 id=900과 대부분 다릅니다. [직통 시각표](https://www.airportrailroad.com/train/express/info) A1049는 파일보다 약 1시간 40분 이르게 달렸습니다. 번호가 시각 순 일련번호라 뒤 번호가 밀렸다는 해석은 표본 2건으로 세운 추정입니다. [실측 공항철도](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/%EA%B3%B5%ED%95%AD%EC%B2%A0%EB%8F%84)
- 코레일 시간표 게시판에서 최신 XLSX를 받을 수 있습니다. 경의중앙·경춘·서해·1호선은 2026.9.1., 수인분당·안산과천은 8.22., 경강은 3.23. 시행분이고, 10.30. 버스 파업 임시 시각표도 있습니다. [korail 게시판](https://www.korail.com/com/userBoard.do?schBcid=ticketTable&mode=list&page=1) 시트는 평일/휴일 두 종뿐입니다. [XLSX 예](https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c7905b490.xlsx) id=900과 비교하면 경의중앙과 수인분당은 이미 낡았고, 경강과 서해는 거의 일치합니다. [korail 게시판](https://www.korail.com/com/userBoard.do?schBcid=ticketTable&mode=list&page=1)
- GTX-A는 KRIC 표준데이터 파일에 없고, 추가 시점은 '협의 중, 미정'입니다. [KRIC 답변](https://data.kric.go.kr/rips/M_04_04/detail.do?id=110) 제3자 실측에 따르면 subwayTimetable로는 GTX-A 평일·휴일 각 402편을 받을 수 있고, dayCd 7은 대부분 기관에서 03을 돌려줍니다. [easysubway PR #906](https://github.com/AquilaXk/easysubway-data/pull/906), [#903](https://github.com/AquilaXk/easysubway-data/issues/903)
- KRIC 스스로 과거 subwayTimetable이 갱신되지 않았다고 인정한 적이 있습니다. [KRIC 답변](https://data.kric.go.kr/rips/M_04_04/detail.do?id=19&page=8) 코레일 시각표 데이터(15052169)의 이용허락범위는 '제한 없음'입니다. [15052169](https://www.data.go.kr/data/15052169/fileData.do)

### 확인 못 한 것
- KRIC stationTimetable의 orgStinCd/tmnStinCd 출력 필드(검증자 의견이 엇갈림). 정식 키로 KRIC 엔드포인트가 동작하는지.
- K/S/C/E 접두와 EXPRESS_YN G/D의 공식 의미. (열차, 역) 중복 1,546건의 원인.
- 코레일과 공항철도가 토요일에 휴일 시간표를 쓴다고 명시한 공식 문구. OA-22750의 공휴일 처리.
- 2호선 앞자리와 9xxx 열차의 공식 의미. 신분당 차량번호를 회차에 잇는 규칙. GTX-A 실시간 '0101'과 KRIC 'X0001'의 대응.
- KRIC live API에 공항철도 10-23 개정이 반영되었는지. korail.com 게시판 자동 수집의 약관.
- 15125762(코레일 운행계획)에 광역전철이 포함되는지.

---

## 4) 선로 모양과 역 좌표

### 확인된 사실
- 역사마스터(OA-21232)는 TOPIS 원천이고 공공누리 1유형, 갱신 '수시', 데이터 갱신일 2026.10.22입니다. 페이지의 '서비스 종료' 문구는 모든 페이지에 들어 있는 숨김 템플릿(display:none)이라 이 데이터셋이 종료됐다는 뜻이 아닙니다(검증자 정정). API도 정상 응답합니다. [OA-21232](https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do)
- `subwayStationMaster` 응답은 BLDN_ID, BLDN_NM, ROUTE, LAT, LOT이고 list_total_count는 784입니다. 값은 문자열로 오고, 측지계 표기는 없습니다. [실측](http://openapi.seoul.go.kr:8088/sample/json/subwayStationMaster/1/5/) sample 키로는 1~5건만 조회됩니다. [실측 ERROR-335](http://openapi.seoul.go.kr:8088/sample/json/subwayStationMaster/780/784/)
- SearchInfoBySubwayNameService(OA-121)는 STATION_CD, STATION_NM, LINE_NUM, FR_CODE를 줍니다. 예: 대곡은 서해선 103C/S11, 3호선 1953/314, GTX-A 9002/X103, 경의선 0300/K322. 역명은 정확히 일치해야 검색되며, GTX-A 서울역은 '서울'로 검색해야 나옵니다(9005/X106). [실측 대곡](http://openapi.seoul.go.kr:8088/sample/json/SearchInfoBySubwayNameService/1/5/%EB%8C%80%EA%B3%A1)
- 'statnId 뒷자리 = FR_CODE' 규칙은 일부에서만 맞습니다. 1호선 코레일 구간(광명 1001075410/P144-1, 수원 1001080155/P155, 신창 1001080176/P177)과 지선(234-4 → 002344)에서는 다릅니다. 그래서 1~9호선을 포함한 모든 노선에 명시적 매핑 테이블이 필요합니다(검증자 정정). [역정보 xlsx](https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-12764&seqNo=&seq=57&infSeq=2)
- '실시간도착_역정보(20260902).xlsx'의 컬럼은 SUBWAY_ID, STATN_ID, STATN_NM, 호선이름이고 696행, 19개 노선입니다. 첨부는 2024.08~2026.09 사이 24개이고 일부 달은 빠져 있습니다. 김포골드, 교외선, 의정부, 용인은 목록에 없습니다. [역정보 xlsx](https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-12764&seqNo=&seq=57&infSeq=2)
- OA-12764 페이지에는 역명 예외 목록이 있습니다(응암 → 응암순환(상선), 대모산입구 → 대모산 등). [OA-12764](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)
- OSM에는 신림선(14191876/7), 서해선(8725314/5, 16244687/8), GTX-A(17413294/6, 18828088/9), 교외선, 김포골드, 우이신설 relation이 있습니다. bbox에 따라 개수가 달라집니다(232~234). 품질 문제도 있습니다. 예를 들어 GTX-A 17413294/6에는 성남 stop이 없습니다. [OSM relation](https://www.openstreetmap.org/relation/18828088)
- OSM 신림선 relation 14191877은 stop 11개와 way 하나(노드 117개, oneway=yes, tunnel=yes)로 되어 있고, stop ref는 S401~S411(FR_CODE와 같음)입니다. [OSM way](https://api.openstreetmap.org/api/0.6/way/957436187.json)
- OSM ref는 일부만 채워져 있습니다(검증자 정정). 2호선은 신도림과 성수지선 4개 역, 9호선은 김포공항(902)과 마곡나루(905)를 뺀 1단계 여러 역과 3단계 전체가 비어 있습니다. GTX-A는 X101, X102, X103, X105, X106, X108, X111이 있고 구성만 없습니다. [Overpass](https://overpass-api.de/api/interpreter)
- ODbL: 렌더링 결과(Produced Work)는 어떤 라이선스로든 낼 수 있습니다. 하지만 OSM 데이터나 파생 DB를 남에게 제공하면 ODbL을 유지해야 하고, 요청이 오면 제공해야 하며, 출처를 표시해야 합니다. 이 의무는 Public Use일 때만 생깁니다. [OSMF FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ)
- Collective Database 가이드라인: OSM 데이터셋과 비OSM 데이터셋을 DB 키로 연결해도 독립으로 볼 수 있습니다. 단, 같은 지역에서 같은 데이터 유형(예: 선로)은 전부 OSM이거나 전부 비OSM이어야 합니다. [가이드라인](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline)
- 서울교통공사 1~8호선 역 좌표 CSV(15099316)는 276개 역에 외부역코드(FR_CODE)와 위경도가 있고, 이용허락 제한이 없으며 측지계 표기는 없습니다. [15099316](https://www.data.go.kr/data/15099316/fileData.do)
- 도시철도 전체노선정보(15041666)에는 좌표나 선형 정보가 없습니다. [15041666](https://www.data.go.kr/data/15041666/openapi.do)
- 전국도시철도역사정보표준데이터(15013205)의 주요 항목에 '역의 위도·경도'가 있습니다. 현재 파일은 20241231 기준, 1073행입니다(검증자 정정). [15013205](https://www.data.go.kr/data/15013205/standard.do)
- 연속수치지형도(15059721)는 1:5,000과 1:25,000, SHP/NGI 형식, 공공누리 1유형입니다. 레이어 목록은 페이지에 없습니다. [15059721](https://www.data.go.kr/data/15059721/fileData.do)
- Esri KR의 행안부 지하철 노선 레이어는 기준일 2026.04.30, EPSG:3857이고 '신림선 제외'라고 밝히며 'All rights reserved by MOIS'입니다. [ArcGIS item](https://www.arcgis.com/sharing/rest/content/items/8b8721ad08e5455196f1e516a244cecc?f=json)
- V-World WMS/WFS 레이어 목록에는 철도나 지하철 레이어가 없습니다. [V-World](https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do)

### 후속 조사 (교차 검증 전)
- statnId를 좌표나 BLDN_ID에 직접 잇는 공식 매핑 테이블은 찾지 못했습니다. [OA-12764](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)
- 696개 STATN_ID를 마스터 784건(제3자 덤프 3개가 서로 같음)에 조인한 결과, 656개는 같은 노선 그룹에서, 35개는 다른 ROUTE 레코드(공용역)에서, 5개는 수동 별칭(시우/원곡, 한국항공대/화전, 운정중앙/운정, 세종왕릉/세종대왕릉, 응암순환/응암)으로 붙었습니다. 좌표를 못 얻은 역은 0개였습니다. [마스터 덤프](https://github.com/0-virus/WhereToMeet/blob/HEAD/data/raw/seoul-rail-20261002.json)
- STATION_CD 799개 중 768개가 BLDN_ID와 같은 값이고, 그중 762개는 역명도 같았습니다. 나머지 6개는 개명 사례입니다. 두 코드는 같은 체계로 보입니다(추론). [STATION_CD 덤프](https://github.com/k002bill2/LiveMetro/blob/HEAD/%EC%84%9C%EC%9A%B8%EA%B5%90%ED%86%B5%EA%B3%B5%EC%82%AC_%EB%85%B8%EC%84%A0%EB%B3%84%20%EC%A7%80%ED%95%98%EC%B2%A0%EC%97%AD%20%EC%A0%95%EB%B3%B4.json) 마스터에 없는 STATION_CD는 31개입니다(까치산 0200, GTX-A 0008~0011 등). [실측 수서](http://openapi.seoul.go.kr:8088/sample/json/SearchInfoBySubwayNameService/1/5/%EC%88%98%EC%84%9C/)
- 마스터는 노선별 역 레코드 단위이고 좌표도 노선마다 다릅니다('서울' 레코드끼리 최대 약 509m 차이). 7호선 까치울~부평구청은 27xx와 37xx로 이중 등재되어 있습니다. [마스터 덤프](https://github.com/0-virus/WhereToMeet/blob/HEAD/data/raw/seoul-rail-20261002.json)
- 마스터 좌표와 OSM 역 노드 526개의 거리는 중앙값 24m, p95 107m였고 평균 편차는 약 0.4m로 계통 오차가 없었습니다. 따라서 WGS84 계열로 보입니다(추론). [Overpass](https://overpass-api.de/api/interpreter)
- 출처마다 역명 시점이 다릅니다. 마스터는 원곡·지제, OA-121은 시우·평택지제, 실시간 xlsx는 시우·지제를 씁니다. 실시간 응답 안에서도 '서울역'과 '서울'로 다르게 나옵니다. [실측 자양](http://openapi.seoul.go.kr:8088/sample/json/SearchInfoBySubwayNameService/1/5/%EC%9E%90%EC%96%91/)
- GTX-A statnId는 349와 352가 비어 있습니다(미개통역 예약으로 추정). [OA-12764](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)

### 확인 못 한 것
- 국가공간정보포털 '철도중심선'의 좌표계와 연도(호스트 접속 불가). [nsdi](http://data.nsdi.go.kr/dataset/20180927ds0065)
- 행안부 TL_SPSB_RLWAY(지하철선로) 레이어가 실제로 있는지와 그 조건(페이지 접속 불가). [juso](https://m1.juso.go.kr/addrlink/elctrnMapProvd/geoDBDwldList.do?menu=)
- 마스터 좌표의 공식 측지계와 대표점. 마스터 784건 전체를 정식 키로 다시 받은 결과.
- OSM GTX-A 서울역~수서 구간 선로가 있는지, 미개통 구간 태그 상태. KRIC GIS 선형 제공 여부. ODbL 적용 범위에 대한 법률 판단.

---

## 5) 규모와 호출량 추정

### 확인된 사실
- 2026년 1월 기준 서울 시내버스는 64개사, 396개 노선, 인가 7,383대, 운행 7,019대, 예비 364대입니다. 같은 부서의 다른 게시물은 예비를 353대로 적고 있습니다. [시내버스 현황](https://news.seoul.go.kr/traffic/archives/300)
- 유형별로는 간선 134노선/운행 3,423대, 지선 210/3,253, 광역 10/155, 맞춤 26/44, 순환 2/20, 심야 14/124입니다. [시내버스 현황](https://news.seoul.go.kr/traffic/archives/300)
- 마을버스는 140개사, 253개 노선, 상용 1,577대, 예비 49대, 합계 1,626대입니다. 같은 페이지에는 서울을 오가는 경기·인천 면허 노선 645개, 5,711대가 따로 나옵니다. [시내버스 현황](https://news.seoul.go.kr/traffic/archives/300)
- 서울지하철(2025.1.31 기준, 1~9호선, 우이신설, 신림)은 11개 노선, 359.86km, 338역, 504편성, 4,057칸, 평일 5,347회 운행입니다. [지하철 운행현황](https://news.seoul.go.kr/traffic/archives/1551)
- 노선별 평일 운행횟수는 1호선 588, 2호선 528(+지선 226/220), 3호선 406, 4호선 487, 5호선 430, 6호선 340, 7호선 406, 8호선 324, 9호선 492, 우이 516, 신림 384입니다. 첨두 시격은 2.5~4.5분입니다. [지하철 운행현황](https://news.seoul.go.kr/traffic/archives/1551)
- 서울교통공사 2024.3.31 자료에서 1호선 588회 중 501회는 코레일 열차입니다(구간은 서울~청량리). [OA-13318](https://data.seoul.go.kr/dataList/OA-13318/S/1/datasetView.do)
- realtimePosition의 totalCount 합계는 금요일 20:51 KST 기준 522대였고, 20:58 재측정에서는 511~513대였습니다(비첨두). [실측 2호선](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/2%ED%98%B8%EC%84%A0)
- 열린데이터광장 '시내버스 현황 통계'에는 현재 파일이 없습니다. [통계](https://data.seoul.go.kr/dataList/DT201004I020009/S/2/datasetView.do)
- 호출량 산술(추정, 노선당 1회/주기). 버스 396개 노선 24시간 기준으로 15초 주기는 2,280,960회/일(초당 26.4건), 30초는 1,140,480회, 60초는 570,240회입니다. 20시간만 폴링하면 각각 1,900,800 / 950,400 / 475,200회입니다. 15초 주기는 오퍼레이션당 30TPS의 약 88%에 해당합니다. [시내버스 현황](https://news.seoul.go.kr/traffic/archives/300), [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- 지하철 19개 노선 기준으로 10초 주기는 164,160회/일, 30초는 54,720회/일입니다. 기본 한도 1,000건의 44~164배입니다. [이용안내](https://data.seoul.go.kr/together/guide/useGuide.do)

### 확인 못 한 것
- 첨두 동시운행 열차 수. '왕복 소요시간 ÷ 시격'으로 계산하면 약 470편성이 나오지만, 5호선 추정치(88)가 보유 편성(80)을 넘어 공식 자체가 과대 추정입니다. 전체 600~750대라는 값은 근거 없는 외삽입니다. [지하철 운행현황](https://news.seoul.go.kr/traffic/archives/1551)
- 첨두 동시 렌더링 객체 수(7,600~9,400개 추정). '운행차량'은 하루 투입 대수이지 동시 운행 대수가 아닙니다.
- 마을버스가 위치 API에 포함되는지. 평일 오전 첨두 실측값.

---

## 6) NAVER 지도 SDK와 RN 라이브러리

### 확인된 사실
- Android 상수는 MINIMUM_TILT 0, MAXIMUM_TILT 63, DEFAULT_MAXIMUM_TILT 60, 줌 0~21입니다. [constant-values](https://navermaps.github.io/android-map-sdk/reference/constant-values.html)
- 기본값 표기가 플랫폼마다 다릅니다. Android setMaxTilt는 '기본값은 MAXIMUM_TILT'(63), iOS maxTilt는 '기본값은 60'입니다. RN 라이브러리에는 maxTilt/minTilt prop이 없습니다. [NaverMap](https://navermaps.github.io/android-map-sdk/reference/com/naver/maps/map/NaverMap.html), [NMFMapView](https://navermaps.github.io/ios-map-sdk/reference/Classes/NMFMapView.html)
- 줌 레벨에 따라 최대 tilt가 달라지는 규칙은 공식 문서에 없습니다. [가이드 3-1](https://navermaps.github.io/android-map-sdk/guide-ko/3-1.html)
- buildingHeight는 0~1 배율(기본 1)이고, 0이면 기울여도 건물이 2D로 나옵니다. [가이드 2-3](https://navermaps.github.io/android-map-sdk/guide-ko/2-3.html)
- 레이어 그룹은 BUILDING(기본 켜짐), TRAFFIC, TRANSIT, BICYCLE, MOUNTAIN, CADASTRAL이고 여러 개를 동시에 켤 수 있습니다(지도 유형별로 지원이 다름). TRANSIT은 철도, 지하철 노선, 버스정류장을 보여줍니다. 상수 문자열은 'building', 'ctt', 'transit', 'bike', 'mountain', 'landparcel'입니다. [constant-values](https://navermaps.github.io/android-map-sdk/reference/constant-values.html)
- customStyleId를 적용하면 지도 유형, 레이어 그룹, 실내지도, 야간 모드가 스타일 에디터 설정으로 고정되어 옵션을 바꿔도 효과가 없습니다. [가이드 2-4](https://navermaps.github.io/android-map-sdk/guide-ko/2-4.html)
- 오버레이 클래스는 Marker, Path, MultipartPath, ArrowheadPath, Ground, Location, Polygon, Polyline, Circle, InfoWindow, OverlayImage뿐이고 커스텀 GL이나 3D 모델 클래스는 없습니다. Overlay 추상 클래스에는 공개 생성자나 상속 안내가 없습니다. [package-summary](https://navermaps.github.io/android-map-sdk/reference/com/naver/maps/map/overlay/package-summary.html), [Overlay](https://navermaps.github.io/android-map-sdk/reference/com/naver/maps/map/overlay/Overlay.html)
- PathOverlay는 progress(-1~1)와 passedColor를 지원합니다. MultipartPathOverlay는 여러 PathOverlay보다 '쉽고 효율적'입니다. ArrowheadPathOverlay는 진척률을 지정할 수 없고, 좌표가 2개 미만이면 예외가 납니다. [가이드 5-7](https://navermaps.github.io/android-map-sdk/guide-ko/5-7.html)
- 성능 지침: 대량 오버레이는 생성과 옵션 지정을 백그라운드에서 하고 지도 추가만 메인 스레드에서 합니다. 비트맵이 너무 많으면 'Overlay image atlas overflow' 경고와 함께 렌더링이 무척 느려집니다. OverlayImage는 공유하고, 숨길 때는 visible이나 min/maxZoom을 씁니다. [가이드 5-1](https://navermaps.github.io/android-map-sdk/guide-ko/5-1.html)
- 한 화면에 마커가 많으면 성능이 떨어집니다. 클러스터러는 필요한 마커만 추가·제거하며 재사용하고, addAll()이 add()를 반복하는 것보다 빠릅니다. [가이드 5-8](https://navermaps.github.io/android-map-sdk/guide-ko/5-8.html) 마커 개수에 대한 공식 성능 수치는 없습니다. [가이드 5-2](https://navermaps.github.io/android-map-sdk/guide-ko/5-2.html)
- setFpsLimit 기본은 0(무제한)이고, 라이트 모드는 더 이상 지원되지 않습니다. [NaverMap](https://navermaps.github.io/android-map-sdk/reference/com/naver/maps/map/NaverMap.html)
- 최신 SDK는 Android·iOS 모두 3.24.0(2026-09-09)이고, maxTilt/minZoom/maxZoom을 지정할 때 카메라 애니메이션이 멈추던 문제를 고쳤습니다. 3.23.3(2026-07-13)도 있습니다. NCP Key ID 인증은 3.21.0부터입니다. [Android CHANGELOG](https://github.com/navermaps/android-map-sdk/blob/master/CHANGELOG.md), [iOS CHANGELOG](https://github.com/navermaps/ios-map-sdk/blob/master/CHANGELOG.md)
- 시작 절차: 콘솔 Maps에서 Application을 등록하고 Dynamic Map을 체크해야 합니다(미체크 시 429, 패키지명 오류 시 401). meta-data는 `com.naver.maps.map.NCP_KEY_ID`, 저장소는 `https://repository.map.naver.com/archive/maven`, 지원 범위는 Android API 21 이상입니다. [시작 가이드](https://navermaps.github.io/android-map-sdk/guide-ko/1.html)
- Dynamic Map을 선택하면 Web URL, Android 패키지명, iOS Bundle ID 중 하나 이상을 입력해야 합니다(각 최대 10개). 한도는 기본/일 최대/월 최대 6,000,000/15,000,000/45,000,000이고 직접 설정할 수 있습니다. [NCP 가이드](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)
- 무료 이용량은 대표 계정 1개에 한해 월 6,000,000건이고, 초과 단가는 정적 HTML에서 읽을 수 없습니다. [Maps 상품](https://www.ncloud.com/product/applicationService/maps) 대표 계정은 Maps를 처음 이용한 계정으로 정해지며, 개인은 전화번호, 사업자는 사업자번호당 하나입니다. [Maps 개요](https://guide.ncloud-docs.com/docs/application-maps-overview)
- 구 AI NAVER API의 지도 API는 2025-04-17부터 신규 신청이 차단됐고, 2025-07-01부터 100% 유료입니다(MDM 0.1원/건). 이 단가는 신규 Maps 상품에는 해당하지 않습니다. [공지 1930](https://www.ncloud.com/support/notice/all/1930), [공지 1965](https://www.ncloud.com/support/notice/all/1965)
- @mj-studio/react-native-naver-map 최신은 2.9.1(2026-10-07)이고 peerDependencies는 '*'입니다. [package.json](https://github.com/mym0404/react-native-naver-map/blob/main/package.json) RN 0.86.3/0.87.1은 AAR 컴파일만 검증됐고 기기 런타임은 시험하지 않았습니다. 0.88 관련 이슈나 PR은 없습니다. [PR #204](https://github.com/mym0404/react-native-naver-map/pull/204)
- npm 기준 expo latest는 58.0.21, react-native는 0.88.1이고, Expo 번들 모듈은 react 19.3.0, reanimated 4.7.1입니다. [bundledNativeModules](https://github.com/expo/expo/blob/main/packages/expo/bundledNativeModules.json)
- 라이브러리는 New Architecture 전용(모든 컴포넌트 codegenNativeComponent)이고 Expo Go는 안 됩니다. [docs index](https://github.com/mym0404/react-native-naver-map/blob/main/docs/content/docs/index.mdx) config plugin이 NMFNcpKeyId/NCP_KEY_ID를 기록하며, extraMavenRepos 추가가 필요합니다. [plugin 소스](https://github.com/mym0404/react-native-naver-map/blob/main/expo-config-plugin/src/index.ts)
- 번들된 SDK는 3.23.2입니다. Android는 rootProject ext로 버전을 덮어쓸 수 있어 보이지만(빌드 미검증), iOS podspec은 3.23.2로 고정되어 있습니다. [README](https://github.com/mym0404/react-native-naver-map/blob/main/README.md)
- 마커 coord는 native position에 바로 대입되고, 위치 애니메이션 API나 Reanimated 연동은 없습니다. [Marker.mm](https://github.com/mym0404/react-native-naver-map/blob/main/ios/Overlay/Marker/RNCNaverMapMarker.mm)
- 라이브러리 저자의 정성 평가 기준 권장 개수는 Basic Symbol '무제한', Native Asset '수천', Web/Local 이미지 '수백', Custom View '50 미만'입니다(벤치마크 근거 없음). [optimization](https://github.com/mym0404/react-native-naver-map/blob/main/docs/content/docs/optimization.mdx)
- NaverMapView는 layerGroups, buildingHeight, customStyleId, fpsLimit(Android 전용, 초기값만 적용), coordinateToScreen(Promise 방식), onCameraChanged를 제공합니다. [NaverMapView.tsx](https://github.com/mym0404/react-native-naver-map/blob/main/src/component/NaverMapView.tsx)
- 라이브러리의 API 키 문서는 구 AI·NAVER API 기준이라 오래된 내용입니다. [api-key.mdx](https://github.com/mym0404/react-native-naver-map/blob/main/docs/content/docs/installation/api-key.mdx)
- Maps 이용약관 v0.4(2025-03-20): 결과 데이터를 저장하거나 DB화하는 것을 금지하고(좌표를 모아 재사용하는 것은 엄격히 금지), 무단 복제·가공·배포와 SDK 재판매도 금지합니다. 회사는 로고 게재를 요청할 수 있습니다. 제3자 데이터를 지도 위에 표시하는 것을 금지하는 조항은 없습니다. 다만 Maps 사용 가이드도 준수 대상이고, v0.4가 최신인지는 확인하지 못했습니다. [약관 PDF](<https://xv-ncloud.pstatic.net/images/provision/[민간]Maps서비스이용약관_v0.4_(CLEAN)_1742433558704.pdf>)
- 기능 명칭(대중교통, 실시간교통 등)은 NAVER 표기를 그대로 써야 합니다. [이용 절차](https://guide.ncloud-docs.com/docs/maps-procedure)
- '거리뷰 3D'는 소비자 앱 기능이고 API나 SDK 제공 언급이 없습니다. [보도자료](https://navercorp.com/media/pressReleasesDetail?seq=32188)

### 확인 못 한 것
- 줌별 실제 tilt 제한, 서울 3D 건물이 나타나는 최소 줌과 커버리지.
- Dynamic Map 600만 건 초과 단가, '1건' 집계 기준, 웹과 모바일이 쿼터를 공유하는지.
- 2.9.1이 RN 0.88.1/Expo 58에서 빌드·실행되는지. 마커 수백~수천 개를 30~60Hz로 갱신할 때의 FPS.
- 상위 NCP 약관의 추가 제한(캡처, 영상 마케팅 등).

---

## 7) 설계에 주는 결론

아래는 위 사실에서 끌어낸 판단입니다(추론 포함).

**파이프라인 구조**
- 상류 API는 모두 HTTP만 됩니다(swopenAPI, ws.bus.go.kr, 가이드상 SSL 없음). Bun/Fastify 서버만 HTTP로 수집하고 클라이언트에는 HTTPS/WSS로 내려주는 구조가 필수입니다. 이렇게 하면 키도 서버에만 둘 수 있습니다. [subway-now #95](https://github.com/handokei/subway-now/issues/95), [활용가이드](https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003552007&fileDetailSn=1)
- 서버에 정규화 계층을 둡니다. 다룰 것은 다음과 같습니다: updnLine("0"/"1"과 한글), recptnDt KST 파싱, 시간표 24/25시와 00:00:00(null) 처리, 버스 거리 단위(km/m) 통일, 좌표 필드명(gpsX/tmX, posY/posy), 성공과 실패의 응답 형태 차이(지하철은 errorMessage/루트 RESULT, 버스는 ServiceResult/401 JSON). [OA-12601 실측](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimePosition/0/5/1%ED%98%B8%EC%84%A0)
- 과거 데이터는 제공되지 않으므로, 보간 튜닝(구간 주행시간, 지연 분포)용 이력은 서버가 처음부터 직접 저장해야 합니다. [OA-12601](https://data.seoul.go.kr/dataList/OA-12601/A/1/datasetView.do)

**무엇을, 얼마나 자주 폴링할지**
- 지하철: realtimePosition을 19개 노선 × `0/999`로 1주기에 19콜 부릅니다. 보정용으로 `realtimeStationArrival/ALL`을 경로형으로 1콜 더합니다. 스냅샷 변화가 약 20초 간격으로 관측됐으므로 승인 후 20초 주기면 하루 약 86,400콜(19×4,320 + 4,320), 30초 주기면 약 57,600콜입니다. 승인 전(1,000건/일)에는 ALL 1콜을 약 90초 간격으로 부르는 정도만 가능하므로 시간표 위주로 운영합니다. [이용안내](https://data.seoul.go.kr/together/guide/useGuide.do)
- 버스: getBusPosByRtid를 노선 396개에 대해 라운드로빈으로 부릅니다. 토큰 버킷으로 초당 10~15건 이하로 제한하는 것을 권합니다(30TPS의 의미가 불명확하기 때문). 화면에 보이는 노선이나 배차가 촘촘한 노선은 15~20초, 나머지는 30~60초, 심야에는 운행 중인 노선만 폴링하는 차등 방식이 현실적입니다. 일일 예산은 KST 00시에 리셋합니다. [data.go.kr FAQ](https://www.data.go.kr/bbs/faq/selectFaqList.do)
- 에러 처리: 버스 GW 22(일일 소진)는 그날 해당 오퍼레이션을 중단하고, 23(초당 초과)은 지수 백오프로 처리합니다. api.bus.go.kr 코드 8, headerCd 8(운행 종료)과 6(일시 장애)도 구분합니다. 지하철은 쿼터 초과 코드가 공식 문서에 없으므로 자체 호출 카운터로 막습니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do), [errGuide](http://api.bus.go.kr/contents/sub02/errGuide.html)

**신청할 쿼터**
- 버스 15000332(getBusPosByRtidList): 운영계정으로 하루 약 115만~230만 건을 신청합니다(30초 주기 24시간은 1,140,480건, 15초는 2,280,960건). 상한이 공개되지 않았으므로 승인값을 보고 폴링 주기를 정합니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
- 노선정보 15000193: 05시 이후 하루 1회 배치로 getRoutePath와 getStaionsByRouteList를 노선 396개씩 부르면 약 792콜입니다. 한도가 키 합산이면 개발계정 1,000건이 빠듯하므로 운영 전환을 권합니다. 도착정보 15000314는 선택 사항입니다. [15000193](https://www.data.go.kr/data/15000193/openapi.do)
- 지하철: 갤러리 승인이 사실상 유일한 해제 경로입니다. 실데이터를 보여주는 웹을 먼저 공개해 신청하는 것이 안전합니다. [FAQ](https://data.seoul.go.kr/together/notice/faqList.do)

**미리 받아 둘 데이터 (정적 배치)**
- 1~9호선 시간표: 15098251 CSV(열차코드 = trip). [15098251](https://www.data.go.kr/data/15098251/fileData.do)
- 2호선과 신분당: OA-22750 getTrainSch(2호선 끝 3자리 매칭, 성수 번호 변경 후속표). 기준일이 2025라 검증이 필요합니다. [getTrainSch](http://openapi.seoul.go.kr:8088/sample/json/getTrainSch/1/5/%20/N/%EC%83%81%ED%96%89/%ED%8F%89%EC%9D%BC/%EC%8B%A0%EB%B6%84%EB%8B%B9%EC%84%A0/SA001)
- 코레일 5개 노선: korail.com 게시판 XLSX(id=900보다 최신). [korail 게시판](https://www.korail.com/com/userBoard.do?schBcid=ticketTable&mode=list&page=1)
- 우이신설, 신림, 신분당(보조): KRIC id=900. 공항철도 직통: 공식 시각표 페이지(번호 없음, 슬롯 매칭). GTX-A: KRIC subwayTimetable. [id=900](https://data.kric.go.kr/rips/M_01_01/detail.do?id=900), [AREX 직통](https://www.airportrailroad.com/train/express/info)
- 역 키: 실시간도착_역정보 xlsx(월간 diff), subwayStationMaster, OA-121로 Betro 자체 crosswalk 테이블(statnId, STATION_CD, 좌표, coord_source, osm_node_id)을 만들고 CI에서 미매칭을 검사합니다. 런타임 조인 키는 statnId 문자열만 씁니다. [역정보 xlsx](https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-12764&seqNo=&seq=57&infSeq=2)
- 선로: OSM(신규 노선까지 반영된 유일한 소스). 선로 데이터 유형은 전부 OSM으로 두고, 비OSM 데이터는 키로만 연결해 share-alike 범위를 한정합니다. [가이드라인](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline)
- 버스: getRoutePath 폴리라인 위에 정류소 좌표를 순서대로 투영해 구간을 나누고, 위치는 (sectOrd, sectDist/fullSectDist)로 계산합니다. rtDist와 nextStId는 위치 계산에 쓰지 않습니다. [transit-log](https://github.com/capstone-ootd/transit-log/tree/main/data/100100391)

**보간 엔진**
- 지하철은 이벤트 기반으로 만듭니다. 위치 = 열차별 recptnDt 이후 경과시간 + 시간표 구간 주행시간입니다. 실시간은 수십 초(36~87초) 늦으므로 시간표 예측을 주로 쓰고 실시간은 위상 보정에 씁니다. 신분당은 recptnDt가 스냅샷 시각이라 상태 전이 시점을 서버가 직접 기록합니다. [OA-12764 안내](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do), [#3223](https://github.com/handokei/subway-now/issues/3223)
- trainNo 매칭은 노선별 전략으로 교체할 수 있게 만듭니다. 1·3~9호선은 접두를 정규화하고, 2호선 본선은 끝 3자리를 쓰며, 성수에서 3D 모델을 끊지 않고 이어 그립니다. 코레일은 'K'를 붙이고, 신분당은 위치·방향·시각 기반으로 매칭합니다. 시간표에 없는 열차(9xxx)는 구간 평균 주행시간으로 대체합니다. 매칭률 지표에 경보를 둡니다. [fixtures](https://github.com/handokei/subway-now/tree/dev/backend/alarm-worker/src/__tests__/fixtures)
- 버스는 단조 증가 제약(가끔 생기는 역행 노이즈 제거)을 두고, 순환 노선은 sectOrd로만 조인합니다. [transit-log README](https://github.com/capstone-ootd/transit-log/blob/main/README.md)

**렌더링**
- NAVER SDK에는 커스텀 GL이나 3D 모델 오버레이가 없고, tilt는 60~63도가 한계이며, 건물은 extrusion 높이 배율만 조절됩니다. 차량은 공유 native asset Marker(angle, isFlat)로 그리고, 뷰포트 컬링, 줌별 밀도 제한, 저줌 집계를 적용합니다. 수천 대를 JS에서 매 프레임 coord로 갱신하는 방식은 위험하므로, 네이티브 배치 업데이트를 위한 포크를 검토합니다. [package-summary](https://navermaps.github.io/android-map-sdk/reference/com/naver/maps/map/overlay/package-summary.html), [Marker.mm](https://github.com/mym0404/react-native-naver-map/blob/main/ios/Overlay/Marker/RNCNaverMapMarker.mm)
- 노선은 MultipartPathOverlay로 그립니다. 커스텀 스타일을 쓰면 TRANSIT/BUILDING을 런타임에 토글할 수 없으므로 스타일을 여러 개 준비합니다. [가이드 2-4](https://navermaps.github.io/android-map-sdk/guide-ko/2-4.html)

**출처 표시와 라이선스**
- '서울특별시(서울 열린데이터광장)' 출처, OpenStreetMap 출처(ODbL), NAVER 로고를 가리지 않아야 합니다. NAVER 결과 데이터(경로, 지오코딩)는 저장하지 않으므로 형상은 공공데이터나 OSM으로만 만듭니다. [약관 PDF](<https://xv-ncloud.pstatic.net/images/provision/[민간]Maps서비스이용약관_v0.4_(CLEAN)_1742433558704.pdf>)

**가장 큰 위험**
1. 지하철 1,000건/일 해제가 출시 전제입니다(승인 기준, 랜딩 인정 여부, 승인 후 QPS 모두 불명확). [FAQ](https://data.seoul.go.kr/together/notice/faqList.do)
2. 버스 운영계정 증설의 상한이 공개되지 않았고 30TPS가 걸려 있어, 15초 주기 전 노선 폴링은 여유가 거의 없습니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
3. RN 라이브러리가 RN 0.88/Expo 58에서 검증되지 않았고, SDK 3.23.2가 고정되어 있으며, maxTilt prop이 없습니다. [PR #204](https://github.com/mym0404/react-native-naver-map/pull/204)
4. 시간표가 낡을 수 있습니다(공항철도 10-23 개정, 코레일 9.1. 개정, OA-22750 2025 기준). [AREX 보도](https://www.arex.or.kr/contentView.do?menuNo=MN202602270000000001&contentNo=CT202610210000000001&etcNo=)
5. trainNo 규칙은 공식 보장이 없는 관행입니다(2호선, 신분당, GTX-A). [OA-22750](https://data.seoul.go.kr/dataList/OA-22750/S/1/datasetView.do)
6. api.bus.go.kr의 '상업적 이용 불가' 문구가 data.go.kr 표기와 상충합니다. [api.bus.go.kr 소개](http://api.bus.go.kr/contents/sub01/wisOpenApi.html)
7. 마커 수천 개의 성능은 공식 수치가 없습니다. [가이드 5-8](https://navermaps.github.io/android-map-sdk/guide-ko/5-8.html)

---

## 8) 사용자가 직접 해야 할 일

1. **서울 열린데이터광장**: 회원가입 후 '일반 인증키'와 '실시간 지하철 인증키'를 신청합니다(실시간 키는 즉시 발급이 아닐 수 있음). [이용안내](https://data.seoul.go.kr/together/guide/useGuide.do)
2. **data.go.kr**: 15000332, 15000193, 15000314에 활용신청(개발계정)을 하고, 발급된 키로 ws.bus.go.kr 호출이 실제로 되는지 바로 확인합니다(화재 문구 확인 목적). 출시 시점에 운영계정으로 전환하고 변경신청으로 트래픽 증설을 요청합니다. [15000332](https://www.data.go.kr/data/15000332/openapi.do)
3. **KRIC 레일포털**: 서비스키를 받고 subwayTimetable과 subwayTimetableExp를 각각 신청합니다(별도 신청 필요). [KRIC 답변](https://data.kric.go.kr/rips/M_04_04/detail.do?id=115)
4. **NCP**: 대표 계정으로 Maps 단독 상품에 Application을 등록하고, Dynamic Map을 체크한 뒤 개발·운영 패키지명, Bundle ID, 웹 URL을 등록하고 월 한도를 설정합니다. 600만 건 초과 단가는 요금계산기로 확인합니다. [NCP 가이드](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)
5. **웹 공개와 갤러리 등록**: 실시간 데이터를 실제로 보여주는 웹(저빈도 미니맵 등)을 실제 URL로 공개하고 활용사례에 등록합니다(3~5일, 로그인 후 양식 확인). [갤러리](https://data.seoul.go.kr/dataVisual/gallery/galleryList.do)
6. **전화 문의**:
   - 서울시 미래첨단교통과 02-2133-4969: 승인 기준(랜딩 인정 여부), 승인 후 QPS, 버스 증설 상한, 30TPS의 의미, 상업적 이용 상충, 화재 문구
   - 공공데이터활용지원센터 1566-0025: 트래픽 단위
   - OA-21232 담당 02-2133-4959: statnId 매핑 테이블, 좌표 측지계
   - 서울교통공사 스마트정보처 02-6311-9356: 2호선 trainNo 앞자리 의미

   [OA-15799 정보](https://data.seoul.go.kr/dataList/OA-15799/A/1/datasetView.do)
7. **기술 스모크 테스트**: Expo 58 dev build에서 react-native-naver-map 2.9.1을 iOS와 Android로 빌드합니다. 줌 10/13/16/19에서 tilt를 측정하고, 마커 500/1,000/3,000개 갱신 벤치마크를 돌립니다. [PR #204](https://github.com/mym0404/react-native-naver-map/pull/204)
8. **정식 키 재측정**: 평일 08시 첨두 동시운행 수, ALL 경로형 전량 수신, 스냅샷 갱신 주기, 버스 dataTm 실제 간격, getBusPosByRouteSt sectDist 단위를 다시 잽니다. [실측 ALL](http://swopenapi.seoul.go.kr/api/subway/sample/json/realtimeStationArrival/ALL)
9. **법률 검토**: OSM 기반 선로 데이터를 앱이나 서버로 배포할 때 ODbL 의무 범위를 확인합니다. [OSMF FAQ](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ)

---

