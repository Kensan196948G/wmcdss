# pre-fix フィクスチャ（テスト専用・本番使用禁止）

このディレクトリには **F-2 修正前** の `scripts/wmcdss-*.sh` の凍結スナップショットを置いています。
目的は 1 つだけです — `scripts/tests/test-backup-restore-safety.sh` が

> 「空 gzip」「壊れた gzip」「サイズ下限未満」のバックアップが **修正前は成功扱いされていた**

ことを **実行時に** 証明し、修正の必要性をテストとして固定すること。

## 絶対に本番・運用で使わないこと

修正前の実装は次の無言の失敗を持ちます（db-verifier が task-3 で実測）。

| 症状 | 結果 |
| --- | --- |
| `pg_dump` が失敗 | `gzip > 最終名` のリダイレクトで **20 バイトの「有効な空 gzip」が最終名で残る** |
| 空 gzip を `restore` に渡す | `gzip -t` を PASS し、空入力を `psql` に流して **EXIT=0**。`restore done` と表示しつつ何も復元しない |
| サイズ不足の有効な gzip を渡す | 同上（サイズ下限の検証が無いため） |
| 壊れたバックアップを置く | `healthcheck` は **mtime しか見ない**ため `ALL OK` |

## フィクスチャの由来（忠実性）

`scripts/` 配下の実ファイルと同一コミット（`bd9628d30d501020726587a1b4116d07aa46a1c7`）から複製し、
**シェバン直後に上記の警告コメント 6 行を挿入しただけ**です（実行されるコードは 1 行も変えていません）。
複製時点の SHA-256:

| ファイル | sha256 (複製元 = HEAD 版) |
| --- | --- |
| `wmcdss-db-backup.sh` | `75861ec7d31fe93db0efd4920ad10ac8a66825392d102fbb20b74fc918c48a0a` |
| `wmcdss-db-restore.sh` | `66bdf32dadf0ed7eefd747beaf11dc1e62468dabf4bd621130810975599fd834` |
| `wmcdss-healthcheck.sh` | `24e82860e2addd95301793c17a22966977142f547e8beb00c21f68f014ae684a` |

（`git show HEAD:scripts/<file> | sha256sum` で照合できます。ヘッダ挿入後の差分は
`diff <(git show HEAD:scripts/<file>) <fixture>` でコメント 6 行のみ。）

## 実行方法

直接実行しないでください。テストから呼びます。

```bash
bash scripts/tests/test-backup-restore-safety.sh
```

実行可能ビットは意図的に付けていません（誤って `./` 実行されるのを避けるため）。
