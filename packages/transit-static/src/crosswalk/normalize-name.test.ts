import { describe, expect, it } from "bun:test";
import { normalizeStationName } from "./normalize-name";

describe("normalizeStationName", () => {
	it.each([
		["서울역", "서울"],
		["서울", "서울"],
		[" 성수 ", "성수"],
		["응암순환(상선)", "응암순환"],
		["대모산입구", "대모산입구"],
		["총신대입구(이수)", "총신대입구"],
		["동대문역사문화공원", "동대문역사문화공원"],
		["여의나루역", "여의나루"],
		["신촌(경의중앙선)", "신촌"],
		["월드컵경기장(성산)", "월드컵경기장"],
		["잠실새내", "잠실새내"],
		["역곡", "역곡"],
		["이대", "이대"],
	])("%s → %s", (input, expected) => {
		expect(normalizeStationName(input)).toBe(expected);
	});
});
