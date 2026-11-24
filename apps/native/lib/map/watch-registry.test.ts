import { describe, expect, it } from "bun:test";

import { createWatchRegistry, WATCH_MAX } from "./watch-registry";

const MAP_SEOUL = "seoul-bus:100100118";
const MAP_GBIS = "gbis:200000037";
const DETAIL = "seoul-bus:100100029";

/** 보내기가 한 번에 하나라 뒤따르는 보내기는 앞 보내기가 끝난 뒤에 나간다. 그때까지 기다린다. */
const settle = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, 0);
	});

/** 보낸 목록을 모으는 기록기. */
function recorder() {
	const sent: string[][] = [];
	const send = (refs: string[]): Promise<void> => {
		sent.push(refs);
		return Promise.resolve();
	};
	return { send, sent };
}

/** 손으로 끝내는 보내기. 보내는 중 상태를 만든다. */
function deferredSender() {
	const sent: string[][] = [];
	const resolvers: (() => void)[] = [];
	const send = (refs: string[]): Promise<void> => {
		sent.push(refs);
		return new Promise((resolve) => {
			resolvers.push(resolve);
		});
	};
	const finishNext = async (): Promise<void> => {
		resolvers.shift()?.();
		await settle();
	};
	return { finishNext, send, sent };
}

describe("createWatchRegistry", () => {
	it("상세가 claim해도 지도 요청을 지우지 않고 합집합을 보낸다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		registry.claim("map", [MAP_SEOUL, MAP_GBIS]);
		registry.claim("bus-detail", [DETAIL]);
		await settle();
		expect(sent.at(-1)).toEqual([DETAIL, MAP_SEOUL, MAP_GBIS]);
	});

	it("지도가 다시 claim하면 heartbeat를 기다리지 않고 바로 보낸다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		registry.claim("map", [MAP_SEOUL, MAP_GBIS]);
		await settle();
		// 07을 열면 지도가 가려지고 07이 claim한다.
		registry.release("map");
		registry.claim("bus-detail", [DETAIL]);
		await settle();
		// 07을 닫고 지도로 돌아온다.
		registry.release("bus-detail");
		registry.claim("map", [MAP_SEOUL, MAP_GBIS]);
		await settle();
		expect(sent.at(-1)).toEqual([MAP_SEOUL, MAP_GBIS]);
	});

	it("지도가 release하고 상세만 claim한 동안에도 beat는 상세 노선을 계속 보낸다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		registry.claim("map", [MAP_SEOUL]);
		registry.claim("bus-detail", [DETAIL]);
		registry.release("map");
		await settle();
		const before = sent.length;
		await registry.beat();
		await registry.beat();
		expect(sent.slice(before)).toEqual([[DETAIL], [DETAIL]]);
	});

	it("6개를 넘으면 최근 claim 쪽을 남긴다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		const mapRefs = ["a", "b", "c", "d", "e"].map((id) => `seoul-bus:${id}`);
		registry.claim("map", mapRefs);
		registry.claim("bus-detail", ["seoul-bus:x", "seoul-bus:a"]);
		await settle();
		const last = sent.at(-1) ?? [];
		expect(last).toHaveLength(WATCH_MAX);
		expect(last).toEqual([
			"seoul-bus:x",
			"seoul-bus:a",
			"seoul-bus:b",
			"seoul-bus:c",
			"seoul-bus:d",
			"seoul-bus:e",
		]);
		registry.claim("other", ["seoul-bus:y"]);
		await settle();
		expect(sent.at(-1)).toEqual([
			"seoul-bus:y",
			"seoul-bus:x",
			"seoul-bus:a",
			"seoul-bus:b",
			"seoul-bus:c",
			"seoul-bus:d",
		]);
	});

	it("같은 합집합이면 claim이 다시 보내지 않는다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		registry.claim("map", [MAP_SEOUL, MAP_GBIS]);
		await settle();
		registry.claim("map", [MAP_SEOUL, MAP_GBIS]);
		registry.claim("map", [MAP_GBIS, MAP_SEOUL]);
		await settle();
		expect(sent).toEqual([[MAP_SEOUL, MAP_GBIS]]);
	});

	it("마지막 화면이 release하면 빈 목록을 한 번 보내고 beat는 보내지 않는다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		// 아무도 claim하지 않았으면 release도 beat도 보내지 않는다.
		registry.release("map");
		await registry.beat();
		expect(sent).toEqual([]);
		registry.claim("map", [MAP_SEOUL]);
		registry.claim("bus-detail", [DETAIL]);
		registry.release("bus-detail");
		registry.release("map");
		await settle();
		expect(sent.at(-1)).toEqual([]);
		const count = sent.length;
		registry.release("map");
		await registry.beat();
		expect(sent).toHaveLength(count);
	});

	it("보내는 중에 release 뒤 claim이 오면 마지막 합집합만 보낸다", async () => {
		const { finishNext, send, sent } = deferredSender();
		const registry = createWatchRegistry(send);
		registry.claim("map", [MAP_SEOUL]);
		expect(sent).toEqual([[MAP_SEOUL]]);
		registry.release("map");
		registry.claim("bus-detail", [DETAIL]);
		// 보내는 동안 beat는 따로 보내지 않고 진행 중인 보내기를 기다린다.
		const beating = registry.beat();
		expect(sent).toEqual([[MAP_SEOUL]]);
		await finishNext();
		expect(sent).toEqual([[MAP_SEOUL], [DETAIL]]);
		await finishNext();
		await beating;
		expect(sent).toEqual([[MAP_SEOUL], [DETAIL]]);
	});

	it("보내기에 실패해도 던지지 않고 다음 beat에 다시 보낸다", async () => {
		const sent: string[][] = [];
		// 첫 보내기만 실패한다.
		const registry = createWatchRegistry((refs) => {
			sent.push(refs);
			return sent.length === 1
				? Promise.reject(new Error("offline"))
				: Promise.resolve();
		});
		registry.claim("map", [MAP_SEOUL]);
		await settle();
		await registry.beat();
		expect(sent).toEqual([[MAP_SEOUL], [MAP_SEOUL]]);
	});

	it("보내기가 끝난 직후의 claim도 놓치지 않는다", async () => {
		for (let ticks = 0; ticks <= 4; ticks += 1) {
			const { send, sent } = recorder();
			const registry = createWatchRegistry(send);
			registry.claim("map", [MAP_SEOUL]);
			for (let tick = 0; tick < ticks; tick += 1) {
				// biome-ignore lint/performance/noAwaitInLoops: 마이크로태스크를 하나씩 넘겨 보내기가 끝나는 틈을 찾는다.
				await Promise.resolve();
			}
			registry.claim("bus-detail", [DETAIL]);
			await settle();
			expect(sent.at(-1)).toEqual([DETAIL, MAP_SEOUL]);
		}
	});

	it("넘겨 준 배열을 나중에 바꿔도 합집합이 바뀌지 않는다", async () => {
		const { send, sent } = recorder();
		const registry = createWatchRegistry(send);
		const refs = [MAP_SEOUL];
		registry.claim("map", refs);
		await settle();
		refs.push(DETAIL);
		await registry.beat();
		expect(sent).toEqual([[MAP_SEOUL], [MAP_SEOUL]]);
	});
});
