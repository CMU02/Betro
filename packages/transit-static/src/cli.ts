import { parseArgs } from "node:util";
import { fetchStationMaster } from "./jobs/fetch-station-master";
import { fetchStationSearch } from "./jobs/fetch-station-search";
import { fetchStationXlsx } from "./jobs/fetch-station-xlsx";
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
	await handler(rest);
}

await main();
