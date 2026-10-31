import { saveRaw } from "../raw-store";
import { writeReport } from "../reports";
import {
	discoverQuery,
	fetchOverpass,
	SEOUL_METRO_BBOX,
} from "../sources/overpass";
import { indexOsm, type OsmRelation } from "../track/osm-model";

const OSM_SOURCE = "osm";
const RETRY_DELAY_MS = 60_000;
const HTTP_TOO_MANY_REQUESTS = "429";
const PIPE = /\|/g;
const ESCAPED_PIPE = String.raw`\|`;
const STOP_ROLES = new Set(["stop", "stop_entry_only", "stop_exit_only"]);
const WAY_ROLES = new Set(["", "forward", "backward"]);

export interface OsmDiscoverOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
}

const cell = (value: string | undefined): string =>
	(value ?? "").replace(PIPE, ESCAPED_PIPE);

// discover 응답에는 멤버 element가 없으므로 인덱스 대신 relation의 멤버 목록으로 센다.
const countMembers = (
	rel: OsmRelation,
	type: "node" | "way",
	roles: Set<string>
): number =>
	rel.members.filter((m) => m.type === type && roles.has(m.role)).length;

async function fetchWithRetry(
	query: string,
	fetchImpl: typeof fetch
): Promise<unknown> {
	try {
		return await fetchOverpass(query, fetchImpl);
	} catch (error) {
		// Overpass는 부하가 높으면 429를 준다. 60초 뒤 한 번만 재시도한다.
		if (
			!(
				error instanceof Error && error.message.includes(HTTP_TOO_MANY_REQUESTS)
			)
		) {
			throw error;
		}
		console.error("Overpass 429, 60초 뒤 한 번 재시도합니다.");
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		return await fetchOverpass(query, fetchImpl);
	}
}

export async function osmDiscover({
	dataDir,
	fetchImpl = fetch,
}: OsmDiscoverOptions) {
	const json = await fetchWithRetry(discoverQuery(SEOUL_METRO_BBOX), fetchImpl);
	await saveRaw(
		dataDir,
		OSM_SOURCE,
		"discover.json",
		new TextEncoder().encode(JSON.stringify(json))
	);
	const idx = indexOsm(json);

	const masterNameByRoute = new Map<number, string>();
	for (const rel of idx.relations.values()) {
		if (rel.tags?.type !== "route_master") {
			continue;
		}
		for (const m of rel.members) {
			if (m.type === "relation") {
				masterNameByRoute.set(m.ref, rel.tags?.name ?? "");
			}
		}
	}

	const routes: OsmRelation[] = [...idx.relations.values()].filter(
		(rel) => rel.tags?.type === "route"
	);
	routes.sort((a, b) =>
		(a.tags?.name ?? "").localeCompare(b.tags?.name ?? "", "ko")
	);

	const rows = routes.map((rel) => {
		const t = rel.tags ?? {};
		return `| ${rel.id} | ${cell(t.route)} | ${cell(t.ref)} | ${cell(t.name)} | ${cell(t.from)} | ${cell(t.to)} | ${cell(t.network)} | ${cell(t.operator)} | ${countMembers(rel, "way", WAY_ROLES)} | ${countMembers(rel, "node", STOP_ROLES)} | ${cell(masterNameByRoute.get(rel.id))} |`;
	});
	const markdown = [
		"# OSM route relation 탐색",
		"",
		`route relation ${routes.length}개, route_master ${masterNameByRoute.size > 0 ? new Set(masterNameByRoute.values()).size : 0}개 이름`,
		"",
		"| relation id | route | ref | name | from | to | network | operator | way 멤버 | stop 멤버 | route_master |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...rows,
		"",
	].join("\n");
	const report = await writeReport(dataDir, "osm-discover", {
		markdown,
		summary: { routeCount: routes.length },
	});
	console.log(`relations: ${routes.length}\nreport: ${report.mdPath}`);
	return { mdPath: report.mdPath, routeCount: routes.length };
}
