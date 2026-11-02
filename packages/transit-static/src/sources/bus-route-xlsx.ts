import { readSheet } from "read-excel-file/node";

export const BUS_ROUTE_XLSX_SOURCE = "oa-1095-bus-route-xlsx";
export const DEFAULT_BUS_ROUTE_XLSX_SEQ = 58;

// datafile.seoul.go.kr은 HTTPS를 지원하므로 HTTPS를 쓴다. infSeq=1은 오류 HTML 페이지가 온다.
const BUS_ROUTE_XLSX_BASE =
	"https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-1095&seqNo=&seq=";
const BUS_ROUTE_XLSX_TAIL = "&infSeq=2";

export function busRouteXlsxUrl(seq: number): string {
	return `${BUS_ROUTE_XLSX_BASE}${seq}${BUS_ROUTE_XLSX_TAIL}`;
}

export interface BusRouteListEntry {
	/** 노선의 가장 큰 순번. OA-1095는 (가상)/(미정차) 행을 일부 빼지만 순번은 그대로 두므로 행 수보다 클 수 있다. */
	maxSeq: number;
	routeId: string;
	routeName: string;
	/** 엑셀 행 수. */
	stopCount: number;
}

const HEADER_ROUTE_ID = "ROUTE_ID";
const HEADER_ROUTE_NAME = "노선명";
const HEADER_SEQ = "순번";

function cellToString(cell: unknown): string {
	if (cell === null || cell === undefined) {
		return "";
	}
	return String(cell).trim();
}

export function parseBusRouteRows(rows: unknown[][]): {
	routes: BusRouteListEntry[];
	errors: string[];
} {
	const header = (rows[0] ?? []).map(cellToString);
	const idCol = header.indexOf(HEADER_ROUTE_ID);
	const nameCol = header.indexOf(HEADER_ROUTE_NAME);
	const seqCol = header.indexOf(HEADER_SEQ);
	if ([idCol, nameCol, seqCol].includes(-1)) {
		return {
			errors: [
				`missing header column ${[
					HEADER_ROUTE_ID,
					HEADER_ROUTE_NAME,
					HEADER_SEQ,
				]
					.filter((name) => !header.includes(name))
					.join(",")} in: ${header.join(",")}`,
			],
			routes: [],
		};
	}

	const byId = new Map<string, BusRouteListEntry>();
	const errors: string[] = [];
	for (const [i, row] of rows.entries()) {
		if (i === 0) {
			continue;
		}
		const routeId = cellToString(row[idCol]);
		if (routeId === "") {
			continue;
		}
		// 빈 칸·소수가 NaN이나 엉뚱한 최대 순번이 되어 모든 노선에 경고가 붙지 않게 명시적으로 막는다.
		const seqText = cellToString(row[seqCol]);
		const seq = seqText === "" ? Number.NaN : Number(seqText);
		if (!Number.isInteger(seq) || seq < 1) {
			errors.push(`row ${i + 1}: invalid 순번 ${seqText}`);
			continue;
		}
		const existing = byId.get(routeId);
		if (existing) {
			existing.stopCount += 1;
			existing.maxSeq = Math.max(existing.maxSeq, seq);
			continue;
		}
		byId.set(routeId, {
			maxSeq: seq,
			routeId,
			routeName: cellToString(row[nameCol]),
			stopCount: 1,
		});
	}
	const routes = [...byId.values()].sort((a, b) =>
		a.routeId < b.routeId ? -1 : Number(a.routeId > b.routeId)
	);
	return { errors, routes };
}

/** 첫 시트의 모든 행을 읽는다. */
export async function readBusRouteXlsx(path: string): Promise<unknown[][]> {
	return await readSheet(path, 1);
}
