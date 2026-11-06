import type { AppRouterClient } from "@Betro/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import { ENV } from "../src/env";

export const queryClient = new QueryClient({
	queryCache: new QueryCache({
		onError: (error) => {
			reportError(appCrashSink, error, "query");
		},
	}),
});

async function expoFetch(request: Request, init?: RequestInit) {
	const { fetch } = await import("expo/fetch");

	return fetch(request.url, {
		body: await request.blob(),
		headers: request.headers,
		method: request.method,
		signal: request.signal,
		...init,
	});
}

export const link = new RPCLink({
	fetch(request, init) {
		return expoFetch(request, init);
	},
	url: `${ENV.EXPO_PUBLIC_SERVER_URL}/rpc`,
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
