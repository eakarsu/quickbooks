#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir=${RUNTIME_PROJECT_SOURCE:-$project_dir}
: "${PORT:?PORT is required; choose an unused port explicitly}"
DATABASE_PATH=${DATABASE_PATH:-${DB_PATH:-}}
export DATABASE_PATH
if [ -z "$DATABASE_PATH" ] || [ -z "${CORS_ORIGINS:-}" ]; then
  echo "DATABASE_PATH and CORS_ORIGINS are required" >&2
  exit 1
fi
jwt_secret=${JWT_SECRET:-}
if [ "${#jwt_secret}" -lt 32 ]; then
  echo "JWT_SECRET must be at least 32 characters" >&2
  exit 1
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use; no process was terminated" >&2
  exit 1
fi
if [ ! -f "$source_dir/client/dist/index.html" ]; then
  echo "client/dist is missing; build the release artifact before starting" >&2
  exit 1
fi

cd "$source_dir"
NODE_ENV=production
export NODE_ENV
node scripts/migrate.js --check
exec node server.js
