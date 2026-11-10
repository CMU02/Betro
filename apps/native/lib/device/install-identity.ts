export interface InstallIdentity {
	installId: string;
	secret: string;
}

export interface SecureKeyValue {
	getItem: (key: string) => Promise<string | null>;
	setItem: (key: string, value: string) => Promise<void>;
}

export interface RandomSource {
	bytes: (length: number) => Uint8Array;
	uuid: () => string;
}

export const INSTALL_ID_KEY = "betro.installId";
export const INSTALL_SECRET_KEY = "betro.installSecret";

const SECRET_BYTES = 32;
const PLUS = /\+/g;
const SLASH = /\//g;
const PADDING = /[=]+$/;

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(PLUS, "-")
		.replace(SLASH, "_")
		.replace(PADDING, "");
}

/**
 * 설치 ID와 비밀값을 읽거나 새로 만든다.
 * 둘 중 하나만 있으면 둘 다 새로 만들고, 저장소 예외는 그대로 올린다.
 */
export async function getOrCreateInstallIdentity(
	store: SecureKeyValue,
	random: RandomSource
): Promise<InstallIdentity> {
	const installId = await store.getItem(INSTALL_ID_KEY);
	const secret = await store.getItem(INSTALL_SECRET_KEY);
	if (installId && secret) {
		return { installId, secret };
	}
	const created: InstallIdentity = {
		installId: random.uuid(),
		secret: toBase64Url(random.bytes(SECRET_BYTES)),
	};
	await store.setItem(INSTALL_ID_KEY, created.installId);
	await store.setItem(INSTALL_SECRET_KEY, created.secret);
	return created;
}
