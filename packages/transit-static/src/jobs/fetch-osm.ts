import { z } from "zod";
import osmRoutesJson from "../manual/osm-routes.json";
import { saveRaw } from "../raw-store";
import { fetchOverpass, routeQuery } from "../sources/overpass";

export const osmRoutesSchema = z.array(
	z.object({
		branchKey: z.string(),
		direction: z.enum(["up", "down"]),
		lineKey: z.string(),
		note: z.string().optional(),
		osmRelationId: z.number().int().positive(),
	})
);

export interface FetchOsmOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
}

export async function fetchOsm({
	dataDir,
	fetchImpl = fetch,
}: FetchOsmOptions) {
	const routes = osmRoutesSchema.parse(osmRoutesJson);
	if (routes.length === 0) {
		console.error(
			"osm-routes.json이 비어 있습니다. 먼저 `bun transit osm:discover`로 relation을 찾고 src/manual/osm-routes.json을 채우세요."
		);
		process.exit(1);
	}
	const ids = [...new Set(routes.map((r) => r.osmRelationId))];
	const json = await fetchOverpass(routeQuery(ids), fetchImpl);
	const result = await saveRaw(
		dataDir,
		"osm",
		"routes.json",
		new TextEncoder().encode(JSON.stringify(json))
	);
	console.log(
		`path: ${result.path}\nsha256: ${result.sha256}\nunchanged: ${result.unchanged}`
	);
	return result;
}
