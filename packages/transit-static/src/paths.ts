import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** 적재 대상 DB. DATABASE_URL이 없으면 저장소 루트의 local.db(apps/server 기본값과 같은 파일). */
export function resolveDatabaseUrl(
	env: Record<string, string | undefined>
): string {
	const fromEnv = env.DATABASE_URL;
	if (fromEnv) {
		return fromEnv;
	}
	return pathToFileURL(join(REPO_ROOT, "local.db")).href;
}

export function rawPath(
	dataDir: string,
	source: string,
	fileName: string
): string {
	return join(dataDir, "raw", source, fileName);
}
