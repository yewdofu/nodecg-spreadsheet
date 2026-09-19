import assert from "node:assert/strict";
import {test} from "node:test";
import {JWT} from "google-auth-library";
import {readConfig} from "../src/extension/config";
import {createSheetReader} from "../src/extension/google";
import {sheetValues} from "./fixtures";

test("サービスアカウントで読み取り専用のGETを行い、3タブを設定順で取得する", async (context) => {
	const values = sheetValues();
	const config = readConfig({
		spreadsheetId: "sheet-id",
		serviceAccountKeyFile: "tests/fixtures/service-account.json",
		sheets: {players: "Player's list", commentators: "解説", schedules: "予定"},
	});
	let calls = 0;
	context.mock.method(
		JWT.prototype,
		"request",
		async function (
			this: JWT,
			options: {url: string; method: string; timeout: number},
		) {
			calls++;
			assert.equal(this.email, "test@example.invalid");
			assert.deepEqual(this.scopes, [
				"https://www.googleapis.com/auth/spreadsheets.readonly",
			]);
			const url = new URL(options.url);
			assert.equal(url.pathname, "/v4/spreadsheets/sheet-id/values:batchGet");
			assert.deepEqual(url.searchParams.getAll("ranges"), [
				"'Player''s list'",
				"'解説'",
				"'予定'",
			]);
			assert.equal(
				url.searchParams.get("valueRenderOption"),
				"FORMATTED_VALUE",
			);
			assert.equal(options.method, "GET");
			assert.equal(options.timeout, 15000);
			return {
				data: {
					valueRanges: Object.values(values).map((rows) => ({values: rows})),
				},
			};
		},
	);
	const read = createSheetReader(config, process.cwd());
	assert.deepEqual(await read(), values);
	assert.deepEqual(await read(), values);
	assert.equal(calls, 2);
});

test("取得結果の不足を検出する", async (context) => {
	context.mock.method(JWT.prototype, "request", async () => ({
		data: {valueRanges: [{values: []}]},
	}));
	await assert.rejects(
		createSheetReader(
			readConfig({
				spreadsheetId: "id",
				serviceAccountKeyFile: "tests/fixtures/service-account.json",
			}),
			process.cwd(),
		)(),
		/3つのシート/,
	);
});

test("未設定ではGoogleにアクセスせず設定エラーを返す", async (context) => {
	const request = context.mock.method(JWT.prototype, "request", async () => {
		throw new Error("unexpected request");
	});
	await assert.rejects(
		createSheetReader(readConfig({}), process.cwd())(),
		/bundleConfig/,
	);
	assert.equal(request.mock.callCount(), 0);
});
