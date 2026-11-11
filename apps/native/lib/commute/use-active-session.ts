import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { AppState } from "react-native";

import type { MessageKey } from "@/lib/i18n/translate";
import { serverClient } from "@/lib/server/app-server";

import {
	type ActiveSessionState,
	endOutcome,
	endSession,
	fetchActiveSession,
	settleActiveSession,
} from "./session-client";

const ACTIVE_SESSION_KEY = ["commute", "active-session"] as const;
const REFRESH_MS = 15_000;
const NO_SESSION: ActiveSessionState = { checking: false, session: null };

function subscribeAppState(onChange: () => void): () => void {
	const subscription = AppState.addEventListener("change", onChange);
	return () => subscription.remove();
}

function isAppActive(): boolean {
	return AppState.currentState === "active";
}

/**
 * 진행 중인 세션. 화면이 보이는 동안(포커스 + 앱이 앞) 15초마다 다시 받는다.
 * 받기에 실패하면 마지막 값을 두고 `checking`을 켠다. 15와 17이 같은 값을 나눠 쓴다.
 */
export function useActiveSession(options: { enabled?: boolean } = {}): {
	state: ActiveSessionState | undefined;
} {
	const { enabled = true } = options;
	const queryClient = useQueryClient();
	const focused = useIsFocused();
	const appActive = useSyncExternalStore(subscribeAppState, isAppActive);
	const visible = enabled && focused && appActive;
	const query = useQuery({
		enabled: visible,
		queryFn: async () =>
			settleActiveSession(
				queryClient.getQueryData<ActiveSessionState>(ACTIVE_SESSION_KEY),
				await fetchActiveSession(serverClient)
			),
		queryKey: ACTIVE_SESSION_KEY,
		refetchInterval: visible ? REFRESH_MS : false,
		staleTime: 0,
	});
	return { state: query.data };
}

const MS_PER_SECOND = 1000;
const CLOCK_TICK_MS = 15_000;

function epochSeconds(): number {
	return Math.floor(Date.now() / MS_PER_SECOND);
}

/** 지금 시각(epoch 초). 남은 분이 새 값을 기다리지 않고 줄도록 15초마다 다시 그린다. */
export function useEpochSeconds(): number {
	const [now, setNow] = useState(epochSeconds);
	useEffect(() => {
		const timer = setInterval(() => setNow(epochSeconds()), CLOCK_TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
}

/**
 * "안내 종료". 누르는 동안 다시 누를 수 없다. 화면을 미리 바꾸지 않고 서버 값을 다시 받는다.
 * 이미 끝난 세션이면 세션 없음으로 바꾸고, 보내지 못했으면 `notice`를 준다.
 */
export function useEndSession(): {
	end: (sessionId: string) => Promise<void>;
	ending: boolean;
	notice: MessageKey | null;
} {
	const queryClient = useQueryClient();
	const busy = useRef<boolean>(false);
	const [ending, setEnding] = useState(false);
	const [notice, setNotice] = useState<MessageKey | null>(null);
	const end = useCallback(
		async (sessionId: string) => {
			if (busy.current) {
				return;
			}
			busy.current = true;
			setEnding(true);
			setNotice(null);
			try {
				const outcome = endOutcome(await endSession(serverClient, sessionId));
				if (outcome.clear) {
					queryClient.setQueryData(ACTIVE_SESSION_KEY, NO_SESSION);
				} else if (outcome.notice === null) {
					await queryClient.refetchQueries({ queryKey: ACTIVE_SESSION_KEY });
				}
				setNotice(outcome.notice);
			} finally {
				busy.current = false;
				setEnding(false);
			}
		},
		[queryClient]
	);
	return { end, ending, notice };
}
