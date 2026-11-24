import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	SEGMENT_BASE_CLASS,
	SEGMENT_LABEL_VARIANT,
	SEGMENT_SELECTED_CLASS,
	SEGMENT_SELECTED_LABEL_CLASS,
	SEGMENTED_CLASS,
} from "./segmented-style";

test("Segmented는 설정 화면의 Figma Segmented와 같은 모양이다", () => {
	expect(SEGMENTED_CLASS).toContain("h-9");
	expect(SEGMENTED_CLASS).toContain("rounded-md");
	expect(SEGMENTED_CLASS).toContain("p-[3px]");
	expect(SEGMENT_BASE_CLASS).toContain("rounded-sm");
	expect(SEGMENT_SELECTED_CLASS).toBe("bg-bg-surface-raised");
	expect(SEGMENT_SELECTED_LABEL_CLASS).toBe("text-text-primary");
	expect(SEGMENT_LABEL_VARIANT).toBe("labelS");
});

test("설정 화면은 자체 복사본 대신 공용 Segmented를 쓴다", () => {
	const src = readFileSync(
		new URL("../../app/(tabs)/settings.tsx", import.meta.url),
		"utf8"
	);
	expect(src).toContain('from "@/components/ui/segmented"');
	expect(src).not.toContain("function ThemeOption");
});
