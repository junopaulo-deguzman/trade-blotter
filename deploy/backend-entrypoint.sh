#!/bin/sh
set -eu
# Encode credentials instead of interpolating an unescaped password into a URL.
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="$(node -e 'const e=process.env; for(const key of ["PGUSER","PGPASSWORD","PGDATABASE"]) if(!e[key]) throw new Error("Missing "+key); process.stdout.write(`postgres://${encodeURIComponent(e.PGUSER)}:${encodeURIComponent(e.PGPASSWORD)}@${e.PGHOST || "db"}:${e.PGPORT || "5432"}/${encodeURIComponent(e.PGDATABASE)}`)')"
fi
exec "$@"
