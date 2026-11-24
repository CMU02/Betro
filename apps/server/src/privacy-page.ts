const HTML_ESCAPES: Readonly<Record<string, string>> = {
	"'": "&#39;",
	'"': "&quot;",
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
};
const HTML_SPECIAL = /[&<>"']/g;

function escapeHtml(text: string): string {
	return text.replace(HTML_SPECIAL, (ch) => HTML_ESCAPES[ch] ?? ch);
}

const STYLE =
	"body{font:16px/1.65 -apple-system,system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1.5rem 1rem 3rem;color:#1c1c1e;background:#fff}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem}li{margin:.25rem 0}.meta{color:#6b6b70;font-size:.875rem}@media(prefers-color-scheme:dark){body{color:#f2f2f7;background:#000}.meta{color:#a1a1a6}}";

interface Section {
	items: readonly string[];
	title: string;
}

/** 스펙 5.2. 서버가 받는 것과 받지 않는 것을 사실대로 적는다. 스크립트·외부 자원은 쓰지 않는다. */
const SECTIONS: readonly Section[] = [
	{
		items: [
			"설치 ID(앱을 설치할 때 만들어지는 임의의 값)와 플랫폼(iOS 또는 Android)",
			"푸시 알림을 보내기 위한 기기 푸시 토큰",
			"출퇴근 경로의 구간(노선·정류장·역)과 나가는 시각·요일",
			"지도에서 보는 노선과 즐겨찾기한 정류장의 ID(실시간 정보를 가져오는 동안에만 쓰고 저장하지 않아요)",
		],
		title: "서버가 받는 정보",
	},
	{
		items: [
			"크래시 보고: 앱이 멈춘 원인을 찾기 위해 Sentry로 보내요. 이름·연락처 같은 개인 식별 정보는 담지 않고, 설치 ID로 묶어요.",
			"하루 지도 지표: 지도 움직임을 점검하기 위한 숫자만 하루에 한 번 보내요.",
		],
		title: "점검을 위해 보내는 정보",
	},
	{
		items: [
			"주소, 좌표, 장소 이름은 서버로 보내지 않아요.",
			"현재 위치는 기기 안에서만 쓰고 서버에 올리지 않아요.",
			"즐겨찾기와 장소의 목록과 이름은 기기에만 저장돼요.",
		],
		title: "받지 않는 정보",
	},
	{
		items: ["앱에서 장소를 지우면 그 장소의 경로가 서버에서 함께 지워져요."],
		title: "정보를 지우는 방법",
	},
	{
		items: [
			"광고 추적을 하지 않고, 광고 SDK도 쓰지 않아요.",
			"받은 정보를 제3자에게 팔거나 광고에 쓰지 않아요.",
		],
		title: "광고와 추적",
	},
];

/** 개인정보 처리방침 HTML. 연락처가 없으면 문의 줄을 뺀다. */
export function renderPrivacyPage(input: {
	contact: string | null;
	updatedOn: string;
}): string {
	const sections = SECTIONS.map(
		(section) =>
			`<h2>${escapeHtml(section.title)}</h2><ul>${section.items
				.map((item) => `<li>${escapeHtml(item)}</li>`)
				.join("")}</ul>`
	).join("");
	const contact = input.contact
		? `<h2>문의</h2><p>개인정보에 관한 문의는 ${escapeHtml(input.contact)}로 보내 주세요.</p>`
		: "";
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Betro 개인정보 처리방침</title><style>${STYLE}</style></head><body><h1>Betro 개인정보 처리방침</h1><p class="meta">시행일 ${escapeHtml(input.updatedOn)}</p><p>Betro는 필요한 만큼만 받고, 받는 정보를 아래에 적었어요.</p>${sections}${contact}</body></html>`;
}
