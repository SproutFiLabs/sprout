# Harvest design QA

final result: passed

## Manual payout update

The real holder interface retains the white/serif/botanical layout and adds empty, announced-budget, registered, allocated, submitted and verified-payment states. The old demo is separated at `?demo=1`. The operator desk includes budget/deadline inputs, unpaid exports and transaction verification. Browser QA verified local operator publication, missing-wallet fallback, rules, dark mode and 390px mobile; holder and authenticated operator screens had no horizontal overflow. Evidence: `output/harvest-manual-qa/`. Pending allocations display a dash rather than implying the full budget belongs to a holder.


Scope: the interactive **product preview**, not production payout readiness.

## Reference and comparison

Selected reference: the second revised SPROUT Harvest mockup, `exec-ce6f4454-c1a6-4b1a-97f3-a74f21e67755.png` in the task's generated images. Its 1487×1058 canvas was normalized to 1440×1024 for comparison with the implemented desktop viewport.

Evidence: `output/harvest-qa/comparison-final.jpg`, `desktop-final.png`, `mobile.png`, `mobile-dialog.png`, `mobile-dark.png`, `empty.png` and `failure.png`.

The implementation retains the white canvas, orange brand mark, black serif headline, compact underline tabs, left-aligned reward amount, bright paper flowers, restrained pill buttons and ruled allocation/history sections. A generated botanical image follows the selected arrangement and established brand artwork.

## Findings resolved

- P2: flower composition initially occupied too little of the hero. Increased its desktop scale; kept mobile within the viewport.
- P2: reward typography and primary button text were too light/small. Adjusted weight and size to approach the selected hierarchy.
- P2: global label styles stacked the claim acknowledgement checkbox above its text. Scoped the label to a horizontal arrangement and recaptured the modal for the film.

No open P0–P2 visual issues were observed. Mobile was checked at 390×844 with no horizontal overflow; dialog controls and history remain usable.

## Intentional differences

- Added breakdown, receipt, history-export and scenario controls so the concept can be operated.
- Example-wallet and simulated-state labels are explicit; no connected address or payout is fabricated.
- The preview is English-only, so an unimplemented language switch was omitted.
- Added history column headings, receipt identifiers and supporting explanation; these increase page height compared with the static mockup.
- Keyboard focus rings are visible when testing keyboard navigation.

## Functional evidence

Four accounting/export tests, TypeScript checking and web production build passed. Browser checks covered reward-to-receipt completion, blocked states, failed claims without balance changes, reset, history search/clear, receipt details, explanation tab, dark mode and missing-wallet handling. Browser error log was empty. Real wallet balance integration remains unverified with an injected provider; no live distribution exists.
