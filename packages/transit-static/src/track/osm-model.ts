import { z } from "zod";

const tagsSchema = z.record(z.string(), z.string()).optional();

const nodeSchema = z.object({
	id: z.number(),
	lat: z.number(),
	lon: z.number(),
	tags: tagsSchema,
	type: z.literal("node"),
});
const waySchema = z.object({
	id: z.number(),
	nodes: z.array(z.number()),
	tags: tagsSchema,
	type: z.literal("way"),
});
const relationSchema = z.object({
	id: z.number(),
	members: z.array(
		z.object({
			ref: z.number(),
			role: z.string(),
			type: z.enum(["node", "way", "relation"]),
		})
	),
	tags: tagsSchema,
	type: z.literal("relation"),
});

const payloadSchema = z.object({
	elements: z.array(
		z.discriminatedUnion("type", [nodeSchema, waySchema, relationSchema])
	),
});

export type OsmNode = z.infer<typeof nodeSchema>;
export type OsmWay = z.infer<typeof waySchema>;
export type OsmRelation = z.infer<typeof relationSchema>;

export interface OsmIndex {
	nodes: Map<number, OsmNode>;
	relations: Map<number, OsmRelation>;
	ways: Map<number, OsmWay>;
}

export function indexOsm(json: unknown): OsmIndex {
	const { elements } = payloadSchema.parse(json);
	const idx: OsmIndex = {
		nodes: new Map(),
		relations: new Map(),
		ways: new Map(),
	};
	for (const el of elements) {
		if (el.type === "node") {
			idx.nodes.set(el.id, el);
		} else if (el.type === "way") {
			idx.ways.set(el.id, el);
		} else {
			idx.relations.set(el.id, el);
		}
	}
	return idx;
}

const STOP_ROLES = new Set(["stop", "stop_entry_only", "stop_exit_only"]);
const WAY_ROLES = new Set(["", "forward", "backward"]);

export function stopNodesOf(rel: OsmRelation, idx: OsmIndex): OsmNode[] {
	const result: OsmNode[] = [];
	for (const m of rel.members) {
		if (m.type !== "node" || !STOP_ROLES.has(m.role)) {
			continue;
		}
		const node = idx.nodes.get(m.ref);
		if (node) {
			result.push(node);
		}
	}
	return result;
}

export function wayMembersOf(rel: OsmRelation, idx: OsmIndex): OsmWay[] {
	const result: OsmWay[] = [];
	for (const m of rel.members) {
		if (m.type !== "way" || !WAY_ROLES.has(m.role)) {
			continue;
		}
		const way = idx.ways.get(m.ref);
		if (way) {
			result.push(way);
		}
	}
	return result;
}
