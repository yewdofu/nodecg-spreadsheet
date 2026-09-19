import {randomUUID} from "node:crypto";
import {DateTime} from "luxon";
import {
	type EditData,
	type Person,
	personFields,
	type Schedule,
	type SpreadsheetData,
	scheduleFields,
	type TableName,
	tableNames,
} from "../shared/spreadsheet";
import {InputError} from "./errors";

export type SheetValues = Record<TableName, unknown[][]>;
const collator = new Intl.Collator("ja");
const sheetRowNumbers = new WeakMap<object, number>();

function fail(
	table: TableName,
	row: number,
	field: string,
	message: string,
): never {
	throw new InputError(`${tableNames[table]} ${row}行目 ${field}: ${message}`);
}

export function parseSheets(values: SheetValues): EditData {
	const parse = (table: TableName, fields: readonly string[]) => {
		const rows = values[table];
		const headers = rows[0]?.map((value) => String(value ?? "").trim()) ?? [];
		for (const field of fields) {
			if (headers.filter((header) => header === field).length !== 1)
				fail(table, 1, field, "見出しを1つ指定してください。");
		}
		return rows.slice(1).flatMap((row, index) => {
			const entries = fields.map((field) => {
				const value = row[headers.indexOf(field)] ?? "";
				if (
					typeof value !== "string" &&
					typeof value !== "number" &&
					typeof value !== "boolean"
				)
					fail(table, index + 2, field, "セルの値が不正です。");
				return [field, String(value).trim()] as const;
			});
			if (entries.every(([, value]) => !value)) return [];
			const parsed = {id: randomUUID(), ...Object.fromEntries(entries)};
			sheetRowNumbers.set(parsed, index + 2);
			return [parsed];
		});
	};
	return {
		players: parse("players", personFields),
		commentators: parse("commentators", personFields),
		schedules: parse("schedules", scheduleFields),
	} as EditData;
}

export function parseStartTime(
	value: string,
	timeZone: string,
): {start_time: string; startsAt: string | null} {
	if (!value) return {start_time: "", startsAt: null};
	const parts =
		/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
			value,
		);
	if (!parts)
		throw new InputError(
			"日時はYYYY-MM-DD HH:mm[:ss]またはYYYY/MM/DD HH:mm[:ss]で入力してください。",
		);
	const [, year, month, day, hour, minute, second = "0"] = parts;
	const local = {
		year: Number(year),
		month: Number(month),
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second),
	};
	const date = DateTime.fromObject(local, {zone: timeZone});
	if (
		!date.isValid ||
		date.year !== local.year ||
		date.month !== local.month ||
		date.day !== local.day ||
		date.hour !== local.hour ||
		date.minute !== local.minute ||
		date.second !== local.second
	) {
		throw new InputError("指定されたタイムゾーンに存在しない日時です。");
	}
	if (date.getPossibleOffsets().length !== 1)
		throw new InputError("夏時間の切り替えで重複する日時は指定できません。");
	return {
		start_time: date.toFormat("yyyy-MM-dd HH:mm:ss"),
		startsAt: date.toISO({suppressMilliseconds: true}),
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateData(
	input: unknown,
	timeZone: string,
): Pick<SpreadsheetData, "players" | "commentators" | "schedules"> {
	if (!record(input)) throw new InputError("編集データが不正です。");
	const read = (table: TableName, fields: readonly string[]) => {
		const rows = input[table];
		if (!Array.isArray(rows))
			throw new InputError(`${tableNames[table]}が配列ではありません。`);
		const ids = new Set<string>();
		return rows.map((row: unknown, index: number) => {
			if (!record(row)) fail(table, index + 1, "", "行が不正です。");
			const line = sheetRowNumbers.get(row) ?? index + 1;
			const output: Record<string, string> = {};
			for (const field of ["id", ...fields]) {
				const value = row[field];
				if (typeof value !== "string")
					fail(table, line, field, "文字列を入力してください。");
				output[field] = value.trim();
			}
			const id = output.id as string;
			if (!id || ids.has(id))
				fail(table, line, "id", "IDが空欄または重複しています。");
			ids.add(id);
			const required = table === "schedules" ? "game_name" : "name";
			if (!output[required]) fail(table, line, required, "入力が必要です。");
			if (table !== "schedules" && output.name?.includes(","))
				fail(table, line, "name", "名前にカンマは使用できません。");
			sheetRowNumbers.set(output, line);
			return output;
		});
	};
	const players = read("players", personFields) as unknown as Person[];
	const commentators = read(
		"commentators",
		personFields,
	) as unknown as Person[];
	const schedules = read("schedules", scheduleFields).map(
		(row, index): Schedule => {
			const line = sheetRowNumbers.get(row) ?? index + 1;
			const split = (field: "players" | "commentators") => [
				...new Set(
					row[field]
						?.split(",")
						.map((name) => name.trim())
						.filter(Boolean),
				),
			];
			const resolve = (field: "players" | "commentators", people: Person[]) =>
				split(field).map((name) => {
					let matches = people.filter((person) => person.name === name);
					if (matches.length > 1)
						matches = matches.filter(
							(person) =>
								person.game_name === row.game_name &&
								person.category === row.category,
						);
					if (matches.length !== 1)
						fail(
							"schedules",
							line,
							field,
							`「${name}」に一致する人物が${matches.length}件あります。人物一覧のname・game_name・categoryを確認してください。`,
						);
					return matches[0]!.id;
				});
			let start: ReturnType<typeof parseStartTime>;
			try {
				start = parseStartTime(row.start_time!, timeZone);
			} catch (error) {
				fail(
					"schedules",
					line,
					"start_time",
					error instanceof InputError ? error.message : "日時が不正です。",
				);
			}
			return {
				id: row.id!,
				...start,
				game_name: row.game_name!,
				release_year: row.release_year!,
				category: row.category!,
				estimate: row.estimate!,
				players: split("players"),
				commentators: split("commentators"),
				playerIds: resolve("players", players),
				commentatorIds: resolve("commentators", commentators),
			};
		},
	);
	schedules.sort((a, b) => {
		const first = a.startsAt === null ? Infinity : Date.parse(a.startsAt);
		const second = b.startsAt === null ? Infinity : Date.parse(b.startsAt);
		return (
			(first === second ? 0 : first - second) ||
			collator.compare(a.game_name, b.game_name)
		);
	});
	return {players, commentators, schedules};
}

export function reconcileSchedules(
	incoming: Schedule[],
	previous: Schedule[],
): Schedule[] {
	const identity = (schedule: Schedule) =>
		JSON.stringify([schedule.game_name, schedule.category, schedule.players]);
	const exact = (schedule: Schedule) =>
		JSON.stringify([
			identity(schedule),
			schedule.start_time,
			schedule.release_year,
			schedule.estimate,
			schedule.commentators,
		]);
	const unused = new Set(previous.map((schedule) => schedule.id));
	const assigned = new Map<Schedule, string>();
	for (const key of [exact, identity]) {
		const remaining = incoming.filter((schedule) => !assigned.has(schedule));
		for (const schedule of remaining) {
			const matchKey = key(schedule);
			const oldMatches = previous.filter(
				(candidate) => unused.has(candidate.id) && key(candidate) === matchKey,
			);
			if (
				oldMatches.length === 1 &&
				remaining.filter((candidate) => key(candidate) === matchKey).length ===
					1
			) {
				assigned.set(schedule, oldMatches[0]!.id);
				unused.delete(oldMatches[0]!.id);
			}
		}
	}
	return incoming.map((schedule) => ({
		...schedule,
		id: assigned.get(schedule) ?? schedule.id,
	}));
}
