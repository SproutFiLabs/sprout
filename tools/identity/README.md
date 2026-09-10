# Sprout repository identity guard kit

Run `./setup.sh` from each repository to set a local-only identity and install hooks. The configured author and committer identity is **Sprout Contributors <contributors@sprout.invalid>**. `.invalid` is a reserved, non-deliverable domain and is not intended to bind a personal mailbox or GitHub account.

The setup writes repository-local Git settings and places hooks in that repository's Git metadata; it does not change global Git configuration. The pre-commit hook checks Git's effective author and committer identities, including environment overrides, and blocks a commit on mismatch. The pre-push hook examines every commit reachable from each ref being pushed, including imported history, and rejects any commit whose author or committer differs. It also rejects malformed or non-project `Co-authored-by` and `Signed-off-by` trailers. Annotated tag pushes are blocked because tagger metadata adds another identity; lightweight tags are checked through their reachable commit history. Checks fail closed if Git cannot enumerate history.

Run `./tests/test_guard.sh` to exercise setup, wrong author and committer environment overrides, a valid commit, a personal identity trailer, and imported history in disposable repositories. Python 3 is required by the hooks.

This protects commit metadata from accidental personal identity leakage; it does not make contributors anonymous. GitHub still exposes the account performing a push and actors participating in pull requests. Preserve third-party copyright and license credits when importing code; these hooks do not remove or rewrite attribution.

For CI, run a metadata-only check on the proposed commit range or repository history using the same policy. CI cannot enforce the account used to push, and it must not publish artifacts or deploy as part of this identity check.
