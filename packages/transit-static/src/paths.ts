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

const FILE_SCHEME = "file:";
const FILE_URL_PREFIX = "file://";

/**
 * libsql DB URL이 가리키는 로컬 파일 경로. 파일이 아닌 URL(:memory:, libsql://, http(s)://)은 undefined.
 * "file:///abs/local.db"는 fileURLToPath로, "file:./local.db"처럼 상대 경로는 libsql과 같이 cwd 기준으로 푼다.
 */
export function databaseFilePath(databaseUrl: string): string | undefined {
	if (!databaseUrl.startsWith(FILE_SCHEME)) {
		return undefined;
	}
	if (databaseUrl.startsWith(FILE_URL_PREFIX)) {
		return fileURLToPath(databaseUrl);
	}
	const [relativePath = ""] = databaseUrl.slice(FILE_SCHEME.length).split("?");
	return resolve(relativePath);
}

export function rawPath(
	dataDir: string,
	source: string,
	fileName: string
): string {
	return join(dataDir, "raw", source, fileName);
}
