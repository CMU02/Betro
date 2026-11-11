/**
 * 앱의 한국어 사용자 문구. 화면은 문구를 직접 쓰지 않고 `t("키")`로 가져온다.
 *
 * - 키는 `화면.덩어리.역할` 순서로 짓는다. 예: `settings.theme.title`.
 * - 값의 `{이름}`은 `t(key, { 이름: 값 })`으로 채운다.
 * - 문구를 바꿀 때는 Figma 문구 표(`docs/superpowers/plans/2026-11-05-mvp-1-app-foundation.md`의 "문구 변경")를 함께 고친다.
 */
export const ko = {
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
				beforeLeave: "{leave}에 나가세요",
				passedBus: "{passedLine}번이 지나갔어요 · 다음 차 {eta}",
				passedSubway: "{passedLine} 열차가 지나갔어요 · 다음 열차 {eta}",
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
				subtitle: "버스 위치·노선·정류소, 서울교통공사 시간표",
				title: "공공데이터포털",
			},
			kric: {
				subtitle: "철도산업정보센터 · 광역철도 시간표",
				title: "국가철도공단",
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
		mapQuality: {
			high3d: "고화질 3D",
			standard: "표준",
			title: "지도 품질",
		},
		sections: {
			about: "정보",
			developer: "개발",
			display: "화면",
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
	tabs: {
		commute: "출퇴근",
		favorites: "즐겨찾기",
		map: "지도",
		settings: "설정",
	},
	transit: {
		region: {
			gyeonggi: "경기",
			incheon: "인천",
		},
	},
} as const;
