# Guardian implementation review

Scope: SproutGuardian, GuardianWebAuthn, the generated deploy/runtime artifact, frontend passkey conversion, account/session lifecycle, creation and beneficiary integration. Existing vault economics and auth APIs remain unchanged.

Assets: beneficiary assets; owner authority; guardian quorum; passkey authority; signed transaction intent. Boundaries: untrusted gas submitter, browser-to-authenticator, arbitrary RPC response, malicious token or destination, former owner/device after recovery, and a compromised subset of guardians.

Review checks:
- No unrestricted call/approval route exists that bypasses transfer policy. Vault pulls force receipt into Guardian. Existing SproutVault enforces allowance and graduation permission; direct calls to it still require Guardian as msg.sender.
- P256 public key validation and signature verification use the existing pinned OZ library. DER parsing rejects negative/noncanonical/out-of-range values and normalizes high-S. On-chain substring comparisons are bounded before memory indexing; the signed authenticator flags, RP-ID and origin are validated.
- Replay is bound to chain, address, epoch and nonce; nonces only advance atomically with successful execution. Changing calldata, another wallet, another chain, expiry and credential revocation are tested rejection cases.
- External value transfers and sprout pulls are reentrancy guarded. Queue closed state and instant spend are updated before value transfer, and revert atomically on failure.
- Recovery approvals are keyed by request ID and distinct current guardians. Queue cancellation, expiration, clock boundaries, threshold freeze, policy veto and post-recovery authority invalidation are tested.
- Frontend deployment code is generated from the tested Solidity artifacts, and unrelated runtime bytecode is rejected before displaying wallet protection state. Chain/account changes clear signing context; unsigned UI state grants no access. Contract checks remain authoritative if a stale browser is used.

Known design tradeoffs, not hidden guarantees: public social graph; guardian veto/owner cancellation denial-of-service; colluding quorum; gas availability; domain-bound passkeys; token issuer controls; no notification delivery; finite enrollment count; fixed-window budget; explicit unbounded-after-delay transfer path. See README.md.

This is an implementation review with automated tests and a real local-chain smoke run. It is NOT an independent security audit. No production wallet or funds are created or moved by release deployment.

Validation on release: 74 contract tests (including 26 Guardian tests), 91 web tests, 128 server tests; full TypeScript check and production web build pass. A local Anvil smoke exercised signed P-256 spending, budget rejections, queued transfers, quorum freeze and delayed recovery. A read-only Robinhood mainnet check returned 1 for a valid P-256 signature and empty for an invalid signature, and eth_call creation returned the expected runtime. This does not replace physical authenticator/browser compatibility testing, which remains unverified in this environment.
