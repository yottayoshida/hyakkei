# ギャラリー公開データ

ギャラリーの3サンプルは、実行時に外部サイトから取得しません。e-Stat の公式表を取得時点で固定し、必要な列・地域だけを UTF-8 CSV に正規化して同梱しています。各 CSV の SHA-256、表番号、公開日時、取得日、変換規則は `packages/core/src/golden-fixtures/data/provenance.json` に記録しています。

| サンプル | e-Stat 表 | 用途 | 同梱スナップショット |
| --- | --- | --- | --- |
| applications | [0000010201 Ａ 人口・世帯](https://www.e-stat.go.jp/dbview?sid=0000010201) | 都道府県別人口 | `applications.csv` |
| budget | [0000010203 Ｃ 経済基盤](https://www.e-stat.go.jp/dbview?sid=0000010203) | 産業構成・土地生産性 | `budget.csv` |
| regional | [0000010204 Ｄ 行政基盤](https://www.e-stat.go.jp/dbview?sid=0000010204) | 財政指標・人口1人当たり歳出 | `regional.csv` |

画面表示値の単位・指標コードを CSV ヘッダーへ残し、桁区切りを除いて数値として扱える形にしています。未取得の値を補間したり、ランキング用に並べ替えたりしていません。ダッシュボードの `sources[].ref.name` は同梱ファイル名を指し、アプリの実行時ネットワーク要求は発生しません。

データを更新する場合は、公式表の公開日時と調査年を確認して CSV を置き換え、`provenance.json` の取得日・ハッシュ・変換内容を同じ変更で更新してください。`pnpm --filter @hyakkei/core test` の provenance テストが、記録されたハッシュと実ファイルの不一致を検出します。
