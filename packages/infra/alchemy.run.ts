import * as Prisma from "@alchemy.run/prisma";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

export const prismaProject = Prisma.Project("project", {
  createDatabase: false,
  region: "us-east-1",
});

export const databaseEnv = Effect.succeed({
  DATABASE_URL: Config.Redacted("DATABASE_URL"),
});

export const databaseProviders = Prisma.providers();

export const server = Prisma.Compute(
  "server",
  Effect.gen(function* () {
    const project = yield* prismaProject;
    const resolvedDatabaseEnv = yield* databaseEnv;

    return {
      project,
      path: "../../apps/server",
      build: {
        type: "auto",
        framework: "bun",
      },
      entrypoint: "src/index.ts",
      port: 3000,
      env: {
        ...resolvedDatabaseEnv,
        CORS_ORIGIN: Config.String("CORS_ORIGIN"),
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
        BETTER_AUTH_URL: Config.String("BETTER_AUTH_URL"),
      },
      healthCheck: { path: "/" },
      destroyOldDeployment: true,
      dev: {
        command: "bun run dev:bare",
        port: 3000,
      },
    };
  }),
);

export default Alchemy.Stack(
  "Betro",
  {
    providers: databaseProviders,
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const serverWorker = yield* server;

    return {
      server: serverWorker.url,
    };
  }),
);
