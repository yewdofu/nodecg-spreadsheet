import type {
	SelectRequest,
	SpreadsheetData,
	SyncStatus,
} from "../shared/spreadsheet";
import type {Configschema} from "../types/generated/configschema";
import {
	parseSheets,
	reconcileSchedules,
	type SheetValues,
	validateData,
} from "./data";
import {InputError, publicError} from "./errors";

interface ControllerOptions {
	config: Configschema;
	readSheets: () => Promise<SheetValues>;
	getData: () => SpreadsheetData;
	setData: (data: SpreadsheetData) => void;
	setStatus: (status: SyncStatus) => void;
}

export class SpreadsheetController {
	private readonly options: ControllerOptions;
	private active: Promise<void> | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private status: SyncStatus;

	constructor(options: ControllerOptions) {
		this.options = options;
		this.status = {
			syncing: false,
			lastAttemptAt: null,
			lastSuccessAt: null,
			error: null,
			autoSyncEnabled: options.config.autoSync.enabled,
			intervalSeconds: options.config.autoSync.intervalSeconds,
			timeZone: options.config.timeZone,
		};
		options.setStatus({...this.status});
	}

	sync(): Promise<void> {
		if (this.active) return this.active;
		if (this.stopped)
			return Promise.reject(new InputError("同期処理は停止しています。"));
		clearTimeout(this.timer);
		this.status = {
			...this.status,
			syncing: true,
			lastAttemptAt: new Date().toISOString(),
			error: null,
		};
		this.options.setStatus({...this.status});
		this.active = Promise.resolve().then(async () => {
			try {
				const sheets = await this.options.readSheets();
				if (this.stopped) return;
				const next = validateData(
					parseSheets(sheets),
					this.options.config.timeZone,
				);
				const previous = this.options.getData();
				next.schedules = reconcileSchedules(next.schedules, previous.schedules);
				const updatedAt = new Date().toISOString();
				this.options.setData({
					...next,
					revision: previous.revision + 1,
					updatedAt,
					source: "sheet",
					selectedScheduleId: next.schedules.some(
						(schedule) => schedule.id === previous.selectedScheduleId,
					)
						? previous.selectedScheduleId
						: null,
				});
				this.status.lastSuccessAt = updatedAt;
			} catch (error) {
				this.status.error = publicError(error);
				throw new InputError(this.status.error);
			} finally {
				this.active = undefined;
				this.status.syncing = false;
				this.options.setStatus({...this.status});
				if (!this.stopped && this.options.config.autoSync.enabled) {
					this.timer = setTimeout(() => {
						void this.sync().catch(() => {});
					}, this.options.config.autoSync.intervalSeconds * 1000);
					this.timer.unref();
				}
			}
		});
		return this.active;
	}

	private checkRevision(request: unknown): SpreadsheetData {
		if (this.active)
			throw new InputError("同期中です。完了後に操作してください。");
		const current = this.options.getData();
		if (
			typeof request !== "object" ||
			request === null ||
			!("revision" in request) ||
			request.revision !== current.revision
		) {
			throw new InputError(
				"データが更新されています。最新データで開き直してください。",
			);
		}
		return current;
	}

	save(request: unknown): void {
		const previous = this.checkRevision(request);
		const next = validateData(request, this.options.config.timeZone);
		this.options.setData({
			...next,
			revision: previous.revision + 1,
			updatedAt: new Date().toISOString(),
			source: "dashboard",
			selectedScheduleId: next.schedules.some(
				(schedule) => schedule.id === previous.selectedScheduleId,
			)
				? previous.selectedScheduleId
				: null,
		});
	}

	select(request: SelectRequest): void {
		const previous = this.checkRevision(request);
		if (
			request.id !== null &&
			!previous.schedules.some((schedule) => schedule.id === request.id)
		)
			throw new InputError("指定されたスケジュールは存在しません。");
		this.options.setData({
			...previous,
			revision: previous.revision + 1,
			selectedScheduleId: request.id,
		});
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.timer);
	}
}
