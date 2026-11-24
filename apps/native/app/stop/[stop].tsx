import {
	NaverMapMarkerOverlay,
	NaverMapView,
} from "@mj-studio/react-native-naver-map";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { StarIcon } from "lucide-react-native";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, withUniwind } from "uniwind";

import { ArrivalRow } from "@/components/transit/arrival-row";
import { LineBadge } from "@/components/transit/line-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { Section } from "@/components/ui/section";
import { TopBar } from "@/components/ui/top-bar";
import { fetchStopRoutes, type StopRoutes } from "@/lib/detail/detail-client";
import { type StopRouteRow, stopModel } from "@/lib/detail/stop-model";
import { appFavorites } from "@/lib/favorites/app-favorites";
import { favoriteId } from "@/lib/favorites/favorites";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import { createMapRefCache } from "@/lib/map/map-client";
import { MAP_REF_STALE_MS } from "@/lib/map/use-map-data";
import { refStaleTime } from "@/lib/ref/ref-client";
import { loadSearchIndex } from "@/lib/search/search-client";
import { stopSubtitleKey } from "@/lib/search/search-view-model";
import { serverClient } from "@/lib/server/app-server";
import type { EtaStatus } from "@/lib/transit/eta-status";

const Star = withUniwind(StarIcon);

const STAR_SIZE = 22;
const MAP_HEIGHT = 160;
const MARKER_SIZE = 20;
const MAP_ZOOM = 16;
const BOTTOM_PADDING = 16;

const stopRefCache = createMapRefCache(Storage);
const MAP_STYLE = { height: MAP_HEIGHT } as const;

const TAG_KEY: Record<EtaStatus["kind"], MessageKey> = {
	ended: "eta.ended",
	estimated: "commute.lock.tag.estimated",
	live: "commute.lock.tag.live",
};

function StopMap({ lat, lng }: { lat: number; lng: number }) {
	return (
		<View className="overflow-hidden rounded-lg">
			<NaverMapView
				initialCamera={{ latitude: lat, longitude: lng, zoom: MAP_ZOOM }}
				isExtentBoundedInKorea
				isRotateGesturesEnabled={false}
				isScrollGesturesEnabled={false}
				isShowCompass={false}
				isShowLocationButton={false}
				isShowScaleBar={false}
				isShowZoomControls={false}
				isTiltGesturesEnabled={false}
				isZoomGesturesEnabled={false}
				locale="ko"
				style={MAP_STYLE}
			>
				<NaverMapMarkerOverlay
					height={MARKER_SIZE}
					latitude={lat}
					longitude={lng}
					width={MARKER_SIZE}
				>
					<View className="size-5 rounded-full border-2 border-white bg-accent-primary" />
				</NaverMapMarkerOverlay>
			</NaverMapView>
		</View>
	);
}

function RouteRow({
	onOpen,
	row,
}: {
	onOpen: (href: string) => void;
	row: StopRouteRow;
}) {
	const open = () => onOpen(row.href);
	return (
		<ArrivalRow
			eta={row.status?.text ?? ""}
			leading={
				<LineBadge
					mode="bus"
					name={row.shortName}
					region="seoul"
					routeType={row.routeType}
				/>
			}
			onPress={open}
			status={
				row.status === null
					? { kind: "estimated", label: "" }
					: { kind: row.status.kind, label: t(TAG_KEY[row.status.kind]) }
			}
			title={row.directionLabel ?? row.shortName}
		/>
	);
}

function RoutesBody({
	failed,
	onOpen,
	onRetry,
	rows,
}: {
	failed: boolean;
	onOpen: (href: string) => void;
	onRetry: () => void;
	rows: StopRouteRow[] | null;
}) {
	if (failed) {
		return (
			<EmptyState
				action={
					<AppButton
						label={t("stopDetail.retry")}
						onPress={onRetry}
						size="medium"
						variant="secondary"
					/>
				}
				body={t("stopDetail.unavailable.body")}
				title={t("stopDetail.unavailable.title")}
			/>
		);
	}
	if (rows === null) {
		return (
			<AppText className="px-4 py-3 text-text-secondary" variant="bodyS">
				{t("stopDetail.loading")}
			</AppText>
		);
	}
	if (rows.length === 0) {
		return (
			<AppText className="px-4 py-3 text-text-secondary" variant="bodyS">
				{t("stopDetail.noRoutes")}
			</AppText>
		);
	}
	return rows.map((row) => (
		<RouteRow key={row.line} onOpen={onOpen} row={row} />
	));
}

function subtitleOf(
	arsId: string | null,
	towards: string | null
): string | null {
	const key = stopSubtitleKey({
		arsId,
		lat: 0,
		lng: 0,
		name: "",
		stop: "",
		towards,
	});
	return key === null
		? null
		: t(key, { arsId: arsId ?? "", towards: towards ?? "" });
}

function StopBody({
	data,
	failed,
	onOpen,
	onRetry,
	towards,
}: {
	data: StopRoutes | null;
	failed: boolean;
	onOpen: (href: string) => void;
	onRetry: () => void;
	towards: string | null;
}) {
	// 배차간격은 정적 자료라 응답을 받을 때의 시각 하나로 계산한다.
	const rows = useMemo(
		() => (data === null ? null : stopModel(data, Date.now())),
		[data]
	);
	const subtitle = data === null ? null : subtitleOf(data.arsId, towards);
	return (
		<View className="gap-4 px-4">
			{data === null ? null : (
				<View className="gap-1">
					<AppText variant="title2">{data.name}</AppText>
					{subtitle === null ? null : (
						<AppText className="text-text-secondary" variant="bodyS">
							{subtitle}
						</AppText>
					)}
				</View>
			)}
			{data === null ? null : <StopMap lat={data.lat} lng={data.lng} />}
			<Section title={t("stopDetail.routes")}>
				{failed ? null : (
					<View className="p-3">
						<InlineNotice body={t("stopDetail.notice")} />
					</View>
				)}
				<RoutesBody
					failed={failed}
					onOpen={onOpen}
					onRetry={onRetry}
					rows={rows}
				/>
			</Section>
		</View>
	);
}

/** 08 정류장 상세. 배차간격만 보이고, 실시간은 노선 상세(07)에서 본다. */
export default function StopDetailScreen() {
	const { stop } = useLocalSearchParams<{ stop: string }>();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const favorites = useSyncExternalStore(
		appFavorites.subscribe,
		appFavorites.get
	);

	const routesQuery = useQuery({
		queryFn: () => fetchStopRoutes(serverClient, stop),
		queryKey: ["stop-routes", stop],
		staleTime: refStaleTime,
	});
	// 방면은 검색 색인에만 있다. 색인이 없어도 화면은 뜬다.
	const indexQuery = useQuery({
		queryFn: () => loadSearchIndex(serverClient, stopRefCache),
		queryKey: ["search-index"],
		staleTime: MAP_REF_STALE_MS,
	});
	const towards =
		indexQuery.data?.stops.find((entry) => entry.stop === stop)?.towards ??
		null;
	const result = routesQuery.data;
	const data = result?.ok ? result.value : null;
	// lucide는 color를 stroke에만 써서 fill=currentColor가 검정이 된다. 토큰 색을 직접 넘긴다.
	const starColor = useCSSVariable("--color-icon-primary");

	const goBack = useCallback(() => router.back(), [router]);
	const retry = useCallback(() => {
		routesQuery.refetch();
	}, [routesQuery]);
	const openRoute = useCallback(
		(href: string) => router.push(href as never),
		[router]
	);
	const favoriteKey = favoriteId({ kind: "stop", stop });
	const isFavorite = favorites.some((entry) => entry.id === favoriteKey);
	const toggleFavorite = useCallback(() => {
		if (data === null) {
			return;
		}
		appFavorites.toggle({
			addedAt: Date.now(),
			arsId: data.arsId,
			id: favoriteKey,
			kind: "stop",
			name: data.name,
			stop: data.stop,
			towards,
		});
	}, [data, favoriteKey, towards]);

	const star = (
		<IconButton
			accessibilityLabel={t(
				isFavorite ? "stopDetail.favoriteRemove" : "stopDetail.favorite"
			)}
			onPress={toggleFavorite}
		>
			<Star
				colorClassName="accent-icon-primary"
				fill={isFavorite && typeof starColor === "string" ? starColor : "none"}
				size={STAR_SIZE}
			/>
		</IconButton>
	);

	// 받은 적이 없고 실패했을 때만 실패 칸을 보인다. 서버가 모르는 정류장(경기·인천 포함)도 여기로 온다.
	const notFound = result !== undefined && !result.ok;
	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={data?.name ?? ""} trailing={star} />
			<OfflineNotice className="px-4 pb-2" />
			<ScrollView
				contentContainerStyle={{ paddingBottom: BOTTOM_PADDING }}
				showsVerticalScrollIndicator={false}
			>
				<StopBody
					data={data}
					failed={notFound}
					onOpen={openRoute}
					onRetry={retry}
					towards={towards}
				/>
			</ScrollView>
		</View>
	);
}
