#!/usr/bin/env bash
# Builds snapshot/gas.sqlite: the read-only seed the Vercel deploy copies to /tmp.
# Keeps aggregated tables in full and only the newest raw blocks per chain.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=${1:-data/gas.sqlite}
OUT=snapshot/gas.sqlite
rm -f "$OUT"
sqlite3 "$SRC" <<SQL
VACUUM INTO '$OUT';
SQL
sqlite3 "$OUT" <<'SQL'
DELETE FROM evm_blocks WHERE number < (SELECT MAX(number) - 300 FROM evm_blocks e WHERE e.chain = evm_blocks.chain);
VACUUM;
SQL
ls -lh "$OUT"
