import type {
	Person,
	Schedule,
	SpreadsheetData,
} from "../types/generated/spreadsheetData";

export type {SyncStatus} from "../types/generated/syncStatus";
export type {Person, Schedule, SpreadsheetData};

export const personFields = [
	"name",
	"twitch_id",
	"twitter_id",
	"youtube_id",
	"game_name",
	"category",
] as const;
export const scheduleFields = [
	"start_time",
	"game_name",
	"release_year",
	"category",
	"estimate",
	"players",
	"commentators",
] as const;
export const tableNames = {
	players: "プレイヤー一覧",
	commentators: "解説者一覧",
	schedules: "スケジュール",
} as const;
export type TableName = keyof typeof tableNames;
export type PersonInput = Record<(typeof personFields)[number], string> & {
	id: string;
};
export type ScheduleInput = Record<(typeof scheduleFields)[number], string> & {
	id: string;
};
export interface EditData {
	players: PersonInput[];
	commentators: PersonInput[];
	schedules: ScheduleInput[];
}
export interface SaveRequest extends EditData {
	revision: number;
}
export interface SelectRequest {
	revision: number;
	id: string | null;
}

export function createRowId(): string {
	return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
		value.toString(16).padStart(8, "0"),
	).join("");
}

export function emptyData(): SpreadsheetData {
	return {
		revision: 0,
		updatedAt: null,
		source: null,
		players: [],
		commentators: [],
		schedules: [],
		selectedScheduleId: null,
	};
}

export function toEditData(data: SpreadsheetData): EditData {
	return {
		players: data.players.map((person) => ({...person})),
		commentators: data.commentators.map((person) => ({...person})),
		schedules: data.schedules.map((schedule) => ({
			id: schedule.id,
			start_time: schedule.start_time,
			game_name: schedule.game_name,
			release_year: schedule.release_year,
			category: schedule.category,
			estimate: schedule.estimate,
			players: schedule.players.join(", "),
			commentators: schedule.commentators.join(", "),
		})),
	};
}
