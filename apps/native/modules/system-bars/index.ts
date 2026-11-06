import { requireOptionalNativeModule } from "expo";

interface SystemBarsNativeModule {
	setContentStyle: (lightContent: boolean) => Promise<void>;
}

/** Android 전용 모듈. iOS에서는 없으므로 null이다. */
const SystemBarsModule =
	requireOptionalNativeModule<SystemBarsNativeModule>("SystemBars");

/**
 * Android 상태 표시줄 아이콘과 내비게이션 바 버튼 색을 함께 바꾼다. `lightContent`면 밝은 아이콘·버튼.
 * Android가 아니면 아무것도 하지 않는다.
 */
export async function setAndroidSystemBarsContent(
	lightContent: boolean
): Promise<void> {
	await SystemBarsModule?.setContentStyle(lightContent);
}
