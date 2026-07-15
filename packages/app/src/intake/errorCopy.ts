import type { DataSourceErrorKind, NetworkBlockedReason } from "@hyakkei/core/datasource";

export type ErrorFamily = "content" | "size" | "acquisition";
export type ErrorTone = "error" | "info";

export type ErrorCopy = {
  family: ErrorFamily;
  tone: ErrorTone;
  title: string;
  detail: string;
};

const NETWORK_BLOCKED_COPY: Record<NetworkBlockedReason, ErrorCopy> = {
  "third-party": {
    family: "acquisition",
    tone: "error",
    title: "このURLは読み込めません",
    detail:
      "同じサイト内のデータのみ読み込めます。ブラウザで元のページを開いてファイルをダウンロードし、ドラッグ&ドロップしてください。",
  },
  "http-editor": {
    family: "acquisition",
    tone: "error",
    title: "このページの接続方式では読み込めません",
    detail: "保護された接続（https）で開き直してから、もう一度お試しください。",
  },
  credentials: {
    family: "acquisition",
    tone: "error",
    title: "このURLは読み込めません",
    detail: "URLにユーザー名やパスワードを含めることはできません。URLを確認してください。",
  },
  scheme: {
    family: "acquisition",
    tone: "error",
    title: "このURLは読み込めません",
    detail: "httpsで始まるURLのみ読み込めます。URLを確認してください。",
  },
  "fetch-failed": {
    family: "acquisition",
    tone: "error",
    title: "データを取得できませんでした",
    detail: "URLを確認するか、時間をおいて再度お試しください。",
  },
};

const FALLBACK_NETWORK_BLOCKED: ErrorCopy = {
  family: "acquisition",
  tone: "error",
  title: "このURLは読み込めません",
  detail: "URLを確認して、もう一度お試しください。",
};

const GENERIC_FALLBACK: ErrorCopy = {
  family: "content",
  tone: "error",
  title: "読み込めませんでした",
  detail: "もう一度お試しください。解決しない場合は別の形式でお試しください。",
};

/**
 * D10: "10種kind全てに3層文言 + exhaustive defaultテスト（leaf一時追加で
 * 空白にならない）" / "技術語（encoding/BOM/CORS/origin）ユーザー可視露出0".
 * Every branch below is written to never mention DuckDB, zip, HTML, BOM,
 * origin, or CORS — the underlying mechanism, not the user-facing story.
 *
 * `default` covers a `DataSourceErrorKind` this function's own switch does
 * not (yet) recognize — `types.ts`'s own comment on the union promises
 * "later PRs only ever add a leaf, never reshape", so this branch is a
 * real, reachable safety net for exactly that future addition, not just a
 * TypeScript exhaustiveness formality: without it, a not-yet-updated copy
 * of this file would render a blank error panel instead of a generic,
 * still-actionable message.
 */
export function describeError(
  kind: DataSourceErrorKind,
  reason: NetworkBlockedReason | undefined,
): ErrorCopy {
  switch (kind) {
    case "unsupported-format":
      return {
        family: "content",
        tone: "error",
        title: "対応していない形式です",
        detail: "CSV・Excel(.xlsx)・Parquet形式のファイルでお試しください。",
      };
    case "corrupt":
      return {
        family: "content",
        tone: "error",
        title: "内容を読み取れませんでした",
        detail: "ファイルが壊れているか、対応していない構成になっている可能性があります。",
      };
    case "empty":
      // Info tone, deliberately (D10: "emptyはinfoトーン（error色にしない、
      // 「0件」と「失敗」の分離）") — nothing went wrong, the source just
      // has no rows to show.
      return {
        family: "content",
        tone: "info",
        title: "データが空でした",
        detail: "中身が入ったファイルを選択するか、URLを確認してください。",
      };
    case "non-csv-response":
      return {
        family: "acquisition",
        tone: "error",
        title: "期待したデータが返ってきませんでした",
        detail:
          "ログインが必要なページや、別の内容が表示されている可能性があります。URLを確認してください。",
      };
    case "encoding":
      return {
        family: "content",
        tone: "error",
        title: "文字を正しく読み取れませんでした",
        detail: "別の形式で保存し直してから、もう一度お試しください。",
      };
    case "too-large":
      return {
        family: "size",
        tone: "error",
        title: "サイズが大きすぎます",
        detail: "ファイルを分割するか、より小さいデータでお試しください。",
      };
    case "oom":
      // The trust-anchor line ("パソコンには保存されていません") is
      // mandatory here per D10 and must survive future copy edits — this
      // is the one message shown at the exact moment a user's mental model
      // of "did my data just get uploaded somewhere" is most in question.
      return {
        family: "size",
        tone: "error",
        title: "データ量が多すぎます",
        detail:
          "お使いのブラウザで処理しきれませんでした。ファイルを分割するか、行数を減らしてお試しください。パソコンには保存されていません。",
      };
    case "network-blocked":
      return reason
        ? (NETWORK_BLOCKED_COPY[reason] ?? FALLBACK_NETWORK_BLOCKED)
        : FALLBACK_NETWORK_BLOCKED;
    case "network-notfound":
      return {
        family: "acquisition",
        tone: "error",
        title: "データが見つかりませんでした",
        detail: "URLが正しいかご確認ください。",
      };
    case "aborted":
      // Only reachable from a real `EgressPolicy` timeout (30s) today —
      // never from the UI's own cancel button, which is a client-side
      // `RESET`/`CANCEL` dispatch that bypasses `DataSourceError`
      // entirely (types.ts). The two are deliberately different code
      // paths so this copy can stay specific to "the system gave up"
      // without also having to cover "the user gave up" (that copy lives
      // in `intakeReducer`'s `CANCEL` branch instead).
      return {
        family: "acquisition",
        tone: "error",
        title: "時間がかかりすぎたため中断しました",
        detail: "ネットワークの状態を確認するか、ファイルをダウンロードしてお試しください。",
      };
    default:
      return GENERIC_FALLBACK;
  }
}
