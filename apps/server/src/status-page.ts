import type {
	CollectorHealth,
	CollectorStatus,
	LineStatus,
	MetricsBucket,
	SourceStatus,
} from "@Betro/realtime/metrics";

const KST_OFFSET_MS = 9 * 3_600_000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const BUCKET_MS = 5 * MINUTE_MS;
const PERCENT = 100;
/** 페이지가 스스로 다시 읽는 간격(초). 스크립트 없이 `<meta http-equiv="refresh">`. */
const REFRESH_SECONDS = 60;

const CHART_WIDTH = 600;
const CHART_HEIGHT = 140;
const CHART_PAD_LEFT = 44;
const CHART_PAD_RIGHT = 8;
const CHART_PAD_TOP = 8;
const CHART_PAD_BOTTOM = 20;

const HEALTH_LABEL: Readonly<Record<CollectorHealth, string>> = {
	delayed: "지연",
	"off-hours": "운행 시간 아님",
	ok: "정상",
	stalled: "멈춤",
};

const SOURCE_LABEL: Readonly<Record<string, string>> = {
	bus: "버스",
	subway: "지하철",
};

const SERIES_SOURCES = ["subway", "bus"] as const;

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

/** epoch ms → KST `YYYY-MM-DD HH:MM:SS`. */
export function formatKst(ms: number | null): string {
	if (ms === null) {
		return "—";
	}
	const iso = new Date(ms + KST_OFFSET_MS).toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** epoch ms → KST `HH:MM`. */
function formatKstClock(ms: number): string {
	return new Date(ms + KST_OFFSET_MS).toISOString().slice(11, 16);
}

function formatDuration(ms: number | null): string {
	if (ms === null) {
		return "—";
	}
	if (ms < MINUTE_MS) {
		return `${Math.round(ms / SECOND_MS)}초`;
	}
	if (ms < HOUR_MS) {
		const minutes = Math.floor(ms / MINUTE_MS);
		const seconds = Math.round((ms % MINUTE_MS) / SECOND_MS);
		return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`;
	}
	const hours = Math.floor(ms / HOUR_MS);
	const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
	return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

function formatRatio(value: number | null): string {
	return value === null ? "—" : `${Math.round(value * PERCENT)}%`;
}

function formatErrors(errors: SourceStatus["errorsToday"]): string {
	const parts = Object.entries(errors)
		.filter(([, count]) => (count ?? 0) > 0)
		.map(([outcome, count]) => `${outcome} ${count}`);
	return parts.length === 0 ? "없음" : parts.join(", ");
}

function sourceLabel(name: string): string {
	return SOURCE_LABEL[name] ?? name;
}

function healthBadge(health: CollectorHealth): string {
	return `<span class="badge ${health}">${escapeHtml(HEALTH_LABEL[health])}</span>`;
}

function renderSummary(status: CollectorStatus): string {
	const parts = status.sources
		.map(
			(source) =>
				`<li>${escapeHtml(sourceLabel(source.name))} ${healthBadge(source.health)}</li>`
		)
		.join("");
	return `<section class="summary ${status.overall}">
<p class="overall">수집 상태 <strong>${escapeHtml(HEALTH_LABEL[status.overall])}</strong></p>
<ul class="per-source">${parts}</ul>
<p class="meta">모드 ${escapeHtml(status.mode)} · ${escapeHtml(formatKst(status.generatedAt))} KST 기준</p>
</section>`;
}

function renderSources(sources: readonly SourceStatus[]): string {
	const rows = sources
		.map(
			(source) => `<tr class="source-row">
<th scope="row">${escapeHtml(sourceLabel(source.name))}</th>
<td>${healthBadge(source.health)}</td>
<td>${escapeHtml(formatKst(source.lastSuccessAt))}</td>
<td>${escapeHtml(formatDuration(source.freshnessMs))}</td>
<td>${source.usedToday} / 남음 ${source.remainingToday}</td>
<td>${escapeHtml(formatErrors(source.errorsToday))}</td>
</tr>`
		)
		.join("\n");
	return `<section>
<h2>소스</h2>
<div class="scroll"><table>
<thead><tr><th scope="col">소스</th><th scope="col">상태</th><th scope="col">마지막 성공(KST)</th><th scope="col">신선도</th><th scope="col">오늘 호출</th><th scope="col">오늘 오류</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
</section>`;
}

function renderLines(lines: readonly LineStatus[]): string {
	const rows = lines
		.map(
			(line) => `<tr class="line-row">
<th scope="row">${escapeHtml(line.key)}</th>
<td>${line.vehicles}</td>
<td>${escapeHtml(formatRatio(line.baselineRatio))}</td>
<td>${escapeHtml(formatRatio(line.matchRate))}</td>
<td>${line.unknownStations}</td>
<td>${line.backwards}</td>
</tr>`
		)
		.join("\n");
	const body =
		lines.length === 0
			? '<p class="empty">보이는 노선이 없습니다.</p>'
			: `<div class="scroll"><table>
<thead><tr><th scope="col">노선</th><th scope="col">차량</th><th scope="col">7일 대비</th><th scope="col">매칭률</th><th scope="col">미매칭 역</th><th scope="col">역행</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
	return `<section>
<h2>노선</h2>
${body}
</section>`;
}

interface ChartSpec {
	title: string;
	unit: string;
	value: (bucket: MetricsBucket) => number | null;
}

const sumValues = (record: Record<string, number>): number =>
	Object.values(record).reduce((total, value) => total + value, 0);

const CHARTS: readonly ChartSpec[] = [
	{ title: "5분 호출 수", unit: "건", value: (bucket) => bucket.calls },
	{
		title: "신선도",
		unit: "초",
		value: (bucket) =>
			bucket.maxFreshnessMs === null
				? null
				: Math.round(bucket.maxFreshnessMs / SECOND_MS),
	},
	{
		title: "차량 수",
		unit: "대",
		value: (bucket) => sumValues(bucket.vehicles),
	},
];

interface Point {
	t: number;
	v: number;
}

/** 5분 칸이 비면 선을 끊는다(멈춘 구간이 그래프에 빈칸으로 보이게). */
function splitRuns(points: readonly Point[]): Point[][] {
	const runs: Point[][] = [];
	let current: Point[] = [];
	for (const point of points) {
		const last = current.at(-1);
		if (last && point.t - last.t > BUCKET_MS) {
			runs.push(current);
			current = [];
		}
		current.push(point);
	}
	if (current.length > 0) {
		runs.push(current);
	}
	return runs;
}

function renderChart(
	spec: ChartSpec,
	series: readonly MetricsBucket[],
	from: number,
	to: number
): string {
	const pointsBySource = SERIES_SOURCES.map((source) => {
		const points: Point[] = [];
		for (const bucket of series) {
			const v = bucket.source === source ? spec.value(bucket) : null;
			if (
				v !== null &&
				bucket.bucketStart >= from &&
				bucket.bucketStart <= to
			) {
				points.push({ t: bucket.bucketStart, v });
			}
		}
		return { points, source };
	});
	const maxValue = Math.max(
		1,
		...pointsBySource.flatMap(({ points }) => points.map((p) => p.v))
	);
	const plotW = CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT;
	const plotH = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
	const x = (t: number): string =>
		(CHART_PAD_LEFT + ((t - from) / Math.max(1, to - from)) * plotW).toFixed(1);
	const y = (v: number): string =>
		(CHART_PAD_TOP + plotH - (v / maxValue) * plotH).toFixed(1);
	const lines = pointsBySource
		.flatMap(({ points, source }) =>
			splitRuns(points).map((run) => {
				const coords = run.map((p) => `${x(p.t)},${y(p.v)}`).join(" ");
				return run.length === 1
					? `<circle class="s-${source}" cx="${x(run[0]?.t ?? from)}" cy="${y(run[0]?.v ?? 0)}" r="2"/>`
					: `<polyline class="s-${source}" points="${coords}"/>`;
			})
		)
		.join("");
	const baseY = CHART_PAD_TOP + plotH;
	const label = `${spec.title}(${spec.unit}), 지난 24시간`;
	return `<figure>
<figcaption>${escapeHtml(spec.title)} <span class="unit">(${escapeHtml(spec.unit)})</span></figcaption>
<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="${escapeHtml(label)}" preserveAspectRatio="none">
<title>${escapeHtml(label)}</title>
<line class="axis" x1="${CHART_PAD_LEFT}" y1="${baseY}" x2="${CHART_WIDTH - CHART_PAD_RIGHT}" y2="${baseY}"/>
<line class="axis" x1="${CHART_PAD_LEFT}" y1="${CHART_PAD_TOP}" x2="${CHART_PAD_LEFT}" y2="${baseY}"/>
<text class="tick" x="${CHART_PAD_LEFT - 4}" y="${CHART_PAD_TOP + 10}" text-anchor="end">${maxValue}</text>
<text class="tick" x="${CHART_PAD_LEFT - 4}" y="${baseY}" text-anchor="end">0</text>
<text class="tick" x="${CHART_PAD_LEFT}" y="${CHART_HEIGHT - 4}">${formatKstClock(from)}</text>
<text class="tick" x="${CHART_WIDTH - CHART_PAD_RIGHT}" y="${CHART_HEIGHT - 4}" text-anchor="end">${formatKstClock(to)}</text>
${lines}
</svg>
</figure>`;
}

function renderCharts(status: CollectorStatus): string {
	const to = status.generatedAt;
	const from = to - DAY_MS;
	const legend = SERIES_SOURCES.map(
		(source) =>
			`<span class="legend"><span class="swatch s-${source}"></span>${escapeHtml(sourceLabel(source))}</span>`
	).join(" ");
	const charts = CHARTS.map((spec) =>
		renderChart(spec, status.series, from, to)
	).join("\n");
	return `<section>
<h2>지난 24시간</h2>
<p class="legends">${legend}</p>
${charts}
</section>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--ok:#1b7f3b;--delayed:#b26a00;--stalled:#c62828;--off:#607d8b;--subway:#1565c0;--bus:#2e7d32}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--muted:#aaa;--line:#333;--ok:#66bb6a;--delayed:#ffb74d;--stalled:#ef5350;--off:#90a4ae;--subway:#64b5f6;--bus:#81c784}}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;max-width:860px;margin-inline:auto}
h1{font-size:1.2rem;margin:0 0 12px}
h2{font-size:1rem;margin:24px 0 8px}
.summary{border:1px solid var(--line);border-left:6px solid var(--off);border-radius:8px;padding:12px}
.summary.ok{border-left-color:var(--ok)}.summary.delayed{border-left-color:var(--delayed)}.summary.stalled{border-left-color:var(--stalled)}
.overall{margin:0;font-size:1.1rem}.overall strong{font-size:1.4rem}
.per-source{list-style:none;padding:0;margin:8px 0 0;display:flex;gap:12px;flex-wrap:wrap}
.meta,.empty,.unit{color:var(--muted);font-size:.85rem}
.meta{margin:8px 0 0}
.badge{display:inline-block;padding:0 8px;border-radius:999px;color:#fff;font-size:.85rem;background:var(--off)}
.badge.ok{background:var(--ok)}.badge.delayed{background:var(--delayed)}.badge.stalled{background:var(--stalled)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
tbody th{font-weight:600}
figure{margin:0 0 16px}
figcaption{font-size:.9rem;margin-bottom:4px}
svg{width:100%;height:140px;display:block}
.axis{stroke:var(--line);stroke-width:1}
.tick{fill:var(--muted);font-size:10px}
polyline{fill:none;stroke-width:1.5;vector-effect:non-scaling-stroke}
polyline.s-subway{stroke:var(--subway)}polyline.s-bus{stroke:var(--bus)}
circle.s-subway{fill:var(--subway)}circle.s-bus{fill:var(--bus)}
.legends{margin:0 0 8px;font-size:.85rem}
.legend{margin-right:12px}
.swatch{display:inline-block;width:12px;height:3px;margin-right:4px;vertical-align:middle}
.swatch.s-subway{background:var(--subway)}.swatch.s-bus{background:var(--bus)}
`;

/**
 * 상태 페이지(한 장). 맨 위 요약, 소스 표, 노선 표, 지난 24시간 SVG 그래프 3개.
 * 스크립트는 넣지 않는다. 시각은 KST로 보인다.
 */
export function renderStatusPage(status: CollectorStatus): string {
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${REFRESH_SECONDS}">
<title>Betro 수집 상태</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Betro 수집 상태</h1>
${renderSummary(status)}
${renderSources(status.sources)}
${renderLines(status.lines)}
${renderCharts(status)}
</body>
</html>
`;
}
