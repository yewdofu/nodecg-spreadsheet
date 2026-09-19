# nodecg-spreadsheet

Googleスプレッドシートからプレイヤー一覧・解説者一覧・スケジュールを取得するNodeCG Bundle。

## 起動

Node.js 24、pnpm 12.4.0を使用します。

```sh
pnpm install
pnpm build
pnpm start
```

開発時は`pnpm dev`、検証は`pnpm typecheck`と`pnpm test`を実行します。Schemaを変更した場合は`pnpm generate-schema-types`で型を再生成します。

## 接続設定

Google CloudでSheets APIを有効にし、サービスアカウントのJSONキーを用意してください。対象スプレッドシートをサービスアカウントのメールアドレスに閲覧者として共有します。認証には[Googleのサービスアカウント認証](https://developers.google.com/identity/protocols/oauth2/service-account)を使用します。

NodeCGの実行ディレクトリに`cfg/nodecg-spreadsheet.json`を作成します。

```json
{
  "spreadsheetId": "スプレッドシートのURL内のID",
  "serviceAccountKeyFile": "cfg/service-account.json",
  "timeZone": "Asia/Tokyo",
  "sheets": {
    "players": "プレイヤー一覧",
    "commentators": "解説者一覧",
    "schedules": "スケジュール"
  },
  "autoSync": {
    "enabled": false,
    "intervalSeconds": 60
  }
}
```

キーファイルのパスはNodeCGの実行ディレクトリからの相対パス、または絶対パスです。秘密鍵はbundleConfigに直接記入せず、配信される`shared`や`assets`には置かないでください。

接続先とキーファイルが未設定の場合はDashboardに設定エラーを表示します。その他の省略値は上記と同じです。同期間隔は1〜2147483秒の整数で、設定変更には再起動が必要です。

## シートの入力

同じスプレッドシート内に3つのタブを作成します。1行目に次の見出しを1つずつ指定してください。列順は任意で、追加列とデータ項目がすべて空の行は無視します。データが0件の場合も見出し行は必要です。

| タブ | 見出し |
| --- | --- |
| プレイヤー一覧・解説者一覧 | `name`, `twitch_id`, `twitter_id`, `youtube_id`, `game_name`, `category` |
| スケジュール | `start_time`, `game_name`, `release_year`, `category`, `estimate`, `players`, `commentators` |

- 人物の`name`とスケジュールの`game_name`は必須です。他の値は空欄を許容します。
- `start_time`は`2026-09-16 10:00:00`または`2026/9/16 10:00`など、日付と時刻で入力します。秒は省略できます。日付セルの場合も表示形式をこの形に設定してください。
- `start_time`は設定したタイムゾーンの現地日時です。オフセットの記入は不要です。存在しない日時、夏時間で重複する日時はエラーになります。
- `players`と`commentators`は名前を半角カンマで区切ります。前後の空白・空要素・重複名は除去します。人物名自体にはカンマを使用できません。
- 人物はまず名前で照合し、同名が複数あるときだけゲーム・カテゴリでも絞り込みます。一致が0件または複数件なら更新全体を拒否します。
- SNS ID、発売年、予定時間は表示用文字列として保持します。

Sheets APIの[batchGet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet)で表示済みの値を読み取ります。シートへの書き戻しは行いません。

## Dashboardの操作

- 「シートから同期」で3タブをまとめて更新します。起動時にも同期します。
- 自動同期は各同期の完了後から設定秒数を数えます。同時に届いた同期要求は1回の処理にまとめます。
- 「編集する」で各タブの値変更・行追加・削除を行い、「すべての編集を保存」で反映します。人物名を変える場合は参照するスケジュールも同時に編集してください。
- 同期中は保存・選択を停止します。同期や別のDashboard操作でデータが変わった場合は、下書きを残して競合を表示します。
- スケジュールは保存・同期時に開始日時順へ並べ替えます。空欄は末尾、同時刻と空欄同士は日本語のタイトル比較順、比較結果が同じ場合は元の順序です。
- 選択は単一で、解除できます。編集・選択・取得済みデータは再起動後も保持します。
- 同期に失敗した場合は既存データと選択を保持します。正常な空データは反映します。
- 再同期では内容全体、次にゲーム・カテゴリ・プレイヤーの組で一意に対応するスケジュールのIDを維持します。選択対象が消えた場合や特定できない場合は選択を解除します。

## 公開データ

Bundle名は`nodecg-spreadsheet`です。

| Replicant | 内容 |
| --- | --- |
| `spreadsheetData` | `players`, `commentators`, `schedules`, `selectedScheduleId`, `revision`, `updatedAt`, `source`。永続化されます |
| `syncStatus` | 同期中フラグ、直近の試行・成功日時、エラー、自動同期設定、タイムゾーン。起動ごとに初期化されます |

各人物とスケジュールに内部IDを付与します。スケジュールの`players`・`commentators`は名前の配列、`playerIds`・`commentatorIds`は各人物一覧への参照です。`start_time`は現地日時文字列、`startsAt`はオフセット付きISO日時（空欄の場合は`null`）です。

他Bundleからは`nodecg.Replicant("spreadsheetData", "nodecg-spreadsheet")`を購読します。選択対象は`selectedScheduleId`で`schedules`から取得します。共有データの更新には以下のメッセージを使用してください。

| メッセージ | 引数 |
| --- | --- |
| `syncSpreadsheet` | なし |
| `saveSpreadsheet` | `revision`と3種類の編集行配列。各行に`id`、スケジュールの人物欄はカンマ区切り文字列 |
| `selectSchedule` | `revision`と`id`（解除は`null`） |

詳細な型は`src/shared/spreadsheet.ts`と`src/types/generated/`を参照してください。
