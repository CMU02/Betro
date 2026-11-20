import { Accuracy, getCurrentPositionAsync } from "expo-location";
import { useEffect, useState } from "react";

import { getPermissionsState } from "@/lib/permissions/permissions";

import { type Coordinate, locateOnce } from "./nearby";

async function readDevicePosition(): Promise<Coordinate> {
	const { coords } = await getCurrentPositionAsync({
		accuracy: Accuracy.Balanced,
	});
	return { latitude: coords.latitude, longitude: coords.longitude };
}

/**
 * 기기의 현재 위치를 한 번 읽는다. 위치 권한이 `granted`일 때만 읽고, 아니면 `null`이다.
 * 결과는 이 화면의 상태에만 둔다. 저장하거나 서버로 보내지 않는다(지도 설계 2.5).
 * `enabled`가 false면(장소가 있어 근처 지하철을 보이지 않을 때) 권한도 위치도 읽지 않는다.
 */
export function useHere(enabled = true): Coordinate | null {
	const [here, setHere] = useState<Coordinate | null>(null);

	useEffect(() => {
		if (!enabled) {
			setHere(null);
			return;
		}
		let active = true;
		async function load(): Promise<void> {
			try {
				const { location } = await getPermissionsState();
				const position = await locateOnce(location, readDevicePosition);
				if (active) {
					setHere(position);
				}
			} catch {
				// 위치 서비스가 꺼져 있으면 근처 노선 없이 지도를 그린다.
				if (active) {
					setHere(null);
				}
			}
		}
		// load가 실패를 직접 처리하므로 여기로 오는 거부는 없다.
		load().catch(() => undefined);
		return () => {
			active = false;
		};
	}, [enabled]);

	return here;
}
