import { getRandomBytes, randomUUID } from "expo-crypto";
import { getItemAsync, setItemAsync } from "expo-secure-store";

import {
	getOrCreateInstallIdentity,
	type InstallIdentity,
} from "./install-identity";

export function ensureInstallIdentity(): Promise<InstallIdentity> {
	return getOrCreateInstallIdentity(
		{
			getItem: (key) => getItemAsync(key),
			setItem: (key, value) => setItemAsync(key, value),
		},
		{
			bytes: (length) => getRandomBytes(length),
			uuid: () => randomUUID(),
		}
	);
}
