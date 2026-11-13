import { type CrashSink, reportError } from "../crash/crash-reporting";
import type { MessageKey } from "../i18n/translate";
import type { SaveResult } from "./plan-sync";
import { saveOutcome } from "./setup-form-model";

export interface SaveFlowDeps {
	/** 장소 설정 화면을 닫는다(`router.back()`). */
	close: () => void;
	/** 저장을 시작한 화면이 아직 떠 있고 맨 위에 있으면 true. */
	isOpen: () => boolean;
	/** 저장·삭제가 함께 쓰는 잠금. 잡혀 있으면 PUT을 다시 보내지 않는다. */
	lock: { current: boolean };
	save: () => Promise<SaveResult>;
	setSaving: (saving: boolean) => void;
	showError: (message: MessageKey | null) => void;
	sink: CrashSink;
}

const SAVE_CONTEXT = "place-save";

/**
 * 장소 하나를 저장한다. 저장은 서버 응답을 최대 10초 기다리므로, 끝났을 때 화면이 이미 떠났거나
 * 다른 화면이 위에 올라와 있으면 닫지도 문구를 보이지도 않는다(그 화면을 대신 닫게 된다).
 * 닫을 때는 잠금을 풀지 않는다. 닫히는 동안 다시 고치거나 저장하지 못하게 한다.
 */
export async function runSave(deps: SaveFlowDeps): Promise<void> {
	if (deps.lock.current) {
		return;
	}
	deps.lock.current = true;
	deps.setSaving(true);
	deps.showError(null);
	let message: MessageKey;
	try {
		const outcome = saveOutcome(await deps.save());
		if (outcome.kind === "close") {
			if (deps.isOpen()) {
				deps.close();
				return;
			}
			deps.lock.current = false;
			deps.setSaving(false);
			return;
		}
		({ message } = outcome);
	} catch (error) {
		reportError(deps.sink, error, SAVE_CONTEXT);
		message = "placeSetup.save.rejected";
	}
	deps.lock.current = false;
	deps.setSaving(false);
	if (deps.isOpen()) {
		deps.showError(message);
	}
}
