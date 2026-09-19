import {IANAZone} from "luxon";
import type {Configschema} from "../types/generated/configschema";
import {InputError} from "./errors";

export function readConfig(config: Partial<Configschema>): Configschema {
	const result: Configschema = {
		spreadsheetId: config.spreadsheetId?.trim() ?? "",
		serviceAccountKeyFile: config.serviceAccountKeyFile?.trim() ?? "",
		timeZone: config.timeZone ?? "Asia/Tokyo",
		sheets: {
			players: config.sheets?.players ?? "プレイヤー一覧",
			commentators: config.sheets?.commentators ?? "解説者一覧",
			schedules: config.sheets?.schedules ?? "スケジュール",
		},
		autoSync: {
			enabled: config.autoSync?.enabled ?? false,
			intervalSeconds: config.autoSync?.intervalSeconds ?? 60,
		},
	};
	if (!IANAZone.isValidZone(result.timeZone))
		throw new InputError(
			"timeZoneには有効なIANAタイムゾーンを設定してください。",
		);
	if (
		!Number.isInteger(result.autoSync.intervalSeconds) ||
		result.autoSync.intervalSeconds < 1 ||
		result.autoSync.intervalSeconds > 2147483
	) {
		throw new InputError(
			"autoSync.intervalSecondsには1〜2147483の整数を設定してください。",
		);
	}
	if (
		Object.values(result.sheets).some((name) => !name.trim()) ||
		new Set(Object.values(result.sheets)).size !== 3
	) {
		throw new InputError("sheetsには異なる3つのシート名を設定してください。");
	}
	return result;
}
