#!/bin/sh
set -eu

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Run this from inside the repository to configure." >&2
  exit 2
}
GIT_DIR=$(git -C "$ROOT" rev-parse --absolute-git-dir)
KIT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HOOK_DIR="$GIT_DIR/sprout-identity-hooks"

mkdir -p "$HOOK_DIR"
cp "$KIT_DIR/hooks/pre-commit" "$HOOK_DIR/pre-commit"
cp "$KIT_DIR/hooks/pre-push" "$HOOK_DIR/pre-push"
cp "$KIT_DIR/hooks/identity_guard.py" "$HOOK_DIR/identity_guard.py"
chmod 755 "$HOOK_DIR/pre-commit" "$HOOK_DIR/pre-push" "$HOOK_DIR/identity_guard.py"

git -C "$ROOT" config --local user.name "Sprout Contributors"
git -C "$ROOT" config --local user.email "contributors@sprout.invalid"
git -C "$ROOT" config --local user.useConfigOnly true
git -C "$ROOT" config --local core.hooksPath "$HOOK_DIR"

echo "Configured repository-local identity and fail-closed Git hooks."
echo "No global Git configuration changed."
