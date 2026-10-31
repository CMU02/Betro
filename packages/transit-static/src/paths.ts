import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
// src -> transit-static -> packages -> repo root
const REPO_ROOT = resolve(SRC_DIR, "..", "..", "..");

export function resolveDataDir(
	env: Record<string, string | undefined>
): string {
	const fromEnv = env.BETRO_DATA_DIR;
	if (fromEnv) {
		return fromEnv;
	}
	return join(REPO_ROOT, "data");
}

export function rawPath(
	dataDir: string,
	source: string,
	fileName: string
): string {
	return join(dataDir, "raw", source, fileName);
}
