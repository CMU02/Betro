import type { Database } from "@Betro/db";
import { account, session, user, verification } from "@Betro/db/schema/auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";

export interface AuthConfig {
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	/** 쉼표로 나눈 origin 목록. 예: `http://localhost:8081` */
	CORS_ORIGIN: string;
}

const authSchema = { account, session, user, verification };

/** `CORS_ORIGIN`(쉼표 구분)을 공백을 걷어 낸 origin 배열로 바꾼다. */
export function parseOrigins(value: string): string[] {
	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);
}

export function createAuth(
	env: AuthConfig,
	database: Database,
	extraOrigins: readonly string[] = []
) {
	return betterAuth({
		advanced: {
			defaultCookieAttributes: {
				httpOnly: true,
				sameSite: "none",
				secure: true,
			},
		},
		baseURL: env.BETTER_AUTH_URL,
		database: drizzleAdapter(database, {
			provider: "sqlite",
			schema: authSchema,
			// D1은 대화형 트랜잭션을 지원하지 않는다.
			transaction: false,
		}),
		emailAndPassword: { enabled: true },
		plugins: [expo()],
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [
			...parseOrigins(env.CORS_ORIGIN),
			...extraOrigins,
			"Betro://",
			"exp://",
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
