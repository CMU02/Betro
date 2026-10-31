import { createDb } from "@Betro/db";
import { parseArgs } from "node:util";
import { buildCrosswalk } from "./jobs/build-crosswalk";
import { buildTracks } from "./jobs/build-tracks";
import { fetchOsm } from "./jobs/fetch-osm";
import { fetchStationMaster } from "./jobs/fetch-station-master";
import { fetchStationSearch } from "./jobs/fetch-station-search";
import { fetchStationXlsx } from "./jobs/fetch-station-xlsx";
import { fetchTimetableSources } from "./jobs/fetch-timetable-sources";
import { osmDiscover } from "./jobs/osm-discover";
import { resolveDatabaseUrl } from "./paths";
import { resolveDataDir } from "./raw-store";

const DEFAULT_STATION_XLSX_SEQ = 57;

const MISSING_KEY_MESSAGE =
	"SEOUL_OPEN_API_KEY가 없습니다. 서울 열린데이터광장에서 일반 인증키를 발급받아 설정하세요.";

function requireApiKey(): string {
	const key = process.env.SEOUL_OPEN_API_KEY;
	if (!key) {
		console.error(MISSING_KEY_MESSAGE);
		process.exit(1);
	}
	return key;
}

type CommandHandler = (args: string[]) => Promise<void>;

const commands: Record<string, CommandHandler> = {
	"build:crosswalk": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "dry-run": { type: "boolean" } },
		});
		const dryRun = values["dry-run"] === true;
		const db = dryRun
			? undefined
			: createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) });
		const result = await buildCrosswalk({
			dataDir: resolveDataDir(process.env),
			db,
			dryRun,
		});
		if (!result.ok) {
			process.exitCode = 1;
		}
	},
	"build:tracks": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "dry-run": { type: "boolean" } },
		});
		// dry-run이어도 현재 crosswalk 배치를 DB에서 읽으므로 DB는 항상 연다.
		const result = await buildTracks({
			dataDir: resolveDataDir(process.env),
			db: createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) }),
			dryRun: values["dry-run"] === true,
		});
		if (!result.ok) {
			process.exitCode = 1;
		}
	},
	"fetch:osm": async () => {
		await fetchOsm({ dataDir: resolveDataDir(process.env) });
	},
	"fetch:station-master": async () => {
		const key = requireApiKey();
		await fetchStationMaster({ dataDir: resolveDataDir(process.env), key });
	},
	"fetch:station-search": async () => {
		const key = requireApiKey();
		await fetchStationSearch({ dataDir: resolveDataDir(process.env), key });
	},
	"fetch:station-xlsx": async (args) => {
		const { values } = parseArgs({
			args,
			options: { seq: { type: "string" } },
		});
		const seq = Number(values.seq ?? DEFAULT_STATION_XLSX_SEQ);
		if (!Number.isInteger(seq) || seq <= 0) {
			throw new Error(`invalid --seq: ${values.seq}`);
		}
		await fetchStationXlsx({ dataDir: resolveDataDir(process.env), seq });
	},
	"fetch:timetable-sources": async () => {
		await fetchTimetableSources({ dataDir: resolveDataDir(process.env) });
	},
	"osm:discover": async () => {
		await osmDiscover({ dataDir: resolveDataDir(process.env) });
	},
};

async function main(): Promise<void> {
	const [, , name, ...rest] = process.argv;
	const handler = name ? commands[name] : undefined;
	if (!handler) {
		console.error(
			`unknown command: ${name ?? "(none)"}\navailable:\n${Object.keys(commands)
				.map((c) => `  ${c}`)
				.join("\n")}`
		);
		process.exit(1);
	}
	try {
		await handler(rest);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

await main();
