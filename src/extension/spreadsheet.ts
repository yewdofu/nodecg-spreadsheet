import type NodeCG from "@nodecg/types";
import {
	emptyData,
	type SelectRequest,
	type SpreadsheetData,
	type SyncStatus,
} from "../shared/spreadsheet";
import type {Configschema} from "../types/generated/configschema";
import {readConfig} from "./config";
import {SpreadsheetController} from "./controller";
import {publicError} from "./errors";
import {createSheetReader} from "./google";

export function setupSpreadsheet(nodecg: NodeCG.ServerAPI<Configschema>) {
	const data = nodecg.Replicant<SpreadsheetData>("spreadsheetData", {
		defaultValue: emptyData(),
		persistent: true,
	});
	const status = nodecg.Replicant<SyncStatus>("syncStatus", {
		persistent: false,
	});
	let controller: SpreadsheetController;
	try {
		const config = readConfig(nodecg.bundleConfig);
		controller = new SpreadsheetController({
			config,
			readSheets: createSheetReader(config, process.cwd()),
			getData: () => data.value,
			setData: (value) => {
				data.value = value;
			},
			setStatus: (value) => {
				status.value = value;
			},
		});
	} catch (error) {
		const message = publicError(error);
		status.value = {
			syncing: false,
			lastAttemptAt: null,
			lastSuccessAt: null,
			error: message,
			autoSyncEnabled: false,
			intervalSeconds: 60,
			timeZone: "",
		};
		nodecg.log.error(message);
		for (const name of [
			"syncSpreadsheet",
			"saveSpreadsheet",
			"selectSchedule",
		]) {
			nodecg.listenFor(name, (_request: unknown, ack) => {
				if (ack && !ack.handled) ack(message);
			});
		}
		return;
	}
	nodecg.listenFor("syncSpreadsheet", (_request: unknown, ack) => {
		void controller
			.sync()
			.then(() => {
				if (ack && !ack.handled) ack(null);
			})
			.catch((error: unknown) => {
				if (ack && !ack.handled) ack(publicError(error));
			});
	});
	nodecg.listenFor("saveSpreadsheet", (request: unknown, ack) => {
		try {
			controller.save(request);
			if (ack && !ack.handled) ack(null);
		} catch (error) {
			if (ack && !ack.handled) ack(publicError(error));
		}
	});
	nodecg.listenFor("selectSchedule", (request: SelectRequest, ack) => {
		try {
			controller.select(request);
			if (ack && !ack.handled) ack(null);
		} catch (error) {
			if (ack && !ack.handled) ack(publicError(error));
		}
	});
	void controller.sync().catch((error: unknown) => {
		nodecg.log.warn(publicError(error));
	});
}
