import {useEffect, useState} from "react";
import {snapshotReplicant} from "../../../shared/replicant";
import {
	createRowId,
	type EditData,
	personFields,
	type SaveRequest,
	type SpreadsheetData,
	type SyncStatus,
	scheduleFields,
	type TableName,
	tableNames,
	toEditData,
} from "../../../shared/spreadsheet";
import {render} from "../../render";
import "../spreadsheet.css";

const dataRep = nodecg.Replicant<SpreadsheetData>("spreadsheetData");
const statusRep = nodecg.Replicant<SyncStatus>("syncStatus");

function Spreadsheet() {
	const [data, setData] = useState<SpreadsheetData>();
	const [status, setStatus] = useState<SyncStatus>();
	const [tab, setTab] = useState<TableName>("schedules");
	const [draft, setDraft] = useState<EditData>();
	const [revision, setRevision] = useState(0);
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	useEffect(() => {
		const updateData = (value: SpreadsheetData | undefined) => {
			if (value) setData(snapshotReplicant(value));
		};
		const updateStatus = (value: SyncStatus | undefined) => {
			if (value) setStatus(snapshotReplicant(value));
		};
		dataRep.on("change", updateData);
		statusRep.on("change", updateStatus);
		if (dataRep.status === "declared") updateData(dataRep.value);
		if (statusRep.status === "declared") updateStatus(statusRep.value);
		return () => {
			dataRep.removeListener("change", updateData);
			statusRep.removeListener("change", updateStatus);
		};
	}, []);
	const busy = pending || !!status?.syncing;
	const stale = !!draft && revision !== data?.revision;
	const selected = data?.schedules.find(
		(schedule) => schedule.id === data.selectedScheduleId,
	);
	const fields = tab === "schedules" ? scheduleFields : personFields;
	const rows = draft?.[tab] ?? (data ? toEditData(data)[tab] : []);

	async function send(
		name: string,
		payload: unknown,
		success: string,
	): Promise<boolean> {
		setPending(true);
		setError("");
		setMessage("");
		try {
			await nodecg.sendMessage(name, payload);
			setMessage(success);
			return true;
		} catch (reason) {
			setError(
				typeof reason === "string"
					? reason
					: "操作に失敗しました。接続状態を確認してください。",
			);
			return false;
		} finally {
			setPending(false);
		}
	}
	function edit() {
		if (!data) return;
		setDraft(toEditData(data));
		setRevision(data.revision);
		setError("");
		setMessage("");
	}
	function update(id: string, field: string, value: string) {
		setDraft((previous) =>
			previous
				? {
						...previous,
						[tab]: previous[tab].map((row) =>
							row.id === id ? {...row, [field]: value} : row,
						),
					}
				: previous,
		);
	}
	function add() {
		const row = {
			id: createRowId(),
			...Object.fromEntries(fields.map((field) => [field, ""])),
		};
		setDraft((previous) =>
			previous
				? ({...previous, [tab]: [...previous[tab], row]} as EditData)
				: previous,
		);
	}
	async function save() {
		if (
			draft &&
			(await send(
				"saveSpreadsheet",
				{...draft, revision} satisfies SaveRequest,
				"編集内容を保存しました。",
			))
		)
			setDraft(undefined);
	}
	const formatTime = (value: string | null | undefined) =>
		value
			? new Intl.DateTimeFormat("ja", {
					dateStyle: "short",
					timeStyle: "medium",
					timeZone: status?.timeZone || "Asia/Tokyo",
				}).format(new Date(value))
			: "未実行";

	return (
		<main>
			<header>
				<h1>スプレッドシート連携</h1>
				<button
					type='button'
					className='primary'
					disabled={busy || !!draft}
					onClick={() => {
						void send("syncSpreadsheet", null, "シートと同期しました。");
					}}
				>
					{status?.syncing ? "同期中…" : "シートから同期"}
				</button>
			</header>
			<section
				className='status'
				aria-live='polite'
			>
				<span>最終同期: {formatTime(status?.lastSuccessAt)}</span>
				<span>
					自動同期:{" "}
					{status?.autoSyncEnabled ? `${status.intervalSeconds}秒間隔` : "無効"}
				</span>
				<span>タイムゾーン: {status?.timeZone || "—"}</span>
				<span>
					データ:{" "}
					{data?.source === "dashboard"
						? "Dashboardで編集済み"
						: data?.source === "sheet"
							? "シートから取得"
							: "未取得"}
				</span>
			</section>
			<p className='notice'>
				編集内容は、次回の手動・自動同期でシートの内容に上書きされます。
			</p>
			{(error || status?.error) && (
				<p
					className='error'
					role='alert'
				>
					{error || status?.error}
				</p>
			)}
			{message && (
				<p
					className='success'
					role='status'
				>
					{message}
				</p>
			)}
			<section className='selection'>
				<div>
					<small>選択中のスケジュール</small>
					<strong>
						{selected
							? `${selected.game_name}${selected.category ? ` / ${selected.category}` : ""}`
							: "未選択"}
					</strong>
					{selected && (
						<span>
							{selected.start_time || "開始日時未定"} ·{" "}
							{selected.players.join(", ") || "プレイヤー未指定"}
						</span>
					)}
				</div>
				<button
					type='button'
					disabled={busy || !!draft || !selected}
					onClick={() => {
						if (data)
							void send(
								"selectSchedule",
								{revision: data.revision, id: null},
								"選択を解除しました。",
							);
					}}
				>
					選択解除
				</button>
			</section>
			<nav aria-label='データの種類'>
				{(Object.keys(tableNames) as TableName[]).map((name) => (
					<button
						type='button'
						key={name}
						aria-pressed={tab === name}
						onClick={() => setTab(name)}
					>
						{tableNames[name]}{" "}
						<span>{(draft ?? data)?.[name].length ?? 0}</span>
					</button>
				))}
			</nav>
			<div className='toolbar'>
				<h2>{tableNames[tab]}</h2>
				<div>
					{draft ? (
						<>
							<button
								type='button'
								disabled={busy}
								onClick={add}
							>
								行を追加
							</button>
							<button
								type='button'
								disabled={pending}
								onClick={() => {
									setDraft(undefined);
									setError("");
								}}
							>
								編集を破棄
							</button>
							<button
								type='button'
								className='primary'
								disabled={busy || stale}
								onClick={() => {
									void save();
								}}
							>
								すべての編集を保存
							</button>
						</>
					) : (
						<button
							type='button'
							disabled={busy || !data || !status?.timeZone}
							onClick={edit}
						>
							編集する
						</button>
					)}
				</div>
			</div>
			{draft && (
				<p className='notice'>
					タブを切り替えて3種類のデータをまとめて編集できます。日時は YYYY-MM-DD
					HH:mm:ss、複数人はカンマ区切りで入力してください。
				</p>
			)}
			{stale && (
				<p
					className='error'
					role='alert'
				>
					同期または別の操作でデータが更新されました。下書きの内容を確認してから開き直してください。{" "}
					<button
						type='button'
						disabled={busy}
						onClick={edit}
					>
						最新データで開き直す
					</button>
				</p>
			)}
			{!data ? (
				<p>データを読み込み中…</p>
			) : (
				<div className='table-scroll'>
					<table>
						<thead>
							<tr>
								<th scope='col'>
									{draft ? "操作" : tab === "schedules" ? "選択" : "#"}
								</th>
								{fields.map((field) => (
									<th
										scope='col'
										key={field}
									>
										{field}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, index) => (
								<tr
									key={row.id}
									className={
										row.id === data.selectedScheduleId ? "selected" : ""
									}
								>
									<td>
										{draft ? (
											<button
												type='button'
												disabled={busy}
												onClick={() =>
													setDraft((previous) =>
														previous
															? {
																	...previous,
																	[tab]: previous[tab].filter(
																		(candidate) => candidate.id !== row.id,
																	),
																}
															: previous,
													)
												}
											>
												削除
											</button>
										) : tab === "schedules" ? (
											<button
												type='button'
												disabled={busy || row.id === data.selectedScheduleId}
												onClick={() => {
													void send(
														"selectSchedule",
														{revision: data.revision, id: row.id},
														"スケジュールを選択しました。",
													);
												}}
											>
												{row.id === data.selectedScheduleId ? "選択中" : "選択"}
											</button>
										) : (
											index + 1
										)}
									</td>
									{fields.map((field) => (
										<td key={field}>
											{draft ? (
												<input
													aria-label={`${tableNames[tab]} ${index + 1}行目 ${field}`}
													value={(row as Record<string, string>)[field] ?? ""}
													disabled={busy}
													onChange={(event) =>
														update(row.id, field, event.target.value)
													}
												/>
											) : (
												(row as Record<string, string>)[field] || "—"
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					{rows.length === 0 && <p className='empty'>データがありません。</p>}
				</div>
			)}
		</main>
	);
}

render(<Spreadsheet />);
