import { inspectPublicVenue } from "../server/src/privacy-venue";
// Only public data is queried; no wallet, signature, approvals or transaction submission.
console.log(JSON.stringify(await inspectPublicVenue(), null, 2));
