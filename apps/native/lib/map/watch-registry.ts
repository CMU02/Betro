/**
 * 버스 관측 요청(`POST /v1/map/watch`)을 한 곳에서 보낸다.
 * 서버는 설치의 감시 목록을 통째로 바꾸므로, 지도와 07이 따로 보내면 서로 지운다.
 * 그래서 화면마다 요청을 claim하고, registry가 합집합을 모아 보낸다.
 * 이 파일은 react-native에 기대지 않는다(Bun 테스트에서 그대로 쓴다).
 */

/** 설치 하나가 한 번에 볼 수 있는 노선 수. 서버 설치별 상한(`MAP_WATCH_MAX_PER_INSTALL`)과 맞춘다. */
export const WATCH_MAX = 6;
/** 관측 요청 하트비트 간격. 서버 TTL(90초)보다 짧게 둔다. */
export const WATCH_HEARTBEAT_MS = 60_000;

export interface WatchRegistry {
	/** heartbeat에서 부른다. 합집합이 비어 있으면 보내지 않는다. */
	beat: () => Promise<void>;
	/** 화면 하나의 요청을 바꾼다. 합집합이 바뀌면 바로 보낸다. 나중에 claim한 화면이 앞이다. */
	claim: (owner: string, refs: readonly string[]) => void;
	release: (owner: string) => void;
}

/** 합집합 비교 키. 서버는 순서를 보지 않으므로 정렬해 같은 묶음이면 같은 키다. */
function keyOf(refs: readonly string[]): string {
	return refs.slice().sort().join(",");
}

const EMPTY_KEY = keyOf([]);

export function createWatchRegistry(
	send: (refs: string[]) => Promise<void>
): WatchRegistry {
	// Map은 넣은 순서를 지킨다. 맨 뒤가 가장 최근 claim이다.
	const claims = new Map<string, readonly string[]>();
	// 서버에 마지막으로 보낸 합집합. 처음에는 아무것도 보지 않는다. 보내기에 실패하면 null이다.
	let lastSentKey: string | null = EMPTY_KEY;
	// 보내는 중인가. 멈춤을 정하는 그 자리에서 함께 내린다. 그래야 멈춘 직후의 claim이 새 보내기를 연다.
	let busy = false;
	// beat가 기다릴 진행 중인 보내기.
	let running: Promise<void> = Promise.resolve();

	/** 가장 최근 claim의 refs부터 담고, 중복을 빼고 `WATCH_MAX`에서 자른다. */
	const union = (): string[] => {
		const owners = [...claims.values()].reverse();
		const refs: string[] = [];
		for (const ownerRefs of owners) {
			for (const ref of ownerRefs) {
				if (refs.length >= WATCH_MAX) {
					return refs;
				}
				if (!refs.includes(ref)) {
					refs.push(ref);
				}
			}
		}
		return refs;
	};

	/**
	 * 보내기는 한 번에 하나다. 끝날 때마다 합집합을 다시 보고, 마지막으로 보낸 것과 다르면 마지막 합집합만 보낸다.
	 * `force`면 같아도 한 번은 보낸다(heartbeat). 실패는 삼키고 다음 beat에 다시 보낸다.
	 */
	const drain = async (force: boolean): Promise<void> => {
		const refs = union();
		const key = keyOf(refs);
		if (!force && key === lastSentKey) {
			busy = false;
			return;
		}
		try {
			await send(refs);
			lastSentKey = key;
		} catch {
			lastSentKey = null;
			// 보내는 사이 합집합이 바뀌지 않았으면 여기서 멈춘다. 같은 실패를 되풀이하지 않는다.
			if (keyOf(union()) === key) {
				busy = false;
				return;
			}
		}
		// 보내는 사이 바뀐 합집합이 있으면 마지막 것만 보낸다.
		await drain(false);
	};

	const flush = (force: boolean): Promise<void> => {
		// 보내는 중이면 그 보내기에 합친다. 끝난 뒤 drain이 바뀐 합집합을 본다.
		if (busy) {
			return running;
		}
		busy = true;
		running = drain(force);
		return running;
	};

	return {
		beat() {
			if (union().length === 0) {
				return busy ? running : Promise.resolve();
			}
			return flush(true);
		},
		claim(owner, refs) {
			// 다시 claim한 화면을 맨 뒤(가장 최근)로 옮긴다. 넘겨 준 배열이 나중에 바뀌어도 영향이 없게 복사한다.
			claims.delete(owner);
			claims.set(owner, refs.slice());
			flush(false).catch(() => undefined);
		},
		release(owner) {
			if (!claims.delete(owner)) {
				return;
			}
			// 합집합이 비면 `[]`를 한 번 보내 서버 감시(TTL 90초)를 바로 푼다.
			flush(false).catch(() => undefined);
		},
	};
}
