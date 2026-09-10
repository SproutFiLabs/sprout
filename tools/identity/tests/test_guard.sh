#!/bin/sh
set -eu
KIT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_blocked() {
  if "$@" >"$TMP/out" 2>&1; then fail "expected command to be blocked"; fi
}

mkdir "$TMP/repo"
git -C "$TMP/repo" init -q
(cd "$TMP/repo" && "$KIT/setup.sh") >/dev/null
git -C "$TMP/repo" config --local --get user.name | grep -qx 'Sprout Contributors' || fail "local name missing"
git -C "$TMP/repo" config --local --get user.email | grep -qx 'contributors@sprout.invalid' || fail "local email missing"
git -C "$TMP/repo" config --local --bool --get user.useConfigOnly | grep -qx true || fail "useConfigOnly missing"

cd "$TMP/repo"
printf 'first\n' > file
git add file
expect_blocked env GIT_AUTHOR_NAME='Personal Name' git commit -qm 'bad author'
expect_blocked env GIT_COMMITTER_EMAIL='personal@example.com' git commit -qm 'bad committer'
git commit -qm 'valid identity'

prepush="$TMP/repo/.git/sprout-identity-hooks/pre-push"
identity_guard="$TMP/repo/.git/sprout-identity-hooks/identity_guard.py"
oid=$(git rev-parse HEAD)
printf 'refs/heads/main %s refs/heads/main 0000000000000000000000000000000000000000\n' "$oid" | "$prepush" origin https://invalid
git tag lightweight-allowed HEAD
printf 'refs/tags/lightweight-allowed %s refs/tags/lightweight-allowed 0000000000000000000000000000000000000000\n' "$(git rev-parse lightweight-allowed)" | "$prepush" origin https://invalid
git -c user.name='Personal Name' -c user.email='personal@example.com' tag -a annotated-blocked -m 'release'
tag_oid=$(git rev-parse annotated-blocked)
expect_blocked sh -c 'printf "refs/tags/annotated-blocked %s refs/tags/annotated-blocked 0000000000000000000000000000000000000000\\n" "$1" | "$2" push' sh "$tag_oid" "$identity_guard"

# A project-authored commit with another identity in a trailer must be rejected.
git -c user.name='Sprout Contributors' -c user.email='contributors@sprout.invalid' commit --allow-empty -m 'trailer check' -m 'Co-authored-by: Personal Name <personal@example.com>'
oid=$(git rev-parse HEAD)
expect_blocked sh -c 'printf "refs/heads/main %s refs/heads/main 0000000000000000000000000000000000000000\\n" "$1" | python3 "$2" push' sh "$oid" "$identity_guard"

# Imported history bypasses local hooks; pre-push must still reject it.
mkdir "$TMP/history"
git -C "$TMP/history" init -q
git -C "$TMP/history" config user.name 'Personal Name'
git -C "$TMP/history" config user.email 'personal@example.com'
printf 'history\n' > "$TMP/history/file"
git -C "$TMP/history" add file
git -C "$TMP/history" -c core.hooksPath=/dev/null commit -qm 'imported history'
oid=$(git -C "$TMP/history" rev-parse HEAD)
expect_blocked sh -c 'printf "origin refs/heads/main %s 0000000000000000000000000000000000000000\\n" "$1" | python3 "$2" push' sh "$oid" "$identity_guard"

echo 'Identity guard tests passed.'
