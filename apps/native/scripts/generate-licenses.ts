/**
 * `package.json`의 `dependencies`를 따라 설치된 패키지의 이름·버전·라이선스를
 * `assets/licenses.json`에 쓴다. 의존성을 바꾼 뒤 `bun scripts/generate-licenses.ts`로 다시 만든다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { collectLicenses } from "../lib/legal/licenses";

const APP_ROOT = join(import.meta.dir, "..");
const OUTPUT = join(APP_ROOT, "assets", "licenses.json");

/** 앱에서 위로 올라가며 `node_modules/<name>/package.json`을 찾는다(호이스팅된 설치도 잡는다). */
function readInstalled(
	name: string
): { license?: string; name: string; version: string } | null {
	let dir = APP_ROOT;
	for (;;) {
		const file = join(dir, "node_modules", name, "package.json");
		if (existsSync(file)) {
			return JSON.parse(readFileSync(file, "utf8"));
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

const pkgJson = JSON.parse(
	readFileSync(join(APP_ROOT, "package.json"), "utf8")
) as { dependencies: Record<string, string> };

const licenses = collectLicenses(pkgJson, readInstalled);
for (const entry of licenses) {
	if (entry.license === "UNKNOWN") {
		console.error(`라이선스를 찾지 못했어요: ${entry.name}`);
	}
}
for (const name of Object.keys(pkgJson.dependencies)) {
	if (
		!(
			pkgJson.dependencies[name]?.startsWith("workspace:") ||
			readInstalled(name)
		)
	) {
		console.error(`설치된 패키지를 찾지 못했어요: ${name}`);
	}
}
writeFileSync(OUTPUT, `${JSON.stringify(licenses, null, "\t")}\n`);
console.log(`${licenses.length}개를 ${OUTPUT}에 썼어요`);
