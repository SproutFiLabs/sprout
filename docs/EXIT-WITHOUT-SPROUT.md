# Getting money out without Sprout

Sproutfy.tech is only a window onto each sprout. The money sits in the sprout's own
contract on Robinhood Chain (chain id 4663). That contract has no owner or admin key:
nobody at Sprout can move, freeze or refund it, and it keeps working if the website, the
server or Railway are gone. This page is how a family reaches it without us.

## The rules the contract enforces

| When | Who | What | Where the money goes |
| --- | --- | --- | --- |
| Before the graduation date | the parent (the wallet that planted it) | `createMilestone` then `releaseMilestone` | into the sprout's reward bucket |
| Any time | the child (the beneficiary wallet) | `claimAllowance` | the child's wallet |
| From the graduation date | the child | `withdraw` | any address the child names |

Money never goes back to the parent or to a gifter, and neither the graduation date nor
the child's wallet can be changed. To take everything out early, the parent releases the
whole balance as rewards and the child claims it. So the child's wallet should be one the
family can open.

## What you need

- **The sprout's address.** On the dashboard, open the wallet menu at the top and copy
  "This sprout". Write it down.
- **The parent's wallet** (for rewards) and **the child's wallet**, both on Robinhood Chain
  with a little ETH for fees.
- **The sprout ABI:** [`sprout-vault.abi.json`](sprout-vault.abi.json) (also served at
  `https://www.sproutfy.tech/sprout-vault.abi.json`). The full verified source is on
  [Sourcify](https://repo.sourcify.dev/4663/0x789ca950BAE92f4c18f5eBf776d54d85a0fF9A59);
  every sprout is a copy of that contract.

## Token addresses and units

Amounts are in each token's smallest unit.

| Token | Address | Decimals | Example |
| --- | --- | --- | --- |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 | $5 = `5000000` |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | 18 | 0.5 = `500000000000000000` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 18 | |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | 18 | |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | 18 | |

To see how much a sprout holds, open its address on the block explorer
(`https://robinhoodchain.blockscout.com/address/<sprout address>`, Tokens tab), or call
`balanceOf(<sprout address>)` on the token contract.

## Steps with Remix (free, in the browser)

1. Open [remix.ethereum.org](https://remix.ethereum.org). Switch your wallet to Robinhood
   Chain and connect the wallet you need for the step (parent or child).
2. Create a file named `SproutVault.abi`, paste the ABI into it, and keep that file open in
   the editor.
3. Open **Deploy & run transactions**. Set the environment to your wallet (called
   **Browser Extension** or **Injected Provider**, depending on the Remix version).
4. Paste the sprout's address into the contract address box and press **Add** (older
   versions: **At Address**). The sprout's functions appear under Deployed Contracts.
5. **Before the graduation date, as the parent:**
   - `createMilestone`: `id` is any 32-byte number you haven't used on this sprout, for
     example `0x0000000000000000000000000000000000000000000000000000000000000e01`;
     `token` is the token address; `amount` is how much to release; `unlockTime` is `0`.
     The amount can't be more than the sprout holds minus rewards already set aside or
     waiting.
   - `releaseMilestone` with the same `id`.
   - A stock token can only be released while it is in the sprout's mix (`assets`). USDG
     always can.
6. **As the child:** `claimAllowance` with the token address and the amount released
   (`allowanceBucket(token)` shows it). It arrives in the child's wallet.
7. **From the graduation date, as the child:** `withdraw` with the token address, the amount
   and the address to send it to. Repeat for each token the sprout holds.

A step that isn't allowed yet fails before anything is sent: `Graduated` (parent actions
after the date), `NotGraduated` (withdrawal before it), `NotParent`, `NotBeneficiary`,
`AlreadyDone` (that milestone id is used; pick another), `Overcommitted` (release amount
too high), `ExceedsAllowance` (claim amount too high), `UnsupportedToken` (not in the mix).

Command-line users can do the same with Foundry's `cast send`.

## How this is tested

- `bun run fork:exit` forks Robinhood Chain locally and, against the real deployed factory
  and every live sprout, does all of the above with direct contract calls only: rewards
  before graduation, the child's claim, withdrawal after the date, and checks that the
  parent and strangers can't take anything. It also plants and funds a fresh sprout
  through the real factory. Nothing is sent to the real chain. (2026-09-17: 23/23.)
- **A real rehearsal:** with your own wallets and without opening sproutfy.tech, use the steps
  above on a small sprout: release $1 as a reward and claim it, and after its graduation date
  withdraw the rest.

## Contracts

| Contract | Address |
| --- | --- |
| SproutFactory | `0x399C4cbf1884A958D20259c53f11E81a11dB201d` |
| SproutVault (the code every sprout runs) | `0x789ca950BAE92f4c18f5eBf776d54d85a0fF9A59` |
| UniswapV3Adapter | `0xC7366F864Cac8D97a89e57957aE949FAFb17e520` |

All three are verified on Sourcify with exact matches.
