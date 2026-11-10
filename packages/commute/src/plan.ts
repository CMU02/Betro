import { z } from "zod";
import type { LineRef, StopRef } from "./refs";
import { SOURCE_IDS } from "./refs";

export interface BusLeg {
	alight: { name: string; seq: number; stop: StopRef };
	board: { name: string; seq: number; stop: StopRef };
	line: LineRef;
	lineName: string;
	mode: "bus";
}

export interface SubwayLeg {
	alight: { name: string; stop: StopRef };
	board: { name: string; stop: StopRef };
	direction: "up" | "down";
	line: LineRef;
	lineName: string;
	mode: "subway";
}

export type Leg = BusLeg | SubwayLeg;

export interface Route {
	legs: Leg[];
	rank: number;
	walkMinutes: number[];
}

export interface Schedule {
	days: number[];
	includeHolidays: boolean;
	leadMinutes: number;
	leaveMinute: number;
	timezone: string;
}

export interface CommutePlan {
	enabled: boolean;
	planId: string;
	routes: Route[];
	schedule: Schedule;
}

const MAX_ROUTES = 4;
const MAX_LEGS = 4;
const MAX_WALK_MINUTES = 60;
const MINUTES_PER_DAY = 1440;
const MIN_LEAD_MINUTES = 5;
const MAX_LEAD_MINUTES = 30;

const REF_PATTERN = new RegExp(`^(${SOURCE_IDS.join("|")}):.+$`);

const refSchema = z.string().regex(REF_PATTERN) as unknown as z.ZodType<
	LineRef & StopRef
>;

function sourceOf(ref: string): string {
	return ref.slice(0, ref.indexOf(":"));
}

const busStopSchema = z
	.object({
		name: z.string().min(1),
		seq: z.number().int().min(0),
		stop: refSchema,
	})
	.strict();

const plainStopSchema = z
	.object({ name: z.string().min(1), stop: refSchema })
	.strict();

const busLegSchema = z
	.object({
		alight: busStopSchema,
		board: busStopSchema,
		line: refSchema,
		lineName: z.string().min(1),
		mode: z.literal("bus"),
	})
	.strict()
	.superRefine((leg, ctx) => {
		if (leg.alight.seq <= leg.board.seq) {
			ctx.addIssue({
				code: "custom",
				message: "alight.seq must be greater than board.seq",
				path: ["alight", "seq"],
			});
		}
	});

const subwayLegSchema = z
	.object({
		alight: plainStopSchema,
		board: plainStopSchema,
		direction: z.enum(["up", "down"]),
		line: refSchema,
		lineName: z.string().min(1),
		mode: z.literal("subway"),
	})
	.strict()
	.superRefine((leg, ctx) => {
		if (leg.board.stop === leg.alight.stop) {
			ctx.addIssue({
				code: "custom",
				message: "board and alight stations must differ",
				path: ["alight", "stop"],
			});
		}
	});

const legSchema = z
	.discriminatedUnion("mode", [busLegSchema, subwayLegSchema])
	.superRefine((leg, ctx) => {
		const source = sourceOf(leg.line);
		if (
			sourceOf(leg.board.stop) !== source ||
			sourceOf(leg.alight.stop) !== source
		) {
			ctx.addIssue({
				code: "custom",
				message: "line and stops must share one source",
				path: ["line"],
			});
		}
	});

const routeSchema = z
	.object({
		legs: z.array(legSchema).min(1).max(MAX_LEGS),
		rank: z.number().int().min(0),
		walkMinutes: z.array(z.number().int().min(0).max(MAX_WALK_MINUTES)).min(2),
	})
	.strict()
	.superRefine((route, ctx) => {
		if (route.walkMinutes.length !== route.legs.length + 1) {
			ctx.addIssue({
				code: "custom",
				message: "walkMinutes length must be legs.length + 1",
				path: ["walkMinutes"],
			});
		}
	});

function isValidTimezone(value: string): boolean {
	try {
		const resolved = new Intl.DateTimeFormat("en-US", {
			timeZone: value,
		}).resolvedOptions();
		return resolved.timeZone.length > 0;
	} catch {
		return false;
	}
}

const scheduleSchema = z
	.object({
		days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
		includeHolidays: z.boolean(),
		leadMinutes: z.number().int().min(MIN_LEAD_MINUTES).max(MAX_LEAD_MINUTES),
		leaveMinute: z
			.number()
			.int()
			.min(0)
			.max(MINUTES_PER_DAY - 1),
		timezone: z.string().refine(isValidTimezone, "invalid timezone"),
	})
	.strict()
	.superRefine((schedule, ctx) => {
		if (new Set(schedule.days).size !== schedule.days.length) {
			ctx.addIssue({
				code: "custom",
				message: "days must be unique",
				path: ["days"],
			});
		}
	});

export const commutePlanSchema = z
	.object({
		enabled: z.boolean(),
		planId: z.uuid(),
		routes: z.array(routeSchema).min(1).max(MAX_ROUTES),
		schedule: scheduleSchema,
	})
	.strict()
	.superRefine((plan, ctx) => {
		const ranks = plan.routes.map((route) => route.rank);
		const primaryCount = ranks.filter((rank) => rank === 0).length;
		if (primaryCount !== 1) {
			ctx.addIssue({
				code: "custom",
				message: "exactly one route must have rank 0",
				path: ["routes"],
			});
		}
	}) as unknown as z.ZodType<CommutePlan>;

export function parsePlan(
	input: unknown
): { ok: true; plan: CommutePlan } | { ok: false; issues: string[] } {
	const result = commutePlanSchema.safeParse(input);
	if (result.success) {
		return { ok: true, plan: result.data };
	}
	return {
		issues: result.error.issues.map(
			(issue) => `${issue.path.join(".")}: ${issue.message}`
		),
		ok: false,
	};
}
