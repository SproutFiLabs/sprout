#!/bin/sh
# Production container entrypoint.
#
# Railway mounts the persistent volume at /data root-owned, so the non-root bun
# user cannot open the SQLite file until ownership is fixed. This runs as root
# only long enough to create/chown the designated data directory, then drops to
# the bun UID and execs the service. The Bun server itself never runs as root:
# the privilege drop is unconditional when started as UID 0, including when
# SPROUT_DB_PATH=:memory: (which needs no ownership repair).
#
# Only the directory holding the SQLite database is touched; /app is chowned to
# bun at image build time. Railway's startCommand overrides the image
# ENTRYPOINT/CMD, so railway.json points the start command back at this script.
set -eu

entrypoint_name="$(basename "$0")"

# Railway's start command may invoke this script explicitly; drop a leading
# self-reference so an entrypoint plus start command never recurse.
if [ "$#" -gt 0 ] && [ "$(basename "$1")" = "$entrypoint_name" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  set -- bun server/src/index.ts
fi

# The designated persistent data directory: the SQLite file's directory when a
# concrete path is configured, otherwise SPROUT_DATA_DIR, otherwise /data.
data_dir="${SPROUT_DATA_DIR:-/data}"
persistent=1
case "${SPROUT_DB_PATH:-}" in
  ':memory:') persistent=0 ;;
  '' ) : ;;
  *) data_dir="$(dirname "$SPROUT_DB_PATH")" ;;
esac

if [ "$(id -u)" = "0" ]; then
  # Only the persistent data directory needs repairing; :memory: has none.
  if [ "$persistent" = "1" ]; then
    mkdir -p "$data_dir"
    chown -R bun:bun "$data_dir"
    chmod u+rwx "$data_dir"
  fi
  # Privilege drop is unconditional when starting as root, including :memory:
  # so the service never runs as root.
  exec su -s /bin/sh bun -c 'exec "$0" "$@"' -- "$@"
fi

exec "$@"
