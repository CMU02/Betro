import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { rawPath } from "./paths";

// biome-ignore lint/performance/noBarrelFile: resolveDataDir is part of this module's public API per the task interface
export { rawPath, resolveDataDir } from "./paths";

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export interface RawReadResult {
	bytes: Uint8Array;
	sha256: string;
}

export async function readRaw(
	dataDir: string,
	source: string,
	fileName: string
): Promise<RawReadResult | undefined> {
	try {
		const bytes = new Uint8Array(
			await readFile(rawPath(dataDir, source, fileName))
		);
		return { bytes, sha256: sha256Hex(bytes) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

/** 원본 바이트를 그대로 저장한다. 같은 경로에 같은 해시가 이미 있으면 덮어쓰지 않는다. */
export async function saveRaw(
	dataDir: string,
	source: string,
	fileName: string,
	bytes: Uint8Array
): Promise<{ path: string; sha256: string; unchanged: boolean }> {
	const path = rawPath(dataDir, source, fileName);
	const sha256 = sha256Hex(bytes);
	const existing = await readRaw(dataDir, source, fileName);
	if (existing?.sha256 === sha256) {
		return { path, sha256, unchanged: true };
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
	return { path, sha256, unchanged: false };
}
