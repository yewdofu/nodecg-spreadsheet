import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {JWT} from "google-auth-library";
import type {Configschema} from "../types/generated/configschema";
import type {SheetValues} from "./data";
import {InputError} from "./errors";

export function createSheetReader(
	config: Configschema,
	root: string,
): () => Promise<SheetValues> {
	let client: JWT | undefined;
	return async () => {
		if (!config.spreadsheetId || !config.serviceAccountKeyFile)
			throw new InputError(
				"spreadsheetIdとserviceAccountKeyFileをbundleConfigに設定してください。",
			);
		if (!client) {
			const credentials = JSON.parse(
				await readFile(resolve(root, config.serviceAccountKeyFile), "utf8"),
			) as Record<string, unknown>;
			if (
				credentials.type !== "service_account" ||
				typeof credentials.client_email !== "string" ||
				typeof credentials.private_key !== "string"
			) {
				throw new InputError(
					"サービスアカウントのJSONキーファイルを指定してください。",
				);
			}
			client = new JWT({
				email: credentials.client_email,
				key: credentials.private_key,
				scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
				transporterOptions: {timeout: 15000, retry: false},
			});
		}
		const params = new URLSearchParams({
			majorDimension: "ROWS",
			valueRenderOption: "FORMATTED_VALUE",
		});
		for (const name of [
			config.sheets.players,
			config.sheets.commentators,
			config.sheets.schedules,
		]) {
			params.append("ranges", `'${name.replaceAll("'", "''")}'`);
		}
		const response = await client.request<{
			valueRanges?: {values?: unknown[][]}[];
		}>({
			url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values:batchGet?${params}`,
			method: "GET",
			timeout: 15000,
			retry: false,
		});
		const ranges = response.data.valueRanges;
		if (
			!Array.isArray(ranges) ||
			ranges.length !== 3 ||
			ranges.some(
				(range) =>
					!range ||
					(range.values !== undefined &&
						(!Array.isArray(range.values) ||
							range.values.some((row) => !Array.isArray(row)))),
			)
		) {
			throw new InputError("3つのシートをすべて取得できませんでした。");
		}
		return {
			players: ranges[0]!.values ?? [],
			commentators: ranges[1]!.values ?? [],
			schedules: ranges[2]!.values ?? [],
		};
	};
}
