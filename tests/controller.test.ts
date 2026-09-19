import assert from "node:assert/strict";
import {test} from "node:test";
import {setImmediate} from "node:timers/promises";
import {readConfig} from "../src/extension/config";
import {SpreadsheetController} from "../src/extension/controller";
import type {SheetValues} from "../src/extension/data";
import {type SyncStatus, toEditData} from "../src/shared/spreadsheet";
import {editData, emptyData, person, schedule, sheetValues} from "./fixtures";

function setup(
	readSheets: () => Promise<SheetValues> = async () => sheetValues(),
	enabled = false,
) {
	let data = emptyData();
	let status: SyncStatus;
	const controller = new SpreadsheetController({
		config: readConfig({autoSync: {enabled, intervalSeconds: 1}}),
		readSheets,
		getData: () => data,
		setData: (next) => {
			data = next;
		},
		setStatus: (next) => {
			status = next;
		},
	});
	return {
		controller,
		get data() {
			return data;
		},
		get status() {
			return status;
		},
	};
}

test("同期は3シートをまとめて公開し、編集・選択・再同期を反映する", async () => {
	const app = setup();
	await app.controller.sync();
	assert.equal(app.data.revision, 1);
	assert.equal(app.data.source, "sheet");
	const id = app.data.schedules[0]!.id;
	app.controller.select({revision: 1, id});
	const draft = toEditData(app.data);
	draft.players[0]!.twitch_id = "edited";
	app.controller.save({...draft, revision: 2});
	assert.equal(app.data.players[0]!.twitch_id, "edited");
	assert.equal(app.data.source, "dashboard");
	await app.controller.sync();
	assert.equal(app.data.players[0]!.twitch_id, "runner");
	assert.equal(app.data.selectedScheduleId, id);
	assert.equal(app.data.revision, 4);
	assert.equal(app.status.error, null);
	assert.ok(app.status.lastSuccessAt);
});

test("同期失敗時はデータと最終成功日時を保持し、秘密情報を公開しない", async () => {
	let failure = false;
	const app = setup(async () => {
		if (failure) throw new Error("private_key SECRET access_token TOKEN");
		return sheetValues();
	});
	await app.controller.sync();
	const before = structuredClone(app.data);
	const successAt = app.status.lastSuccessAt;
	failure = true;
	await assert.rejects(app.controller.sync(), /同期に失敗/);
	assert.deepEqual(app.data, before);
	assert.equal(app.status.lastSuccessAt, successAt);
	assert.equal(app.status.syncing, false);
	assert.doesNotMatch(app.status.error!, /SECRET|TOKEN|private_key/);
});

test("1つのシートが不正でも部分更新を公開しない", async () => {
	let values = sheetValues();
	const app = setup(async () => values);
	await app.controller.sync();
	const before = structuredClone(app.data);
	values = sheetValues(editData({schedules: [schedule({players: "不明"})]}));
	await assert.rejects(app.controller.sync(), /0件/);
	assert.deepEqual(app.data, before);
});

test("同期が重なったら同じ処理を待ち、取得中の保存・選択を拒否する", async () => {
	let resolve!: (data: SheetValues) => void;
	let count = 0;
	const app = setup(() => {
		count++;
		return new Promise((done) => {
			resolve = done;
		});
	});
	const first = app.controller.sync();
	assert.equal(app.controller.sync(), first);
	assert.throws(
		() => app.controller.save({...editData(), revision: 0}),
		/同期中/,
	);
	assert.throws(() => app.controller.select({revision: 0, id: null}), /同期中/);
	await Promise.resolve();
	resolve(sheetValues());
	await first;
	assert.equal(count, 1);
});

test("古い編集と不正な参照は保存せず、人物・スケジュールを一括編集できる", async () => {
	const app = setup();
	await app.controller.sync();
	assert.throws(
		() => app.controller.save({...editData(), revision: 0}),
		/更新されています/,
	);
	assert.throws(
		() =>
			app.controller.save({...toEditData(app.data), players: [], revision: 1}),
		/0件/,
	);
	const draft = toEditData(app.data);
	draft.players[0]!.name = "改名";
	draft.schedules[0]!.players = "改名";
	draft.commentators.push(person({id: "new-commentator", name: "解説"}));
	draft.schedules[0]!.commentators = "解説";
	app.controller.save({...draft, revision: 1});
	assert.equal(app.data.players[0]!.name, "改名");
	assert.deepEqual(app.data.schedules[0]!.commentatorIds, ["new-commentator"]);
});

test("選択中の行が削除されたら選択を解除する", async () => {
	const app = setup();
	await app.controller.sync();
	app.controller.select({revision: 1, id: app.data.schedules[0]!.id});
	app.controller.save({...toEditData(app.data), schedules: [], revision: 2});
	assert.equal(app.data.selectedScheduleId, null);
	assert.throws(
		() => app.controller.select({revision: 3, id: "missing"}),
		/存在しません/,
	);
});

test("再同期で選択中の行が消失したら選択を解除する", async () => {
	let values = sheetValues();
	const app = setup(async () => values);
	await app.controller.sync();
	app.controller.select({revision: 1, id: app.data.schedules[0]!.id});
	values = sheetValues({players: [], commentators: [], schedules: []});
	await app.controller.sync();
	assert.equal(app.data.selectedScheduleId, null);
	assert.equal(app.data.schedules.length, 0);
});

test("自動同期は処理完了から秒数を数え、失敗後も継続し、停止で解除される", async (context) => {
	context.mock.timers.enable({apis: ["setTimeout"]});
	let calls = 0;
	const app = setup(async () => {
		calls++;
		if (calls === 2) throw new Error("offline");
		return sheetValues();
	}, true);
	await app.controller.sync();
	context.mock.timers.tick(999);
	await setImmediate();
	assert.equal(calls, 1);
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(calls, 2);
	assert.ok(app.status.error);
	context.mock.timers.tick(1000);
	await setImmediate();
	assert.equal(calls, 3);
	assert.equal(app.status.error, null);
	app.controller.stop();
	context.mock.timers.tick(5000);
	await setImmediate();
	assert.equal(calls, 3);
});

test("自動同期が無効なら起動同期以外を予約しない", async (context) => {
	context.mock.timers.enable({apis: ["setTimeout"]});
	let calls = 0;
	const app = setup(async () => {
		calls++;
		return sheetValues();
	});
	await app.controller.sync();
	context.mock.timers.tick(60000);
	await setImmediate();
	assert.equal(calls, 1);
});

test("設定を補完し、不正なタイムゾーン・同期間隔・シート名を拒否する", () => {
	assert.equal(readConfig({}).timeZone, "Asia/Tokyo");
	assert.equal(readConfig({}).autoSync.enabled, false);
	assert.throws(() => readConfig({timeZone: "invalid"}), /timeZone/);
	for (const intervalSeconds of [0, -1, 0.5, 2147484])
		assert.throws(
			() => readConfig({autoSync: {enabled: true, intervalSeconds}}),
			/intervalSeconds/,
		);
	assert.throws(
		() =>
			readConfig({
				sheets: {players: "同じ", commentators: "同じ", schedules: "予定"},
			}),
		/シート名/,
	);
});
