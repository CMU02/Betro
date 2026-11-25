/** 의존성 하나의 라이선스 표기. */
export interface LicenseEntry {
	license: string;
	name: string;
	version: string;
}

const WORKSPACE_PREFIX = "workspace:";

/**
 * `dependencies`를 따라 설치된 패키지의 라이선스를 모은다. `workspace:` 의존성은 우리 코드라 뺀다.
 * `license`가 없으면 "UNKNOWN"이고, 읽지 못한 패키지는 건너뛴다. 이름순으로 돌려준다.
 */
export function collectLicenses(
	pkgJson: { dependencies: Record<string, string> },
	readPackage: (
		name: string
	) => { license?: string; name: string; version: string } | null
): LicenseEntry[] {
	const entries: LicenseEntry[] = [];
	for (const [name, range] of Object.entries(pkgJson.dependencies)) {
		if (range.startsWith(WORKSPACE_PREFIX)) {
			continue;
		}
		const pkg = readPackage(name);
		if (!pkg) {
			continue;
		}
		entries.push({
			license: pkg.license?.trim() || "UNKNOWN",
			name: pkg.name,
			version: pkg.version,
		});
	}
	// 로케일에 따라 순서가 달라지지 않도록 코드 단위로 비교한다.
	return entries.sort((a, b) => {
		if (a.name === b.name) {
			return 0;
		}
		return a.name < b.name ? -1 : 1;
	});
}

/** `assets/licenses.json`에 쓸 문자열. Biome JSON 포맷(2칸 들여쓰기)과 맞춰 CI 포맷 검사를 통과시킨다. */
export function serializeLicenses(entries: readonly LicenseEntry[]): string {
	return `${JSON.stringify(entries, null, 2)}\n`;
}
