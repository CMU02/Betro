import { describe, expect, test } from "bun:test";
import { type CommutePlan, parsePlan } from "./plan";

const PLAN_ID = "3f2b8c1e-5d4a-4b7e-9c10-1a2b3c4d5e6f";

function basePlan(): CommutePlan {
	return {
		enabled: true,
		planId: PLAN_ID,
		routes: [
			{
				legs: [
					{
						alight: { name: "나", seq: 20, stop: "seoul-bus:119000022" },
						board: { name: "가", seq: 3, stop: "seoul-bus:119000011" },
						line: "seoul-bus:100100290",
						lineName: "6411",
						mode: "bus",
					},
				],
				rank: 0,
				walkMinutes: [5, 3],
			},
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 490,
			timezone: "Asia/Seoul",
		},
	};
}

function clone(): Record<string, any> {
	return structuredClone(basePlan()) as unknown as Record<string, any>;
}

function issuesOf(input: unknown): string[] {
	const result = parsePlan(input);
	if (result.ok) {
		throw new Error("expected rejection");
	}
	return result.issues;
}

const subwayLeg = {
	alight: { name: "강남", stop: "seoul-subway:1002000223" },
	board: { name: "성수", stop: "seoul-subway:1002000222" },
	direction: "up",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

describe("parsePlan", () => {
	test("accepts a one-leg bus plan", () => {
		expect(parsePlan(basePlan()).ok).toBe(true);
	});

	test("accepts a bus plus subway route with a transfer", () => {
		const plan = clone();
		plan.routes[0].legs.push(subwayLeg);
		plan.routes[0].walkMinutes = [5, 4, 3];
		expect(parsePlan(plan).ok).toBe(true);
	});

	test("rejects zero routes", () => {
		const plan = clone();
		plan.routes = [];
		expect(issuesOf(plan).join("\n")).toContain("routes");
	});

	test("rejects missing or duplicated rank 0", () => {
		const none = clone();
		none.routes[0].rank = 1;
		expect(issuesOf(none).length).toBeGreaterThan(0);
		const two = clone();
		two.routes.push(structuredClone(two.routes[0]));
		expect(issuesOf(two).length).toBeGreaterThan(0);
	});

	test("rejects five routes", () => {
		const plan = clone();
		plan.routes = [0, 1, 2, 3, 4].map((rank) => ({
			...structuredClone(plan.routes[0]),
			rank,
		}));
		expect(issuesOf(plan).join("\n")).toContain("routes");
	});

	test("rejects zero or five legs", () => {
		const zero = clone();
		zero.routes[0].legs = [];
		zero.routes[0].walkMinutes = [5];
		expect(issuesOf(zero).join("\n")).toContain("legs");
		const five = clone();
		five.routes[0].legs = Array.from({ length: 5 }, () =>
			structuredClone(subwayLeg)
		);
		five.routes[0].walkMinutes = [1, 1, 1, 1, 1, 1];
		expect(issuesOf(five).join("\n")).toContain("legs");
	});

	test("rejects wrong walkMinutes length", () => {
		const plan = clone();
		plan.routes[0].walkMinutes = [5, 3, 2];
		expect(issuesOf(plan).join("\n")).toContain("walkMinutes");
	});

	test("rejects walk over 60 minutes or negative", () => {
		const over = clone();
		over.routes[0].walkMinutes = [61, 3];
		expect(issuesOf(over).join("\n")).toContain("walkMinutes");
		const negative = clone();
		negative.routes[0].walkMinutes = [-1, 3];
		expect(issuesOf(negative).join("\n")).toContain("walkMinutes");
	});

	test("rejects bad days", () => {
		for (const days of [[], [7], [1, 1]]) {
			const plan = clone();
			plan.schedule.days = days;
			expect(issuesOf(plan).join("\n")).toContain("schedule.days");
		}
	});

	test("rejects leaveMinute 1440", () => {
		const plan = clone();
		plan.schedule.leaveMinute = 1440;
		expect(issuesOf(plan).join("\n")).toContain("leaveMinute");
	});

	test("rejects leadMinutes 4 and 31", () => {
		for (const leadMinutes of [4, 31]) {
			const plan = clone();
			plan.schedule.leadMinutes = leadMinutes;
			expect(issuesOf(plan).join("\n")).toContain("leadMinutes");
		}
	});

	test("rejects a timezone Intl does not know", () => {
		const plan = clone();
		plan.schedule.timezone = "Seoul";
		expect(issuesOf(plan).join("\n")).toContain("timezone");
	});

	test("rejects bus alight.seq <= board.seq", () => {
		const plan = clone();
		plan.routes[0].legs[0].alight.seq = 3;
		expect(issuesOf(plan).join("\n")).toContain("alight.seq");
	});

	test("rejects a leg whose line and stops come from different sources", () => {
		const plan = clone();
		plan.routes[0].legs[0].board.stop = "seoul-subway:1002000222";
		expect(issuesOf(plan).length).toBeGreaterThan(0);
	});

	test("rejects a subway leg with the same board and alight station", () => {
		const plan = clone();
		plan.routes[0].legs = [
			{
				...subwayLeg,
				alight: { name: "성수", stop: "seoul-subway:1002000222" },
			},
		];
		plan.routes[0].walkMinutes = [5, 3];
		expect(issuesOf(plan).join("\n")).toContain("alight");
	});

	test("rejects a planId that is not a UUID", () => {
		const plan = clone();
		plan.planId = "plan-1";
		expect(issuesOf(plan).join("\n")).toContain("planId");
	});

	test("rejects address and lat fields (strict)", () => {
		const withAddress = clone();
		withAddress.address = "서울시";
		expect(parsePlan(withAddress).ok).toBe(false);
		const withLat = clone();
		withLat.routes[0].legs[0].board.lat = 37.5;
		expect(parsePlan(withLat).ok).toBe(false);
		const inSchedule = clone();
		inSchedule.schedule.address = "x";
		expect(parsePlan(inSchedule).ok).toBe(false);
	});
});
