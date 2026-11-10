/**
 * `@cloudflare/workers-types`의 가져오기용 판(index.ts)에는 `cloudflare:workers` 모듈 선언이 없다.
 * 이 Worker가 쓰는 `DurableObject`만 같은 모양으로 선언한다(RPC 스텁 타입이 브랜드를 본다).
 */
declare module "cloudflare:workers" {
	import type { DurableObjectState, Rpc } from "@cloudflare/workers-types";

	export abstract class DurableObject<Env = unknown>
		implements Rpc.DurableObjectBranded
	{
		[Rpc.__DURABLE_OBJECT_BRAND]: never;
		protected ctx: DurableObjectState;
		protected env: Env;
		constructor(ctx: DurableObjectState, env: Env);
	}
}
