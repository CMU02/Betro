import { z } from "zod";
import {
	fetchRefMap,
	loadCachedRef,
	type MapRefCache,
} from "@/lib/map/map-client";
import type { ServerClient } from "@/lib/server/api-client";

const searchStationSchema = z.object({
	key: z.string(),
	lat: z.number(),
	lng: z.number(),
	members: z.array(z.object({ line: z.string(), stop: z.string() })),
	name: z.string(),
});

const searchRouteSchema = z.object({
	line: z.string(),
	name: z.string(),
	routeType: z.string(),
	shortName: z.string(),
});

const searchStopSchema = z.object({
	arsId: z.string().nullable(),
	lat: z.number(),
	lng: z.number(),
	name: z.string(),
	stop: z.string(),
	towards: z.string().nullable(),
});

const searchIndexSchema = z.object({
	routes: z.array(searchRouteSchema),
	stations: z.array(searchStationSchema),
	stops: z.array(searchStopSchema),
});

export type SearchStation = z.infer<typeof searchStationSchema>;
export type SearchRoute = z.infer<typeof searchRouteSchema>;
export type SearchStop = z.infer<typeof searchStopSchema>;
export type SearchIndex = z.infer<typeof searchIndexSchema>;

export const SEARCH_INDEX_CACHE_KEY = "search-index";

/**
 * 검색 색인을 기기 저장본 먼저 읽고 ETag가 바뀔 때만 다시 받는다. 받지 못하면 저장본을 쓰고,
 * 저장본도 없으면 던진다(호출한 쪽이 "검색 자료를 불러오지 못했어요"와 다시 시도를 보여 준다).
 */
export function loadSearchIndex(
	client: ServerClient,
	cache: MapRefCache
): Promise<SearchIndex> {
	return loadCachedRef(cache, SEARCH_INDEX_CACHE_KEY, (etag) =>
		fetchRefMap(client, "/v1/ref/search-index", etag, searchIndexSchema)
	);
}
