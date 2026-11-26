/**
 * 앱의 한국어 사용자 문구. 화면은 문구를 직접 쓰지 않고 `t("키")`로 가져온다.
 *
 * - 키는 `화면.덩어리.역할` 순서로 짓는다. 예: `settings.theme.title`.
 * - 값의 `{이름}`은 `t(key, { 이름: 값 })`으로 채운다.
 * - 문구를 바꿀 때는 Figma 문구 표(`docs/superpowers/plans/2026-11-05-mvp-1-app-foundation.md`의 "문구 변경")를 함께 고친다.
 */
export const ko = {
	/** 07 버스 노선 상세 */
	busDetail: {
		arrival: "도착",
		direction: "{name} 방면",
		favorite: "즐겨찾기",
		favoriteRemove: "즐겨찾기 해제",
		loading: "노선 정보를 불러오는 중이에요",
		lowFloor: "저상",
		nextStop: "다음 정류장",
		notice: "버스 위치는 실시간으로 갱신돼요",
		route: "운행 경로",
		running: "{n}대 운행 중",
		title: "{shortName}번",
		unavailable: {
			body: "검색에서 다시 찾아 주세요",
			title: "찾을 수 없는 노선이에요",
		},
	},
	common: {
		back: "뒤로",
		minutes: "{m}분",
	},
	commute: {
		lock: {
			action: {
				end: "종료",
			},
			detail: {
				beforeLeave: "{stop} · {eta} 탑승",
				eta: "{stop} · {eta} 도착",
				etaEstimated: "{stop} · 약 {eta} 도착",
				noEta: "{stop}",
				passedBus: "다음 차 {eta} · {stop}",
				passedBusEstimated: "다음 차 약 {eta} · {stop}",
				passedSubway: "다음 열차 {eta} · {stop}",
				passedSubwayEstimated: "다음 열차 약 {eta} · {stop}",
			},
			header: {
				fallback: "출퇴근",
			},
			minutes: {
				soon: "곧",
				value: "{m}분",
			},
			nextLeg: {
				eta: "{stop} · {eta} 승차",
				etaEstimated: "{stop} · 약 {eta} 승차",
				more: "외 {n}구간",
				noEta: "{stop}",
			},
			status: {
				arrived: "{stop} 도착",
				arriving: "곧 도착",
				/** 탈 차량이 아직 노선 기점에서 떠나지 않았다(서울 버스 "출발대기"). */
				awaitingDeparture: "출발 대기 중",
				beforeLeave: "{leave}에 나가세요",
				beforeLeaveSafe: "{safeLeave}에 나가면 여유 있어요",
				beforeLeaveTight: "{leave}에 나가면 빠듯해요",
				passedBus: "{passedLine}번이 지나갔어요",
				passedSubway: "{passedLine} 열차가 지나갔어요",
				ride: "하차까지 {n}정거장",
				rideLast: "이번에 내려요",
				rideUnknown: "이동 중",
				stopsAway: "{n}정거장 전",
				unknown: "위치 확인 중",
			},
			suggestion: {
				bus: "{line}번이 {m}분 뒤 와요 · {saves}분 빨리 도착",
				subway: "{line} 열차가 {m}분 뒤 와요 · {saves}분 빨리 도착",
			},
			tag: {
				delayed: "지연",
				estimated: "시간표 추정",
				live: "실시간",
			},
		},
		/** Android 진행 중 알림 */
		notification: {
			channel: "출퇴근 안내",
		},
	},
	/** 17 출퇴근 안내 */
	commuteGuide: {
		arrival: "{time} 도착",
		checking: "연결을 확인하고 있어요",
		diff: {
			earlier: "{m}분 빨리",
			later: "{m}분 늦게",
		},
		end: "안내 종료",
		endFailed: "보내지 못했어요. 다시 눌러 주세요",
		/** 버스 노선 이름. 지하철은 노선 이름("2호선") 그대로 쓴다. */
		lineBus: "{name}번",
		lineJoiner: " · ",
		/** 다음 안내. `{day}`는 다음에 나가는 날("오늘", "내일", 요일 한 글자)이다. */
		next: {
			label: "다음 안내",
			/** 설정에서 출퇴근 안내를 꺼 둬서 세션이 열리지 않을 때. 안내가 온다고 말하지 않는다. */
			labelDisabled: "다음 출발",
			/** 잠금화면 안내가 뜨지 않을 때(알림·실시간 현황·설정이 꺼짐). 뜬다고 말하지 않는다. */
			leaveOnly: "{day} {leave}에 나가요",
			/** 서버에 올라가기 전에는 예약이 동작한다고 말하지 않는다. `{days}`는 등록한 요일이다. */
			notSynced: "{days} {leave}에 나가요 · 아직 서버에 저장되지 않았어요",
			previousDay: "{day} {leave}에 나가요 · 전날 {show}부터 잠금화면에 떠요",
			sameDay: "{day} {leave}에 나가요 · {show}부터 잠금화면에 떠요",
			today: "오늘",
			tomorrow: "내일",
		},
		others: {
			note: "등록한 대안 경로만 비교해요",
			title: "같은 곳으로 가는 다른 방법",
		},
		routeLabel: {
			alternative: "대안 · {lines}",
			main: "기본 경로 · {lines}",
		},
		routes: {
			note: "경로를 고치려면 내 장소에서 연필을 눌러요",
			title: "등록한 경로",
		},
		/** 15 맨 위 진행 중 세션 띠 */
		strip: {
			header: "{header} 안내 중",
			status: "{status} · {minutes}",
		},
		title: "{name} 가는 길",
	},
	dataSources: {
		footnote: "공공누리 제1유형 · 갱신 주기는 노선과 시간대에 따라 달라요",
		intro:
			"Betro는 공공 데이터를 받아 차량 위치를 계산해요.\n위치마다 정보의 출처와 정확도를 함께 표시해요.",
		legendTitle: "위치 표시 방식",
		providers: {
			dataGoKr: {
				subtitle: "서울 버스 위치·노선·정류소, 서울교통공사 시간표",
				title: "공공데이터포털",
			},
			gyeonggi: {
				subtitle: "경기도 버스정보 · 경기 버스 노선·정류소·도착·위치",
				title: "경기도",
			},
			kric: {
				subtitle: "철도산업정보센터 · 광역철도 시간표",
				title: "국가철도공단",
			},
			molit: {
				subtitle: "TAGO · 인천 버스 노선·정류소·도착·위치",
				title: "국토교통부",
			},
			naverMap: {
				subtitle: "배경 지도",
				title: "NAVER 지도",
			},
			openStreetMap: {
				subtitle: "선로·지도 형상 (ODbL)",
				title: "© OpenStreetMap contributors",
			},
			seoul: {
				subtitle: "서울 열린데이터광장 · 실시간 지하철 도착·역 정보",
				title: "서울특별시",
			},
		},
		providersTitle: "제공 기관",
		status: {
			delayed: {
				description: "운영 기관 지연 정보 반영",
				label: "지연",
			},
			ended: {
				description: "운행이 끝났거나 정보가 없어요",
				label: "운행 종료",
			},
			estimated: {
				description: "역 도착 신호와 시간표로 계산한 위치",
				label: "시간표 추정",
			},
			live: {
				description: "실시간 위치 API로 확인된 위치",
				label: "실시간",
			},
		},
		title: "데이터 출처",
	},
	errorBoundary: {
		body: "잠시 후 다시 시도해 주세요.",
		retry: "다시 시도",
		title: "화면을 그리지 못했어요",
	},
	/** 도착 한 칸의 글자(`lib/transit/eta-status.ts`). 단정하지 않는다. */
	eta: {
		arriving: "곧 도착",
		ended: "운행 종료",
		headway: "배차 약 {minutes}분",
		minutes: "{minutes}분",
		minutesEstimated: "약 {minutes}분",
	},
	/** 09 즐겨찾기 */
	favorites: {
		cancel: "취소",
		empty: {
			action: "검색하기",
			body: "검색에서 별을 눌러 추가해요",
			title: "즐겨찾기가 없어요",
		},
		filter: {
			all: "전체",
			route: "노선",
			station: "역",
			stop: "정류장",
		},
		filteredEmpty: "이 종류의 즐겨찾기가 없어요",
		manage: "관리",
		menu: "더보기",
		myPlaces: "내 장소",
		noArrivals: "도착 정보가 없어요",
		remove: "즐겨찾기에서 빼기",
		title: "즐겨찾기",
	},
	/** 16 구간 고르기(수단 → 노선 → 승차 → 하차) */
	legPicker: {
		addLeg: "이 구간 추가",
		alight: {
			body: "{stop}에서 타요 · 그 앞 정류장은 고를 수 없어요",
			subwayBody: "{stop}에서 타요",
			title: "어디서 내리나요?",
			topBar: "하차 정류장",
			topBarSubway: "하차역",
		},
		board: {
			/** 승차 이름 검색에 맞는 것이 없을 때. `{q}`는 입력한 검색어다. */
			noStation: "'{q}'에 맞는 역이 없어요",
			noStop: "'{q}'에 맞는 정류장이 없어요",
			searchStation: "역 이름 검색",
			searchStop: "정류장 이름 검색",
			title: "어디서 타나요?",
			topBar: "승차 정류장",
			topBarSubway: "승차역",
		},
		boardMark: "승차",
		/** 지하철 지선 이름. 모르는 지선은 `other`로 번호를 붙인다. */
		branch: {
			gwangmyeong: "광명 지선",
			gwangundae: "광운대 방면",
			gyeongbu: "경부선",
			"gyeongwon-gyeongin": "경원·경인선",
			imjingang: "임진강 방면",
			jipyeong: "지평 방면",
			macheon: "마천 지선",
			main: "본선",
			north: "북쪽 갈래",
			other: "갈래 {n}",
			seodongtan: "서동탄 지선",
			seongsu: "성수지선",
			"seoul-station": "서울역 방면",
			sinjeong: "신정지선",
			south: "남쪽 갈래",
		},
		branchUnavailable: "{stop}이 없는 지선이라 고를 수 없어요",
		checking: "두 역 사이를 확인하고 있어요",
		empty: {
			body: "번호를 다시 확인해 주세요. 서울·경기·인천 버스를 찾을 수 있어요.",
			title: "찾는 노선이 없어요",
		},
		failed: {
			body: "연결을 확인하고 다시 시도해 주세요.",
			title: "불러오지 못했어요",
		},
		mode: {
			body: "노선과 정류장을 직접 골라요. 탈 수단부터 정해 주세요.",
			bus: {
				subtitle: "서울 시내·마을버스, 경기·인천 버스",
				title: "버스",
			},
			footnote: "수단 → 노선 → 승차 → 하차 순서로 골라요",
			subway: {
				subtitle: "서울 지하철과 광역철도",
				title: "지하철",
			},
			title: "무엇을 타나요?",
			topBar: "구간 추가",
		},
		next: "다음",
		notDirect: {
			body: "이 두 역은 한 번에 갈 수 없어요. 구간을 나눠서 등록해 주세요",
			title: "한 번에 갈 수 없어요",
		},
		notFound: "이 노선을 찾지 못했어요",
		region: {
			gyeonggi: "경기",
			incheon: "인천",
			seoul: "서울",
		},
		retry: "다시 시도",
		/** 검색 결과 줄의 아래 글자. 예: "서울 간선", "경기 버스" */
		routeSub: "{region} {type}",
		routeSubPlain: "{region} 버스",
		routeType: {
			airport: "공항",
			branch: "지선",
			circular: "순환",
			express: "광역",
			gbis: {
				direct: "직행좌석",
				general: "일반",
				seat: "좌석",
				wide: "광역급행",
			},
			trunk: "간선",
			village: "마을",
		},
		search: {
			clear: "검색어 지우기",
			count: "노선 {n}개 · 번호가 같으면 지역으로 구분해요",
			hint: "버스 번호나 노선 이름을 입력해 주세요",
			placeholder: "버스 번호 검색",
			topBar: "버스 노선",
		},
		subwayLines: {
			steps: "노선 → 승차역 → 하차역",
			title: "어느 노선을 타나요?",
			topBar: "지하철 노선",
		},
		towards: "{name} 방면",
	},
	/** 오픈소스 라이선스 화면(`app/settings/licenses.tsx`). */
	licenses: {
		intro: "Betro는 아래 오픈소스를 쓰고 있어요.",
		title: "오픈소스 라이선스",
	},
	/** 잠금화면 안내가 실제로 뜰 수 있는지(알림 권한, 실시간 현황, 설정의 안내 켜기)와 고치는 버튼 */
	lockScreen: {
		fix: {
			enableInApp: "안내 켜기",
			openSettings: "설정 열기",
			requestPermission: "알림 켜기",
		},
		/** 장소를 저장한 뒤 잠금화면 안내가 뜨지 않을 때 한 번 묻는 시트 */
		prompt: {
			allow: "알림 받기",
			body: {
				activitiesOff:
					"설정에서 실시간 현황을 켜면 나가는 시각 {m}분 전부터 잠금화면에 떠요",
				notificationsOff:
					"알림을 켜면 나가는 시각 {m}분 전부터 잠금화면에 떠요",
			},
			later: "나중에",
			openSettings: "설정 열기",
			title:
				"{days} {leave} {name} 가는 길, 잠금화면에 도착 정보를 띄워드릴게요",
		},
		/** 설정의 "출퇴근 잠금화면 안내" 행 부제와 고치는 행 */
		settings: {
			activitiesOff: "실시간 현황이 꺼져 있어요",
			/** 꺼 두면 서버가 세션을 열지 않아 잠금화면뿐 아니라 앱 안 실시간 안내도 시작되지 않는다. */
			disabled: "꺼 두면 앱에서도 출퇴근 안내가 시작되지 않아요",
			fixActivities: "실시간 현황 켜기",
			fixNotifications: "알림 켜기",
			notificationsOff: "알림이 꺼져 있어요",
		},
		warning: {
			activitiesOff: "실시간 현황이 꺼져 있어 잠금화면에 뜨지 않아요",
			disabledInApp: "설정에서 출퇴근 안내를 꺼 둬서 시작되지 않아요",
			notificationsOff: "알림이 꺼져 있어 잠금화면에 뜨지 않아요",
		},
	},
	map: {
		allHidden: "이 경로의 노선이 모두 꺼져 있어요",
		chips: {
			label: "지도에서 볼 장소",
			open: "{name} ▴",
			selected: "{name} ▾",
		},
		empty: {
			body: "집이나 회사를 등록하면 출퇴근 경로의 차량을 지도에서 볼 수 있어요.",
			register: "집·회사 등록하고 출퇴근 차량 보기",
			search: "어디로 가세요?",
			title: "등록한 장소가 없어요",
		},
		/** 실시간 버스가 아직 없을 때 승차 정류장 도착 예상(지도 설계 2.6). 단정하지 않는다. */
		estimatedBoard: "{line} · 시간표 추정 · 약 {minutes}분 뒤",
		/** 실시간이 그날 멈췄거나 3분 넘게 끊겨 시간표로 추정하는 중(14, 지도 설계 5장). */
		estimatedMode: "시간표 추정 모드",
		nearby: "근처 지하철",
		noRealtime: "실시간 정보 없음",
		routeMenu: {
			alternative: "대안 {n}",
			base: "기본",
			row: "{name} · {lines}",
			separator: " → ",
		},
		sheet: {
			close: "차량 정보 닫기",
			direction: {
				bus: "{name} 방면",
				subway: "{loop} · {name} 방면",
			},
			estimated: "시간표 추정",
			live: "실시간 · {seconds}초 전 위치",
			loop: {
				inner: "내선순환",
				outer: "외선순환",
			},
			mine: "내 정류장",
			mineEta: "{label} · {eta}",
			mineStation: "내가 탈 역",
			minutes: "{minutes}분",
			minutesEstimated: "시간표 추정 · 약 {minutes}분",
			more: "자세히",
			/** 실시간으로 볼 수 없을 만큼 오래된 위치. "실시간"이라고 쓰지 않는다(지도 설계 7장). */
			stale: "{minutes}분 전 위치",
			trainNo: "열차 {no}",
		},
	},
	/** 서버에 닿지 않을 때 화면 위 안내(비행기 모드, Wi-Fi·데이터 꺼짐, 서버 장애) */
	network: {
		offline: {
			body: "비행기 모드이거나 Wi-Fi·데이터가 꺼져 있으면 새 정보를 가져오지 못해요. 연결되면 다시 불러와요.",
			title: "인터넷에 연결되어 있지 않아요",
		},
	},
	notFound: {
		backToMap: "지도로 돌아가기",
		title: "페이지를 찾을 수 없어요",
	},
	onboarding: {
		body: "지금 달리는 차량이 어디쯤 있는지 한눈에 보여드려요.",
		features: {
			lockScreen: "출퇴근 길을 잠금화면에서",
			map3d: "다크·라이트 3D 지도",
			realtime: "실시간 위치와 시간표 추정을 구분해서 보여줘요",
		},
		/** 제목은 두 줄이다. 두 플랫폼 모두 전체를 text/primary로 그리고, `lead`/`accent`는 줄 구분용이다. */
		headline: {
			accent: "실시간 3D로",
			lead: "서울의 지하철과 버스를,",
		},
		start: "시작하기",
	},
	permissions: {
		continue: "계속",
		intro: {
			android: {
				body: "꼭 필요한 권한만 요청하고, 안내 외의 용도로는 쓰지 않아요.",
			},
			ios: {
				body: "꼭 필요한 두 가지만 요청해요.\n허용하지 않아도 지도는 그대로 볼 수 있어요.",
			},
			title: "더 정확한 안내를 위해\n권한이 필요해요",
		},
		later: "나중에",
		location: {
			title: "위치",
		},
		notifications: {
			title: "알림",
		},
		/** 카드 설명. iOS는 Figma처럼 두 줄로 끊고, Android는 한 줄로 둔다. */
		purpose: {
			android: {
				location: "내 주변 역과 정류장을 바로 보여줘요",
				notifications: "출퇴근 시간에 잠금화면에 도착 정보를 띄워요",
			},
			ios: {
				location: "내 주변 역과 정류장을\n바로 보여줘요",
				notifications: "출퇴근 시간에 잠금화면에\n도착 정보를 띄워요",
			},
		},
		row: {
			allow: "허용",
			allowed: "허용됨",
			openSettings: "설정 앱에서 {title} 권한을 켤 수 있어요",
			request: "{title} 권한을 요청해요",
		},
		settingsHint: "설정에서 언제든 바꿀 수 있어요",
	},
	/** 16 장소 설정 */
	placeSetup: {
		addAlternative: "대안 경로 추가",
		addLeg: "구간 추가",
		alternativeLimit: "대안은 3개까지 등록할 수 있어요",
		alternativeTitle: "대안 {n}",
		delete: {
			cancel: "취소",
			confirm: "한 번 더 누르면 지워요",
			label: "장소 삭제",
		},
		/** 이름 없는 기타 장소의 도보 줄에 쓰는 목적지 */
		destination: "목적지",
		/** 구간이 없는 기본 경로 카드 */
		emptyRoute: "버스나 지하철 구간을 하나 이상 추가해 주세요",
		holidays: {
			subtitle: "꺼 두면 공휴일과 대체공휴일에는 띄우지 않아요",
			title: "공휴일에도 띄우기",
		},
		issue: {
			invalid: "경로를 저장할 수 없어요. 구간을 다시 확인해 주세요",
			nameRequired: "장소 이름을 입력해 주세요",
			noDay: "요일을 하나 이상 골라 주세요",
			noLeg: "기본 경로에 구간을 하나 이상 넣어 주세요",
			tooManyLegs: "경로마다 구간은 4개까지 넣을 수 있어요",
			tooManyRoutes: "대안은 3개까지 등록할 수 있어요",
		},
		leaveTime: "나가는 시각",
		leg: {
			busDetail: "{line}번 · {n}정거장",
			remove: "{line} 구간 지우기",
			walk: "{stop}까지 도보",
		},
		name: {
			label: "이름",
			placeholder: "예: 헬스장",
		},
		note: "잠금화면 안내는 나가는 시각 {m}분 전에 떠요",
		removeAlternative: "대안 지우기",
		save: {
			label: "저장",
			limit: "장소는 16개까지 등록할 수 있어요",
			rejected: "저장하지 못했어요. 경로를 다시 확인해 주세요",
		},
		sections: {
			alternatives: "대안 경로",
			kind: "장소 종류",
			leave: "나가는 시각",
			route: "자주 타는 경로",
		},
		title: {
			edit: "{name} 설정",
			new: "장소 추가",
		},
		weekdays: "요일",
	},
	places: {
		add: "장소 추가",
		addHint: "집, 회사, 학교처럼 자주 가는 곳을 등록해요",
		alternatives: "대안 {n}개",
		/** 카드와 빈 상태의 요일 이름. 월요일부터 읽는다. */
		day: {
			fri: "금",
			mon: "월",
			sat: "토",
			sun: "일",
			thu: "목",
			tue: "화",
			wed: "수",
		},
		dayJoiner: "·",
		daysEvery: "매일",
		daysWeekdays: "평일",
		daysWeekend: "주말",
		edit: "{name} 고치기",
		empty: {
			body: "장소마다 자주 타는 경로와 나가는 시각을 저장해 두면, 그 시각에 맞춰 잠금화면에 띄워 드려요.",
			title: "자주 가는 곳을 등록해 보세요",
		},
		/** 잠금화면과 17 화면의 머리줄. `{name}`은 종류 이름이나 기타 장소의 이름이다. */
		header: {
			home: "퇴근 · {name}까지",
			other: "{name}까지",
			school: "등교 · {name}까지",
			work: "출근 · {name}까지",
		},
		/** 서버에서 가져와 이름이 없는 장소(재설치 뒤 맞추기) */
		importedName: "가져온 경로",
		intro:
			"장소마다 자주 타는 경로와 나가는 시각을 저장해 두면, 그 시각에 맞춰 잠금화면에 띄워 드려요.",
		kind: {
			home: "집",
			other: "기타",
			school: "학교",
			work: "회사",
		},
		legArrow: "{from} → {to}",
		notSynced: "아직 서버에 저장되지 않았어요",
		openGuide: "{name} 출퇴근 안내 열기",
		schedule: "{days} {time} 출발",
		summaryWithAlternatives: "{schedule} · {alternatives}",
		/** 15 화면 제목. 탭 이름(`tabs.commute`)과 다르다. */
		title: "내 장소",
	},
	push: {
		defaultTitle: "알림",
	},
	search: {
		back: "뒤로",
		clearRecents: "모두 지우기",
		clearText: "검색어 지우기",
		empty: {
			body: "역 이름, 정류장 이름이나 번호, 버스 번호로 찾아보세요",
			title: "검색 결과가 없어요",
		},
		failed: {
			body: "인터넷 연결을 확인하고 다시 시도해 주세요",
			title: "검색 자료를 불러오지 못했어요",
		},
		/** 역 배지에 쓰는 노선 이름. 키는 노선 키(`seoul-subway:line2`의 `line2`)다. */
		lineName: {
			airport: "공항철도",
			gtxA: "GTX-A",
			gyeongchun: "경춘선",
			gyeonggang: "경강선",
			gyeonguiJungang: "경의중앙선",
			line1: "1호선",
			line2: "2호선",
			line3: "3호선",
			line4: "4호선",
			line5: "5호선",
			line6: "6호선",
			line7: "7호선",
			line8: "8호선",
			line9: "9호선",
			seohae: "서해선",
			shinbundang: "신분당선",
			sillim: "신림선",
			suinBundang: "수인분당선",
			uiSinseol: "우이신설선",
		},
		loading: "검색 자료를 불러오는 중이에요",
		placeholder: "역, 정류장, 버스 번호 검색",
		retry: "다시 시도",
		scope: {
			all: "전체",
			label: "검색 범위",
			route: "버스 노선",
			station: "역",
			stop: "정류장",
		},
		section: {
			recents: "최근 검색",
			routes: "버스 노선",
			stations: "역",
			stops: "정류장",
		},
		stopSubtitle: "{arsId} · {towards} 방면",
		stopSubtitleArsId: "{arsId}",
		stopSubtitleTowards: "{towards} 방면",
	},
	settings: {
		buildings3d: {
			title: "3D 건물",
		},
		commuteLockScreen: {
			title: "출퇴근 잠금화면 안내",
		},
		/** 개발 빌드에서만 보이는 행과 Alert. */
		crashTest: {
			cancel: "취소",
			messageActive: "Sentry로 보낼 시험을 고르세요.",
			messageInactive:
				"Sentry DSN이 없어 아무것도 보내지 않아요. .env에 EXPO_PUBLIC_SENTRY_DSN을 넣고 Metro를 다시 시작하세요.",
			nativeCrash: "네이티브 크래시",
			sendException: "테스트 예외 보내기",
			subtitle:
				"개발 빌드에서만 보여요. 테스트 예외나 네이티브 크래시를 보내요",
			title: "크래시 시험",
		},
		dataSaver: {
			title: "데이터 절약 모드",
		},
		dataSources: {
			title: "데이터 출처",
		},
		licenses: {
			title: "오픈소스 라이선스",
		},
		/** `EXPO_PUBLIC_LOCK_SAMPLES=1`일 때만 보이는 행과 화면. 표본 값으로 잠금화면을 띄운다. */
		lockSamples: {
			endAll: "표본 모두 끝내기",
			failed: "표본을 띄우지 못했어요",
			intro:
				"사례를 누르면 그 값으로 잠금화면 안내를 띄워요. 시각은 지금 기준으로 옮겨요.",
			subtitle: "표본 값으로 잠금화면 안내를 띄워요",
			title: "잠금화면 표본",
		},
		mapLines: {
			empty: "등록한 경로가 없어요",
			title: "노선별 지도 표시",
		},
		mapQuality: {
			high3d: "고화질 3D",
			standard: "표준",
			title: "지도 품질",
		},
		/** 개발 빌드에서만 보이는 행. 출시 기준 7.2(뒤로 가거나 순간이동한 위치 갱신 비율)의 오늘 숫자다. */
		motionMetrics: {
			subtitle:
				"오늘 갱신 {updates}건 · 뒤로 {backward} · 순간이동 {jump} · {percent}%",
			title: "지도 움직임 지표",
		},
		privacy: {
			title: "개인정보 처리방침",
		},
		sections: {
			about: "정보",
			developer: "개발",
			display: "화면",
			mapLines: "내 노선",
			notifications: "알림",
		},
		smoothMotion: {
			subtitle: "위치를 보간해 자연스럽게 움직여요",
			title: "부드러운 차량 이동",
		},
		theme: {
			dark: "다크",
			light: "라이트",
			system: "시스템",
			title: "테마",
		},
		version: {
			title: "버전",
		},
	},
	/** 08 역 상세 */
	stationDetail: {
		arrivals: "{line} 도착 정보",
		direction: "{name} 방면",
		favorite: "즐겨찾기",
		favoriteRemove: "즐겨찾기 해제",
		first: "첫차",
		firstLast: "첫차 · 막차",
		last: "막차",
		loading: "도착 정보를 불러오는 중이에요",
		noArrivals: "곧 도착하는 열차 정보가 없어요",
		noService: "오늘은 운행 정보가 없어요",
		notFound: {
			body: "검색에서 다시 찾아 주세요",
			title: "찾을 수 없는 역이에요",
		},
		retry: "다시 시도",
		unavailable: {
			body: "인터넷 연결을 확인하고 다시 시도해 주세요",
			title: "도착 정보를 불러오지 못했어요",
		},
	},
	/** 08 정류장 상세 */
	stopDetail: {
		direction: "{name} 방면",
		favorite: "즐겨찾기",
		favoriteRemove: "즐겨찾기 해제",
		loading: "노선 정보를 불러오는 중이에요",
		noRoutes: "지나는 노선 정보가 없어요",
		notice: "버스 노선을 누르면 실시간 도착을 볼 수 있어요",
		retry: "다시 시도",
		routes: "지나는 노선",
		unavailable: {
			body: "인터넷 연결을 확인하고 다시 시도해 주세요",
			title: "노선 정보를 불러오지 못했어요",
		},
	},
	tabs: {
		commute: "출퇴근",
		favorites: "즐겨찾기",
		map: "지도",
		settings: "설정",
	},
	/** 06 열차 상세 */
	trainDetail: {
		direction: {
			down: "하행",
			up: "상행",
		},
		express: "급행",
		gone: "이 열차의 위치를 더 받지 못했어요",
		nextStation: "다음 역",
		noTimetable: "이 열차의 시간표 정보가 없어요",
		notice: "열차 위치는 역 도착 신호와 시간표로 계산돼요",
		subtitle: "{destination}행 · {direction}",
		title: "{trainNo} 열차",
	},
	transit: {
		region: {
			gyeonggi: "경기",
			incheon: "인천",
		},
	},
} as const;
