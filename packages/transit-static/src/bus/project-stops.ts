import type { BusRouteStationRow } from "../sources/seoul-bus-api";

/**
 * 첫 정류소의 기대 범위: 앞 정상 정류소 없이 이 거리(미터, lengthM / 2 이하) 밖에 붙으면 비용을 더하고 window-miss. 6411은 약 619m.
 * 실데이터(2026-11-01, 범위 안 471개): 첫 정류소 거리 중앙값 97m, p99 896m, 최대 1290m(707·9707).
 * 이 값을 500m·1000m·무한대로 바꿔도 결과가 바뀌는 노선 0개(0m이면 2114 seq 1만 314→0).
 * 이 분기는 짧은 합성 순환 테스트('short closed loop keeps the first stop near the start')만 고정한다.
 */
export const FIRST_STOP_WINDOW_M = 3000;
/** `window-miss` 판정 창 `[앞 정상 거리, + 2 × apiSectDistM + WINDOW_SLACK_M]`의 여유(미터). */
export const WINDOW_SLACK_M = 1000;
/**
 * 정류소와 모양 사이 오프셋이 이 거리(미터)를 넘으면 경고한다(§6.5). 후보 위치의 한계이기도 하다.
 * 실측(2026-11-01, 471개 노선 34,135개 정류소): 오프셋 중앙값 7.3m, p90 15.6m, p99 29.3m, 60~80m 7개.
 * 80m 초과 86개(46개 노선)는 정류소 11곳에서 나오며 모두 원본 결함 또는 실제 거리다
 * (인천공항T2 73, 터미널·가상 정류소 5, 우회 누락·좌표·순환 끝·순서 8).
 * 60m로 낮추면 93개(52개 노선)로 늘고 배정은 그대로다. 100m로 올리면 81개(45개 노선)로 줄지만
 * 줄어든 5개(광명종합터미널 81.1m ×2, 자유로IC(가상) 88.0m ×3)는 모두 실제 경고다.
 * 또 후보 반경이 넓어져 606·661의 원미구청이 경고 없이 197m 옮겨진다.
 */
export const BUS_STOP_WARN_OFFSET_M = 80;

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
/*
 * sect-dist-mismatch 기준. 2026-11 dry-run, 471 routes / 33,664 segments: 99.16% inside 0.5–2, 92.7% inside 0.9–1.1.
 * Loosening hides repeated API defects, e.g. 신촌오거리.2호선신촌역→이대역 API 836 m vs shape 389 m, ratio 0.466,
 * flagged in 15/15 routes. Remaining warnings checked as API defects, not projection.
 */
const SECT_RATIO_MIN = 0.5;
const SECT_RATIO_MAX = 2;
const SECT_DIFF_MIN_M = 100;
/**
 * stop-off-shape 정류소는 모양 위 가장 가까운 점으로 옮겨지므로, 실제 위치를 거치는 도로 경로는
 * 옮겨진 구간 길이와 최대 왕복 = 2 × offsetM만큼 다를 수 있다. 그 안의 불일치는 정류소 자신의 경고를 되풀이할 뿐이다
 * (모양이 닿지 않는 회차·종점 정류소: 6516 백산초, 240/441 한강버스압구정선착장B, 6617 목동2차우성아파트,
 * 5619 범일운수종점, 100 한성여객종점). 그보다 크면 API 값 자체가 틀린 것이므로 그대로 경고한다.
 */
const OFF_SHAPE_SECT_SLACK_FACTOR = 2;
/** DP 비용: 오프셋 이 거리(미터)마다 1. */
const OFFSET_SCALE_M = 20;
/** DP 비용: 간격이 API 구간 거리 합과 이 거리(미터)만큼 다르면 1. */
const GAP_SCALE_M = 200;
/** DP 간격 비용의 상한이 되는 차이(미터). 상한 비용 = 10. */
const GAP_COST_CAP_M = 2000;
/** DP 비용: 정류소 하나를 건너뛰는(모양에서 먼 정류소로 두는) 비용. 간격 비용 상한보다 커야 한다. */
const SKIP_COST = 12;

export interface ProjectedStop {
	distanceM: number;
	flags: string[];
	offsetM: number;
	seq: number;
}

export interface BusSegment {
	apiSectDistM: number;
	endM: number;
	flags: string[];
	fromSeq: number;
	startM: number;
	toSeq: number;
}

interface PlanarShape {
	/** 각 꼭짓점까지의 누적 거리(미터). */
	cum: number[];
	/** 노선 첫 좌표 기준 등장방형 평면 좌표(미터). */
	points: [number, number][];
	toPlanar: (lng: number, lat: number) => [number, number];
}

interface Candidate {
	distanceM: number;
	offsetM: number;
}

/**
 * 첫 좌표 위도 기준 등장방형 근사(경도 × cos(lat0)).
 * 서울 규모에서 측지 거리와 0.1% 미만 차이이고, 한 노선 안에서 일관되기만 하면 된다.
 */
function toPlanarShape(coords: readonly [number, number][]): PlanarShape {
	const [lng0, lat0] = coords[0] ?? [0, 0];
	const kx = EARTH_RADIUS_M * Math.cos(lat0 * DEG_TO_RAD) * DEG_TO_RAD;
	const ky = EARTH_RADIUS_M * DEG_TO_RAD;
	const toPlanar = (lng: number, lat: number): [number, number] => [
		(lng - lng0) * kx,
		(lat - lat0) * ky,
	];
	const points = coords.map(([lng, lat]) => toPlanar(lng, lat));
	// 좌표가 1개면 길이 0인 선분 하나로 본다.
	if (points.length === 1 && points[0]) {
		points.push(points[0]);
	}
	const cum: number[] = [0];
	for (let i = 1; i < points.length; i += 1) {
		const [ax, ay] = points[i - 1] ?? [0, 0];
		const [bx, by] = points[i] ?? [0, 0];
		cum.push((cum[i - 1] ?? 0) + Math.hypot(bx - ax, by - ay));
	}
	return { cum, points, toPlanar };
}

/** cum[i + 1] >= fromM인 첫 선분 번호(이진 탐색). */
function firstSegmentFrom(cum: readonly number[], fromM: number): number {
	let lo = 0;
	let hi = cum.length - 2;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if ((cum[mid + 1] ?? 0) < fromM) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

/** 선분 i 위에서 점에 가장 가까운 위치(fromM~toM으로 자름). */
function nearestOnSegment(
	shape: PlanarShape,
	i: number,
	[px, py]: [number, number],
	fromM: number,
	toM: number
): Candidate {
	const { cum, points } = shape;
	const segStart = cum[i] ?? 0;
	const segEnd = cum[i + 1] ?? 0;
	const [ax, ay] = points[i] ?? [0, 0];
	const [bx, by] = points[i + 1] ?? [0, 0];
	const segLen = segEnd - segStart;
	const t =
		segLen > 0
			? Math.min(
					1,
					Math.max(
						0,
						((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / segLen ** 2
					)
				)
			: 0;
	const along = Math.min(
		Math.min(toM, segEnd),
		Math.max(Math.max(fromM, segStart), segStart + t * segLen)
	);
	const ratio = segLen > 0 ? (along - segStart) / segLen : 0;
	const offsetM = Math.hypot(
		ax + ratio * (bx - ax) - px,
		ay + ratio * (by - ay) - py
	);
	return { distanceM: along, offsetM };
}

/** 모양의 `[fromM, toM]` 범위 안에서 점에 가장 가까운 위치. fromM <= toM <= lengthM이면 항상 있다. */
function nearestInRange(
	shape: PlanarShape,
	point: [number, number],
	fromM: number,
	toM: number
): Candidate {
	const { cum, points } = shape;
	let best: Candidate | undefined;
	for (let i = firstSegmentFrom(cum, fromM); i < points.length - 1; i += 1) {
		if ((cum[i] ?? 0) > toM) {
			break;
		}
		const candidate = nearestOnSegment(shape, i, point, fromM, toM);
		// 오프셋이 같으면 앞쪽(먼저 찾은) 위치를 둔다.
		if (best === undefined || candidate.offsetM < best.offsetM) {
			best = candidate;
		}
	}
	if (best === undefined) {
		throw new Error(
			`nearestInRange: empty range [${fromM}, ${toM}] on the shape`
		);
	}
	return best;
}

/**
 * 정류소가 모양에 붙을 수 있는 후보 위치들.
 * 점에서 BUS_STOP_WARN_OFFSET_M 안을 지나는 연속 선분 묶음마다, 그 안의 최근접 위치 1개.
 * 같은 도로를 왕복하면 보통 가는 길·오는 길 후보 2개가 나온다.
 */
function candidatesFor(
	shape: PlanarShape,
	point: [number, number]
): Candidate[] {
	const { cum, points } = shape;
	const [px, py] = point;
	const limit = BUS_STOP_WARN_OFFSET_M;
	const found: Candidate[] = [];
	let run: Candidate | undefined;
	for (let i = 0; i < points.length - 1; i += 1) {
		const [ax, ay] = points[i] ?? [0, 0];
		const [bx, by] = points[i + 1] ?? [0, 0];
		// 선분 외접 사각형을 limit만큼 넓혀도 점이 밖이면 오프셋이 limit보다 크다.
		const outside =
			px < Math.min(ax, bx) - limit ||
			px > Math.max(ax, bx) + limit ||
			py < Math.min(ay, by) - limit ||
			py > Math.max(ay, by) + limit;
		const candidate = outside
			? undefined
			: nearestOnSegment(shape, i, point, cum[i] ?? 0, cum[i + 1] ?? 0);
		if (candidate === undefined || candidate.offsetM > limit) {
			if (run) {
				found.push(run);
				run = undefined;
			}
			continue;
		}
		if (run === undefined || candidate.offsetM < run.offsetM) {
			run = candidate;
		}
	}
	if (run) {
		found.push(run);
	}
	return found;
}

/** 두 정류소 위치 간격이 API 구간 거리 합과 다른 만큼의 비용(상한 있음: API 값 하나가 터무니없어도 영향이 제한된다). */
function gapCost(gapM: number, expectedM: number): number {
	return Math.min(Math.abs(gapM - expectedM), GAP_COST_CAP_M) / GAP_SCALE_M;
}

interface DpNode {
	candidate: Candidate;
	cost: number;
	/** 앞 정상 정류소 [stop 번호, 후보 번호]. 없으면 앞 정류소를 모두 건너뛴 시작. */
	prev: [number, number] | undefined;
}

/**
 * 정류소 i를 후보 candidate에 둘 때의 가장 싼 DP 노드.
 * 앞 정상 정류소 j(그 사이 정류소는 건너뜀)의 후보 중 거리가 candidate 이하인 것에서 잇는다.
 */
function cheapestNode(
	stops: readonly BusRouteStationRow[],
	dp: readonly DpNode[][],
	i: number,
	candidate: Candidate,
	firstWindowM: number
): DpNode {
	// 앞 정류소를 모두 건너뛰고 여기서 시작. 첫 창 밖이면 상한 간격 비용을 더한다.
	const outsideFirstWindow = candidate.distanceM > firstWindowM;
	let cost =
		i * SKIP_COST + (outsideFirstWindow ? GAP_COST_CAP_M / GAP_SCALE_M : 0);
	let prev: [number, number] | undefined;
	let expectedM = 0;
	for (let j = i - 1; j >= 0; j -= 1) {
		expectedM += stops[j + 1]?.apiSectDistM ?? 0;
		const skipCost = (i - j - 1) * SKIP_COST;
		// 비용은 음수가 아니므로 더 앞 정류소에서 이어도 이보다 싸질 수 없다.
		if (skipCost >= cost) {
			break;
		}
		for (const [l, node] of (dp[j] ?? []).entries()) {
			const gapM = candidate.distanceM - node.candidate.distanceM;
			if (gapM < 0) {
				continue;
			}
			const total = node.cost + skipCost + gapCost(gapM, expectedM);
			if (total < cost) {
				cost = total;
				prev = [j, l];
			}
		}
	}
	return { candidate, cost: cost + candidate.offsetM / OFFSET_SCALE_M, prev };
}

/**
 * 정류소별 후보 중 하나를 고르거나 건너뛰어(모양에서 먼 정류소) 거리가 감소하지 않는 배정 중
 * 비용 합이 가장 작은 것을 찾는다(단조 DP).
 * 비용 = 오프셋 / OFFSET_SCALE_M + 앞 정상 정류소와의 간격 비용 + 건너뛴 정류소마다 SKIP_COST.
 * 반환: 정류소별로 고른 후보(건너뛰면 undefined).
 */
function chooseCandidates(
	stops: readonly BusRouteStationRow[],
	candidates: readonly Candidate[][],
	firstWindowM: number
): (Candidate | undefined)[] {
	const dp: DpNode[][] = [];
	for (const [i, options] of candidates.entries()) {
		dp.push(
			options.map((candidate) =>
				cheapestNode(stops, dp, i, candidate, firstWindowM)
			)
		);
	}
	// 끝: 뒤 정류소를 모두 건너뛴 비용까지 더해 가장 싼 마지막 정상 정류소를 고른다.
	let bestCost = stops.length * SKIP_COST;
	let best: [number, number] | undefined;
	for (const [i, nodes] of dp.entries()) {
		for (const [k, node] of nodes.entries()) {
			const total = node.cost + (stops.length - 1 - i) * SKIP_COST;
			if (total < bestCost) {
				bestCost = total;
				best = [i, k];
			}
		}
	}
	const chosen: (Candidate | undefined)[] = stops.map(() => undefined);
	while (best) {
		const [i, k] = best;
		const node = dp[i]?.[k];
		chosen[i] = node?.candidate;
		best = node?.prev;
	}
	return chosen;
}

/** 정류소마다 그 정류소 이후(자신 포함) 첫 정상 정류소의 거리. 없으면 lengthM. */
function nextAnchorDistances(
	chosen: readonly (Candidate | undefined)[],
	lengthM: number
): number[] {
	const result: number[] = [];
	let upcoming = lengthM;
	for (let i = chosen.length - 1; i >= 0; i -= 1) {
		upcoming = chosen[i]?.distanceM ?? upcoming;
		result[i] = upcoming;
	}
	return result;
}

/**
 * 정류소를 seq 순으로 모양 위에 투영한다. distanceM은 seq 순으로 감소하지 않는다.
 * 같은 도로를 왕복하는 노선에서 전역 최근접은 오는 길 정류소를 가는 길에 붙이므로,
 * 정류소마다 모양 위 후보 위치(오프셋 BUS_STOP_WARN_OFFSET_M 이하)를 모두 구하고,
 * 단조 DP로 오프셋·apiSectDistM 간격과 가장 잘 맞는 배정을 고른다(chooseCandidates).
 * 입력 stops는 seq 오름차순이라고 가정하고 결과도 같은 순서다.
 *
 * 계획과 다른 점(Task 5 리뷰 반영, 계획의 탐욕 전진 창 대신):
 * - 탐욕 창은 좌표가 100~500m 틀린 정류소 하나가 왕복 노선의 오는 길이나 옆 도로에 붙으면
 *   cursor가 앞으로 뛰어 뒤 정류소 수십~백여 개를 끌고 갔다. DP는 그런 배정이 뒤 정류소를
 *   건너뛰게 만들어 비싸므로 그 정류소 하나만 건너뛴다.
 * - 건너뛴 정류소(후보 없음 포함)는 앞뒤 정상 정류소 사이 `[앞 거리, 다음 정상 거리]`에서 최근접에
 *   둔다. 그 오프셋이 80m를 넘으면 `stop-off-shape`.
 * - 고른 위치가 옛 창 `[앞 정상 거리, + 2 × 건너뛴 구간 포함 apiSectDistM + WINDOW_SLACK_M]` 밖이면
 *   `window-miss`. 앞 정상 정류소가 없으면 창은 `[0, 첫 창 + (첫 정류소가 아니면 2 × 그 앞 apiSectDistM 합 + WINDOW_SLACK_M)]`.
 * - 첫 창은 min(FIRST_STOP_WINDOW_M, lengthM / 2)이고, 앞 정상 정류소 없이 첫 창 밖에 붙으면
 *   간격 비용 상한만큼 더 든다. 짧은 순환 노선에서 첫 정류소가 모양 끝에 붙는 것을 막는다.
 */
export function projectStopsForward(
	coords: [number, number][],
	stops: readonly BusRouteStationRow[]
): { lengthM: number; stops: ProjectedStop[] } {
	if (coords.length === 0) {
		throw new Error("projectStopsForward: coords must not be empty");
	}
	const shape = toPlanarShape(coords);
	const lengthM = shape.cum.at(-1) ?? 0;
	const firstWindowM = Math.min(FIRST_STOP_WINDOW_M, lengthM / 2);
	const points = stops.map((s) => shape.toPlanar(s.lng, s.lat));
	const candidates = points.map((point) => candidatesFor(shape, point));
	const chosen = chooseCandidates(stops, candidates, firstWindowM);
	const nextAnchorM = nextAnchorDistances(chosen, lengthM);

	const projected: ProjectedStop[] = [];
	let previousM = 0;
	/** 옛 전진 창의 끝(window-miss 판정용). 정상 정류소가 아직 없으면 첫 창부터. */
	let windowStartM = firstWindowM;
	let windowSlackM = 0;
	/** 마지막 정상 정류소 뒤로 쌓인 apiSectDistM(첫 정류소의 값은 빼고). */
	let sectSinceAnchorM = 0;
	for (const [i, stop] of stops.entries()) {
		if (i > 0) {
			sectSinceAnchorM += stop.apiSectDistM;
			windowSlackM = WINDOW_SLACK_M;
		}
		const flags: string[] = [];
		const anchored = chosen[i];
		if (anchored) {
			const windowEndM = windowStartM + 2 * sectSinceAnchorM + windowSlackM;
			if (anchored.distanceM > windowEndM) {
				flags.push("window-miss");
			}
			projected.push({ ...anchored, flags, seq: stop.seq });
			previousM = anchored.distanceM;
			windowStartM = anchored.distanceM;
			sectSinceAnchorM = 0;
			continue;
		}
		// 건너뛴 정류소: 앞 정류소와 다음 정상 정류소 사이에서 최근접.
		const upperM = Math.max(previousM, nextAnchorM[i] ?? lengthM);
		const placed = nearestInRange(
			shape,
			points[i] ?? [0, 0],
			previousM,
			upperM
		);
		if (placed.offsetM > BUS_STOP_WARN_OFFSET_M) {
			flags.push("stop-off-shape");
		}
		projected.push({ ...placed, flags, seq: stop.seq });
		previousM = placed.distanceM;
	}
	return { lengthM, stops: projected };
}

/** 인접한 두 정류소마다 구간 1개. apiSectDistM은 뒤(toSeq) 정류소의 fullSectDist. */
export function buildSegments(
	stops: readonly BusRouteStationRow[],
	projected: readonly ProjectedStop[]
): BusSegment[] {
	if (stops.length !== projected.length) {
		throw new Error(
			`buildSegments: ${stops.length} stops but ${projected.length} projections`
		);
	}
	const segments: BusSegment[] = [];
	for (let i = 1; i < stops.length; i += 1) {
		const from = projected[i - 1];
		const to = projected[i];
		const fromStop = stops[i - 1];
		const toStop = stops[i];
		// 길이를 위에서 맞췄으므로 모두 있다. noUncheckedIndexedAccess용 확인이며, 깨지면 조용히 넘기지 않는다.
		if (!(from && to && fromStop && toStop)) {
			throw new Error(`buildSegments: missing entry at index ${i}`);
		}
		if (from.seq !== fromStop.seq || to.seq !== toStop.seq) {
			throw new Error(`buildSegments: seq mismatch at index ${i}`);
		}
		const startM = from.distanceM;
		const endM = to.distanceM;
		const { apiSectDistM } = toStop;
		const lengthM = endM - startM;
		const flags: string[] = [];
		if (lengthM === 0) {
			flags.push("zero-length-segment");
		}
		// apiSectDistM이 0이고 길이도 0이면 비율이 NaN이라 비교가 모두 false다(불일치로 보지 않음).
		const ratio = lengthM / apiSectDistM;
		const ratioOff = ratio < SECT_RATIO_MIN || ratio > SECT_RATIO_MAX;
		const diffM = Math.abs(lengthM - apiSectDistM);
		const offShapeM = Math.max(
			0,
			...[from, to]
				.filter((s) => s.flags.includes("stop-off-shape"))
				.map((s) => s.offsetM)
		);
		const explainedByOffShape =
			offShapeM > 0 && diffM <= OFF_SHAPE_SECT_SLACK_FACTOR * offShapeM;
		if (ratioOff && diffM > SECT_DIFF_MIN_M && !explainedByOffShape) {
			flags.push("sect-dist-mismatch");
		}
		segments.push({
			apiSectDistM,
			endM,
			flags,
			fromSeq: from.seq,
			startM,
			toSeq: to.seq,
		});
	}
	return segments;
}
