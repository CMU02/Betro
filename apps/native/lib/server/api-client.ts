import type { InstallIdentity } from "@/lib/device/install-identity";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ServerResponse {
	json: unknown;
	status: number;
}

export interface ServerClient {
	request: (
		method: HttpMethod,
		path: string,
		body?: unknown
	) => Promise<ServerResponse>;
}

export interface ServerClientDeps {
	baseUrl: string;
	fetch: typeof fetch;
	identity: () => Promise<InstallIdentity>;
	/** 응답이 오면 true, 네트워크 오류·타임아웃이면 false. 인증값을 못 읽은 것은 알리지 않는다. */
	onReachability?: (reachable: boolean) => void;
}

const REQUEST_TIMEOUT_MS = 10_000;
const NETWORK_ERROR: ServerResponse = { json: null, status: 0 };
const TRAILING_SLASHES = /\/+$/;
const LEADING_SLASHES = /^\/+/;

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(TRAILING_SLASHES, "")}/${path.replace(LEADING_SLASHES, "")}`;
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

/**
 * 설치 인증 헤더를 붙여 서버에 요청한다. 네트워크 오류, 타임아웃, 인증값 읽기 실패는
 * 던지지 않고 `status: 0`으로 돌려준다(잠금화면 경로가 예외로 멈추지 않게).
 */
export function createServerClient(deps: ServerClientDeps): ServerClient {
	return {
		async request(method, path, body) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
			let sent = false;
			try {
				const identity = await deps.identity();
				const headers: Record<string, string> = {
					Authorization: `Bearer ${identity.secret}`,
					"X-Betro-Install": identity.installId,
				};
				if (body !== undefined) {
					headers["Content-Type"] = "application/json";
				}
				sent = true;
				const response = await deps.fetch(joinUrl(deps.baseUrl, path), {
					body: body === undefined ? undefined : JSON.stringify(body),
					headers,
					method,
					signal: controller.signal,
				});
				deps.onReachability?.(true);
				return { json: await readJson(response), status: response.status };
			} catch {
				if (sent) {
					deps.onReachability?.(false);
				}
				return NETWORK_ERROR;
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
