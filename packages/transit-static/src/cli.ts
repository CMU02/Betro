import { parseArgs } from "node:util";
import { fetchStationXlsx } from "./jobs/fetch-station-xlsx";
import { resolveDataDir } from "./raw-store";

const DEFAULT_STATION_XLSX_SEQ = 57;

type CommandHandler = (args: string[]) => Promise<void>;

const commands: Record<string, CommandHandler> = {
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
