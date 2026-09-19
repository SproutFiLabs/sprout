# Private milestone proofs

A parent can prove that a Sprout-certified USD balance snapshot met a threshold without disclosing the exact balance, vault address, wallet or child’s name **in the proof**. Open **Family privacy → Zero-knowledge milestones**, choose a sprout and threshold, then create, share or download a proof. A recipient opens `/verify` and checks the PLONK proof locally plus the certificate’s live status with Sprout. No wallet connection is needed for verification.

## What is implemented

- Circom circuit with PLONK over BN254, Poseidon commitments, a browser Web Worker prover and verifier, and a generated Solidity verifier.
- Authenticated, parent-only balance certification. The server obtains the existing chain/pricing snapshot, rejects incomplete/unavailable prices, rounds USD down to cents and refuses a threshold above the snapshot.
- Fresh 248-bit random salt and 128-bit certificate scope for every issuance. No child name or address is an input to the circuit.
- Thirty-minute certificates, signed parent revocation and ten issuances per vault per thirty minutes, including revoked certificates. The final issuance cap is checked transactionally.
- Strict proof-file schema and size limit; proof links use a URL fragment that is removed before verification requests. Only the public certificate is submitted to the status endpoint.
- SHA-256 checks on browser proving assets and a build-time source/artifact manifest check. Dedicated workers terminate on completion, cancellation, unmount or timeout.
- Responsive receipt-style UI, actual proving stages, reduced-motion support and certificate refresh every fifteen seconds and on page visibility.

## Statement and trust boundary

The circuit accepts private `balance` (64 bits) and `salt` (248 bits), and public `commitment`, `threshold` (positive, 64 bits), and `scope` (128 bits). It constrains:

```
Poseidon(balance, salt, scope) == commitment
balance >= threshold
```

Explicit bit constraints prevent field-wrap and comparator-range attacks. Public signals are ordered `[commitment, thresholdCents, scope]` in JavaScript and Solidity. The certificate binds those values and the expiry to a server record.

**Sprout is the trusted balance issuer.** The circuit proves knowledge of the committed amount and the threshold comparison; it does not establish Ethereum state, price-feed truth, ownership or solvency by itself. The existing holdings reader uses a short cache, so certification is a recent snapshot, not a guarantee of the balance at proof viewing time. Valuation inherits configured price-feed and settlement-token USD assumptions. A malicious issuer can certify a false snapshot. This feature is not permission to transfer funds, an identity check or an authorization primitive.

The server sees the balance and salt during issuance, then stores only the certificate, vault association, timestamps and revocation flag in `zk_milestone_certificates`. It does not persist the witness in that table. The private witness is delivered once in the authenticated issuance response over the same HTTPS origin in production. Browser memory and worker termination are best-effort lifetime controls, not guaranteed cryptographic memory erasure. A compromised device, application bundle, RPC, issuer or delivery origin falls outside this proof’s privacy guarantee.

Recipients see the threshold, certificate timestamps, random ID and commitment. A copied proof remains transferable and repeated use of the same proof is linkable. Distinct certificates use fresh randomness, but timing, IP addresses and outside information can still correlate users. The issuer retains the family association until an expired row is removed during a subsequent issuance. Public status responses reveal only active/inactive and check time; holders must check mathematical validity **and** status. Revocation invalidates the online certificate, not the underlying mathematical proof or copies of information already shared.

Existing wallet balances, transfers and family contract relationships remain public on-chain. These proofs do not hide on-chain wealth or guarantee physical safety. They are selective disclosure, not a shielded wallet, mixer or private transfer protocol. No savings-contract authorization or custody behavior changes.

## Setup and provenance

The source is `circuits/milestone-v1/milestone.circom`. Dependencies are pinned: circom2 0.2.23 (Circom 2.2.2), circomlib 2.0.5, circomlibjs 0.1.7 and snarkjs 0.7.6. The circuit is compiled with `--O1`. PLONK uses the published universal `powersOfTau28_hez_final_12.ptau` transcript; no new single-party, per-circuit ceremony was generated.

The build pins the canonical BLAKE2b-512 transcript hash published by [iden3/snarkjs](https://github.com/iden3/snarkjs):

```
ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a
```

The canonical GCS and Hermez S3 endpoints returned HTTP 403 during development. The build therefore also supports an immutable GitHub mirror and verifies it against the same published hash before use. The checked-in manifest records this hash, circuit-source hash and artifact hashes. Hash matching establishes the downloaded transcript’s identity; it is not an independent audit of the ceremony. Full `powersoftau verify` was not completed during this implementation and can be requested with the optional build flag below.

The circuit, integration and generated Solidity verifier have **not been independently audited**. The Solidity verifier is included and tested but has not been deployed. It checks mathematics only and does not implement Sprout certificate status. Do not wire it into funds authorization without separate design, threat analysis and external cryptographic review.

See [Circom proving documentation](https://docs.circom.io/getting-started/proving-circuits/) and [circomlib comparator constraints](https://github.com/iden3/circomlib/blob/master/circuits/comparators.circom).

## Build and validation

Checked-in browser assets avoid downloading setup material at runtime. No new hosted service or paid subscription is needed.

```sh
bun install --frozen-lockfile
node scripts/check-zk.mjs
bun run typecheck
bun run test:server
bun run test:web
bun run test:zk
forge test --root contracts
bun run build:web
```

To intentionally regenerate circuit artifacts:

```sh
bun run build:zk
# Optional, expensive full verification of the universal transcript:
node scripts/build-zk.mjs --verify-ceremony
bun run test:zk
forge test --root contracts --match-contract PrivateMilestoneVerifierTest
```

`test:zk` produces a genuine synthetic PLONK proof, verifies it, rejects changed public signals and proof values, rejects insufficient/negative/overflowing witnesses, and checks equality at the threshold. It refreshes the Solidity fixture so the two verifier implementations are tested against the same proof. Fixtures contain only public proof data. API tests cover ownership, live status, revocation, expiry, range/valuation failures and request/issuance limits. Web tests cover strict transport parsing, input sizes, field bounds, certificate binding and rejection of extra private fields.
