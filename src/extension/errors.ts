export class InputError extends Error {}

export function publicError(error: unknown): string {
	return error instanceof InputError
		? error.message
		: "同期に失敗しました。接続設定、サービスアカウントの閲覧権限、通信状態を確認してください。";
}
