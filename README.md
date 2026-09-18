<div align="center">

### SPROUT · CONTRACT ADDRESS

<pre>0x5ec27c931fb49911128dddf7d914c1754da9f49f</pre>

</div>

---

<p align="center">
  <img src="web/public/brand/sprout-logo.png" width="88" alt="SproutFi" />
</p>

<p align="center">
  <img src="header.png" alt="SproutFi — A little today. A growing tomorrow." width="100%">
</p>

<p align="center"><strong>A family stock-token savings garden.</strong><br>
Plant a vault for a child, add to it over time, and grow toward a future they can call their own.</p>

## What you can do

- Create a child-focused vault and fund it with supported assets.
- Schedule recurring contributions and invite family to send gifts.
- Follow progress toward a milestone, with a named beneficiary and a planned graduation.

Sprout is in **beta**. The local development flow and contract tests are available; some live operations remain unverified. Production unattended investing is disabled, graduation withdrawals have not been verified live, and production backup restoration has not been verified. This project is not audited or presented as launch-ready.

## Run locally

You’ll need Bun 1.3 and Foundry (`forge`, `anvil`, and `cast`). From the repository root:

```sh
bun install
bun run dev:local
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174), choose **Use local demo wallet**, and select a role. The local script runs an isolated Anvil development chain, API, and web app; it refuses to deploy to a non-development chain. Press `Ctrl-C` to stop it.

## Built with

Solidity and Foundry contracts · Bun, Hono, and SQLite backend · React and Vite dashboard · viem for EVM connectivity.

## License

Source-available for non-commercial use. See the [license](LICENSE); Sprout-owned code uses PolyForm Noncommercial 1.0.0; original artwork and documentation use CC BY-NC 4.0. Existing Solidity SPDX notices and third-party licenses take precedence.

## Contributing identity

Before making commits, run `./tools/identity/setup.sh` from this repository. It installs local author/committer and push-history guards. See [identity setup](tools/identity/README.md).

## History

See [HISTORY.md](HISTORY.md) for the status and limits of the reconstructed commit history.
