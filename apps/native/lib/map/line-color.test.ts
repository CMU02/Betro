import { expect, it } from "bun:test";
import { COLOR_TOKENS, TRANSIT_COLORS } from "@/theme/tokens";
import { lineColor } from "./line-color";

it("uses the transit token of the line", () => {
	expect(
		lineColor({ line: "seoul-subway:line2", mode: "subway", name: "" }, "dark")
	).toBe(TRANSIT_COLORS["line/2"]);
	expect(
		lineColor(
			{ mode: "bus", name: "470", region: "seoul", routeType: "3" },
			"light"
		)
	).toBe(TRANSIT_COLORS["bus/trunk"]);
});

it("falls back to the neutral icon token for a line without its own color", () => {
	expect(
		lineColor({ line: "seoul-subway:seohae", mode: "subway", name: "" }, "dark")
	).toBe(COLOR_TOKENS["icon/secondary"].dark);
});

it("fades the line color with an alpha channel", () => {
	expect(
		lineColor(
			{ line: "seoul-subway:line2", mode: "subway", name: "" },
			"dark",
			0.4
		)
	).toBe(`${TRANSIT_COLORS["line/2"]}66`);
});
