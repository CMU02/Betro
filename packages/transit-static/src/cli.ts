import { createDb } from "@Betro/db";
import type { ServiceDay } from "@Betro/db/schema/transit";
import { parseArgs } from "node:util";
import { buildBusRoutes } from "./jobs/build-bus-routes";
import { buildCrosswalk } from "./jobs/build-crosswalk";
import { buildTimetable } from "./jobs/build-timetable";
import { buildTracks } from "./jobs/build-tracks";
import { fetchBusRouteXlsx } from "./jobs/fetch-bus-route-xlsx";
import { fetchBusRoutes } from "./jobs/fetch-bus-routes";
import { fetchOsm } from "./jobs/fetch-osm";
import { fetchRealtimeSample } from "./jobs/fetch-realtime-sample";
import { fetchStationMaster } from "./jobs/fetch-station-master";
import { fetchStationSearch } from "./jobs/fetch-station-search";
import { fetchStationXlsx } from "./jobs/fetch-station-xlsx";
import { fetchTimetableSources } from "./jobs/fetch-timetable-sources";
import { osmDiscover } from "./jobs/osm-discover";
import { reportMatchRate } from "./jobs/report-match-rate";
import { resolveDatabaseUrl } from "./paths";
import { resolveDataDir } from "./raw-store";
import { DEFAULT_BUS_ROUTE_XLSX_SEQ } from "./sources/bus-route-xlsx";
import {
	KRIC_MISSING_KEY_MESSAGE,
	readKricServiceKey,
} from "./sources/kric-api";

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

const BUS_MISSING_KEY_MESSAGE =
	"DATA_GO_KR_API_KEY가 없습니다. 공공데이터포털에서 서울특별시_노선정보조회 서비스(15000193) 활용신청 후 받은 서비스키를 설정하세요.";

const SERVICE_DAYS: readonly string[] = ["weekday", "saturday", "holiday"];

const isServiceDay = (value: string): value is ServiceDay =>
	SERVICE_DAYS.includes(value);

type CommandHandler = (args: string[]) => Promise<void>;

const commands: Record<string, CommandHandler> = {
	"build:bus-routes": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "dry-run": { type: "boolean" } },
		});
		const dryRun = values["dry-run"] === true;
		const db = dryRun
			? undefined
			: createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) });
		const result = await buildBusRoutes({
			dataDir: resolveDataDir(process.env),
			db,
			dryRun,
		});
		if (!result.ok) {
			process.exitCode = 1;
		}
	},
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
	"build:timetable": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "dry-run": { type: "boolean" } },
		});
		// dry-run이어도 현재 crosswalk 배치를 DB에서 읽으므로 DB는 항상 연다.
		const result = await buildTimetable({
			dataDir: resolveDataDir(process.env),
			db: createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) }),
			dryRun: values["dry-run"] === true,
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
	"fetch:bus-route-xlsx": async (args) => {
		const { values } = parseArgs({
			args,
			options: { seq: { type: "string" } },
		});
		const seq = Number(values.seq ?? DEFAULT_BUS_ROUTE_XLSX_SEQ);
		if (!Number.isInteger(seq) || seq <= 0) {
			throw new Error(`invalid --seq: ${values.seq}`);
		}
		await fetchBusRouteXlsx({ dataDir: resolveDataDir(process.env), seq });
	},
	"fetch:bus-routes": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "max-age-days": { type: "string" } },
		});
		const key = process.env.DATA_GO_KR_API_KEY;
		if (!key) {
			console.error(BUS_MISSING_KEY_MESSAGE);
			process.exit(1);
		}
		const maxAgeDays =
			values["max-age-days"] === undefined
				? undefined
				: Number(values["max-age-days"]);
		if (maxAgeDays !== undefined && !(maxAgeDays >= 0)) {
			throw new Error(`invalid --max-age-days: ${values["max-age-days"]}`);
		}
		const result = await fetchBusRoutes({
			dataDir: resolveDataDir(process.env),
			key,
			maxAgeDays,
		});
		if (
			result.stoppedBy === "quota-exceeded" ||
			result.stoppedBy === "unauthorized"
		) {
			process.exitCode = 1;
		}
	},
	"fetch:osm": async () => {
		await fetchOsm({ dataDir: resolveDataDir(process.env) });
	},
	"fetch:realtime-sample": async () => {
		await fetchRealtimeSample(resolveDataDir(process.env));
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
	"fetch:timetable-sources": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "gtx-a": { type: "boolean" } },
		});
		if (values["gtx-a"] === true && !readKricServiceKey(process.env)) {
			console.error(KRIC_MISSING_KEY_MESSAGE);
			process.exit(1);
		}
		await fetchTimetableSources({ dataDir: resolveDataDir(process.env) });
	},
	"osm:discover": async () => {
		await osmDiscover({ dataDir: resolveDataDir(process.env) });
	},
	"report:match-rate": async (args) => {
		const { values } = parseArgs({
			args,
			options: { "service-day": { type: "string" } },
		});
		const serviceDay = values["service-day"];
		if (serviceDay !== undefined && !isServiceDay(serviceDay)) {
			throw new Error(
				`invalid --service-day: ${serviceDay} (weekday|saturday|holiday)`
			);
		}
		await reportMatchRate({
			dataDir: resolveDataDir(process.env),
			db: createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) }),
			serviceDay,
		});
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
