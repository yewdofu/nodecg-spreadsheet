import type {SheetValues} from "../src/extension/data";
import {
	type EditData,
	emptyData,
	type PersonInput,
	personFields,
	type ScheduleInput,
	scheduleFields,
} from "../src/shared/spreadsheet";

export function person(overrides: Partial<PersonInput> = {}): PersonInput {
	return {
		id: "player-1",
		name: "走者",
		twitch_id: "runner",
		twitter_id: "",
		youtube_id: "",
		game_name: "ゲーム",
		category: "Any%",
		...overrides,
	};
}
export function schedule(
	overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
	return {
		id: "schedule-1",
		start_time: "2026/9/16 10:00",
		game_name: "ゲーム",
		release_year: "2020",
		category: "Any%",
		estimate: "1:00:00",
		players: "走者",
		commentators: "",
		...overrides,
	};
}
export function editData(overrides: Partial<EditData> = {}): EditData {
	return {
		players: [person()],
		commentators: [],
		schedules: [schedule()],
		...overrides,
	};
}
export function sheetValues(data = editData()): SheetValues {
	return {
		players: [
			[...personFields],
			...data.players.map((row) => personFields.map((key) => row[key])),
		],
		commentators: [
			[...personFields],
			...data.commentators.map((row) => personFields.map((key) => row[key])),
		],
		schedules: [
			[...scheduleFields],
			...data.schedules.map((row) => scheduleFields.map((key) => row[key])),
		],
	};
}
export {emptyData};
