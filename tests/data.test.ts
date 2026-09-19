import assert from "node:assert/strict";
import {test} from "node:test";
import {
	parseSheets,
	parseStartTime,
	reconcileSchedules,
	validateData,
} from "../src/extension/data";
import {editData, person, schedule, sheetValues} from "./fixtures";

test("日時をイベントのタイムゾーンで解釈して公開する", () => {
	assert.deepEqual(parseStartTime("2026/9/16 10:00", "Asia/Tokyo"), {
		start_time: "2026-09-16 10:00:00",
		startsAt: "2026-09-16T10:00:00+09:00",
	});
	assert.equal(
		parseStartTime("2026-09-16T10:00:00", "America/New_York").startsAt,
		"2026-09-16T10:00:00-04:00",
	);
	assert.equal(parseStartTime("", "Asia/Tokyo").startsAt, null);
});

test("不正な日時と夏時間で欠落・重複する日時を拒否する", () => {
	for (const value of [
		"2026-02-30 10:00",
		"2026-09-16 24:00",
		"10:00",
		"2026-09-16T10:00Z",
	])
		assert.throws(() => parseStartTime(value, "Asia/Tokyo"));
	assert.throws(
		() => parseStartTime("2026-03-08 02:30", "America/New_York"),
		/存在しない/,
	);
	assert.throws(
		() => parseStartTime("2026-11-01 01:30", "America/New_York"),
		/重複/,
	);
});

test("日付を含む開始日時・日本語タイトル順で並べ、空欄は末尾にする", () => {
	const schedules = [
		schedule({id: "empty-z", start_time: "", game_name: "わ"}),
		schedule({id: "next", start_time: "2026-09-17 00:00"}),
		schedule({id: "i", game_name: "い"}),
		schedule({id: "a", game_name: "あ"}),
		schedule({id: "same", game_name: "あ"}),
		schedule({id: "empty-a", start_time: "", game_name: "あ"}),
	];
	assert.deepEqual(
		validateData(editData({schedules}), "Asia/Tokyo").schedules.map(
			(row) => row.id,
		),
		["a", "same", "i", "next", "empty-a", "empty-z"],
	);
});

test("同名人物はゲームとカテゴリで絞り込む", () => {
	const input = editData({
		players: [person({id: "other", game_name: "別ゲーム"}), person()],
		commentators: [person({id: "commentator", name: "解説"})],
		schedules: [schedule({players: " 走者,走者, ", commentators: "解説"})],
	});
	const result = validateData(input, "Asia/Tokyo").schedules[0]!;
	assert.deepEqual(result.players, ["走者"]);
	assert.deepEqual(result.playerIds, ["player-1"]);
	assert.deepEqual(result.commentatorIds, ["commentator"]);
});

test("名前に1件だけ一致する人物はゲーム・カテゴリに関係なく照合する", () => {
	assert.deepEqual(
		validateData(
			editData({players: [person({game_name: "別ゲーム", category: ""})]}),
			"Asia/Tokyo",
		).schedules[0]!.playerIds,
		["player-1"],
	);
});

test("人物が未登録または3項目でも重複する場合は更新を拒否する", () => {
	assert.throws(
		() => validateData(editData({players: []}), "Asia/Tokyo"),
		/0件/,
	);
	assert.throws(
		() =>
			validateData(
				editData({players: [person(), person({id: "duplicate"})]}),
				"Asia/Tokyo",
			),
		/2件/,
	);
	assert.throws(
		() =>
			validateData(
				editData({
					players: [
						person({game_name: "別"}),
						person({id: "other", game_name: "他"}),
					],
				}),
				"Asia/Tokyo",
			),
		/0件/,
	);
});

test("見出しで列を対応付け、追加列と空行を無視する", () => {
	const values = sheetValues();
	values.players = values.players.map((row) => ["余分", ...row.toReversed()]);
	values.players.splice(1, 0, []);
	const result = validateData(parseSheets(values), "Asia/Tokyo");
	assert.equal(result.players[0]!.name, "走者");
	assert.equal(result.schedules[0]!.playerIds[0], result.players[0]!.id);
});

test("見出し欠落・重複を検出する", () => {
	const missing = sheetValues();
	missing.players[0] = ["name"];
	assert.throws(() => parseSheets(missing), /twitch_id/);
	const duplicate = sheetValues();
	duplicate.players[0]!.push("name");
	assert.throws(() => parseSheets(duplicate), /name/);
});

test("空行を除外した後もエラーは実際のシート行番号を示す", () => {
	const values = sheetValues(
		editData({schedules: [schedule({players: "未登録"})]}),
	);
	values.schedules.splice(1, 0, [], []);
	assert.throws(
		() => validateData(parseSheets(values), "Asia/Tokyo"),
		/スケジュール 4行目 players/,
	);
});

test("空のデータは見出しがあれば有効とする", () => {
	assert.deepEqual(
		validateData(
			parseSheets(sheetValues({players: [], commentators: [], schedules: []})),
			"Asia/Tokyo",
		),
		{players: [], commentators: [], schedules: []},
	);
	assert.throws(
		() => parseSheets({players: [], commentators: [], schedules: []}),
		/見出し/,
	);
});

test("編集データの型・必須値・IDをサーバーで検証する", () => {
	for (const input of [
		null,
		{players: false},
		editData({players: [person({name: ""})]}),
		editData({players: [person({name: "A,B"})]}),
		editData({schedules: [schedule({game_name: ""})]}),
		editData({players: [person(), person()]}),
	])
		assert.throws(() => validateData(input, "Asia/Tokyo"));
	assert.throws(
		() =>
			validateData(
				{...editData(), schedules: [{...schedule(), estimate: 123}]},
				"Asia/Tokyo",
			),
		/文字列/,
	);
});

test("再同期で開始日時・並び順が変わっても一意なスケジュールのIDを維持する", () => {
	const previous = validateData(editData(), "Asia/Tokyo").schedules;
	const incoming = validateData(
		editData({
			schedules: [schedule({id: "new-id", start_time: "2026-09-17 12:00"})],
		}),
		"Asia/Tokyo",
	).schedules;
	assert.equal(reconcileSchedules(incoming, previous)[0]!.id, "schedule-1");
});

test("重複したスケジュールを推測して追跡しない", () => {
	const previous = validateData(
		editData({schedules: [schedule(), schedule({id: "old-2"})]}),
		"Asia/Tokyo",
	).schedules;
	const incoming = validateData(
		editData({schedules: [schedule({id: "new-1"}), schedule({id: "new-2"})]}),
		"Asia/Tokyo",
	).schedules;
	assert.deepEqual(
		reconcileSchedules(incoming, previous).map((row) => row.id),
		["new-1", "new-2"],
	);
});
