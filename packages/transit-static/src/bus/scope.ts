/**
 * 수집·적재에서 빼는 getStaionByRoute.routeType 값.
 * 2: 마을, 7: 인천, 8: 경기, 9: 폐지. 가이드에 없는 값(예: 15)은 포함하고 보고서에 센다.
 * Task 8에서 실데이터 분포를 보고 확정한다.
 */
export const OUT_OF_SCOPE_ROUTE_TYPES: readonly string[] = ["2", "7", "8", "9"];

export function isInScopeRouteType(routeType: string): boolean {
	return !OUT_OF_SCOPE_ROUTE_TYPES.includes(routeType.trim());
}
