# @Betro/transit-static

서울 지하철 역 크로스워크와 OSM 선로 모양(정적 참조 데이터)을 수집하고 DB에 적재하는 패키지.

- CLI: 저장소 루트에서 `bun transit <command>`
- 데이터 디렉터리: `BETRO_DATA_DIR` (기본 `<repo>/data`). 받은 원본은 `data/raw/<source>/`에 그대로 보관한다.
- 서울 열린데이터광장 키: 환경 변수 `SEOUL_OPEN_API_KEY` (코드와 저장소에 넣지 않는다).
- 선로 데이터 출처: © OpenStreetMap contributors (ODbL)
