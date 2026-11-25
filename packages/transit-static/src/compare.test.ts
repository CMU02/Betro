import { expect, test } from "bun:test";

import { compareCodeUnits } from "./compare";

test("compareCodeUnits는 인자 없는 sort()와 같은 순서를 낸다", () => {
	const items = ["b", "B", "a", "10", "9", "a", "_x", "가"];
	expect([...items].sort(compareCodeUnits)).toEqual([...items].sort());
	expect(compareCodeUnits("a", "a")).toBe(0);
});
