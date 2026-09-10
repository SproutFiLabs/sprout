#!/usr/bin/env python3
"""Fail-closed Git identity checks for commit and push hooks."""
import re
import subprocess
import sys

NAME = "Sprout Contributors"
EMAIL = "contributors@sprout.invalid"


def run(args, *, input_text=None):
    return subprocess.run(args, input=input_text, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, check=True).stdout


def ident_is_allowed(var):
    try:
        ident = run(["git", "var", var]).strip()
    except (subprocess.CalledProcessError, OSError):
        return False
    match = re.fullmatch(r"(.*) <([^<>\n]+)> \d+ [+-]\d{4}", ident)
    return bool(match and match.group(1) == NAME and match.group(2) == EMAIL)


def commit_check():
    if not all(ident_is_allowed(v) for v in ("GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT")):
        print("Identity guard: commit blocked; effective author or committer is not the configured project identity.", file=sys.stderr)
        return 1
    return 0


TRAILER = re.compile(r"^(Co-authored-by|Signed-off-by):\s*(.*?)\s*<([^<>\s]+)>\s*$", re.I)


def check_commit(oid):
    try:
        fields = run(["git", "show", "-s", "--format=%an%x00%ae%x00%cn%x00%ce%x00%B", oid]).split("\0", 4)
    except (subprocess.CalledProcessError, OSError):
        return False
    if len(fields) != 5:
        return False
    an, ae, cn, ce, body = fields
    if (an, ae, cn, ce) != (NAME, EMAIL, NAME, EMAIL):
        return False
    for line in body.splitlines():
        if line.lower().startswith(("co-authored-by:", "signed-off-by:")):
            match = TRAILER.fullmatch(line)
            if not match or (match.group(2), match.group(3)) != (NAME, EMAIL):
                return False
    return True


def push_check():
    try:
        refs = sys.stdin.read().splitlines()
        oids = set()
        for ref in refs:
            parts = ref.split()
            if len(parts) != 4:
                print("Identity guard: push blocked; could not parse pushed refs.", file=sys.stderr)
                return 1
            local_oid = parts[1]
            if set(local_oid) == {"0"}:
                continue
            if parts[0].startswith("refs/tags/"):
                try:
                    object_type = run(["git", "cat-file", "-t", local_oid]).strip()
                except (subprocess.CalledProcessError, OSError):
                    print("Identity guard: push blocked; tag object could not be checked.", file=sys.stderr)
                    return 1
                if object_type == "tag":
                    print("Identity guard: push blocked; annotated tags are not allowed (use a lightweight tag).", file=sys.stderr)
                    return 1
            for oid in run(["git", "rev-list", local_oid]).splitlines():
                oids.add(oid)
        for oid in oids:
            if not check_commit(oid):
                print("Identity guard: push blocked; reachable history contains a non-project identity or disallowed identity trailer.", file=sys.stderr)
                return 1
    except (subprocess.CalledProcessError, OSError):
        print("Identity guard: push blocked; history could not be fully checked.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"commit", "push"}:
        sys.exit(2)
    sys.exit(commit_check() if sys.argv[1] == "commit" else push_check())
