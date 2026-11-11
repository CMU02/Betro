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
