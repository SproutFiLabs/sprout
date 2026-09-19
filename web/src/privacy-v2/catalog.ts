export const privacyFeatures = [
  {
    id: "swaps",
    title: "Private swaps",
    phrase: "Prepare a private stock order",
    action: "Save order",
    description:
      "Choose a stock, quantity and price limit. The order details are saved in your encrypted workspace.",
    steps: [
      "Choose a stock",
      "Set the quantity and limit",
      "Save the encrypted order",
    ],
    detail:
      "Settlement requires a connected shielded pool and a verified family-policy circuit.",
  },
  {
    id: "tags",
    title: "Payment tags",
    phrase: "A new address for each payment",
    action: "Create an address",
    description:
      "Use an alias to create a new address. Keep the keys in your encrypted backup so you can recover it later.",
    steps: [
      "Choose an alias",
      "Create a new address",
      "Download your encrypted backup",
    ],
    detail:
      "These destinations are generated locally. Tag registration and shielded payments are not connected. Public transfers expose amounts.",
  },
  {
    id: "gifts",
    title: "Gift routing",
    phrase: "Divide a gift across their chosen stocks",
    action: "Save gift plan",
    description:
      "Choose how a gift would be divided between two stocks. The plan accounts for the full amount, including rounding.",
    steps: [
      "Enter the gift amount",
      "Choose two stocks",
      "Save the allocation",
    ],
    detail:
      "Preparing a routing plan does not transfer or convert a gift. Conversion requires verified private settlement.",
  },
  {
    id: "adult",
    title: "Adult savings",
    phrase: "Keep your saving plans in one place",
    action: "Save savings plan",
    description:
      "Choose an amount, a schedule and two stocks. Save the plan on this device, protected by your passphrase.",
    steps: [
      "Choose a schedule",
      "Choose two stocks",
      "Save the encrypted plan",
    ],
    detail:
      "Plans are stored on this device. Recurring purchases are not scheduled or executed yet.",
  },
  {
    id: "policy",
    title: "Family rules",
    phrase: "Set the rules for their portfolio",
    action: "Save family rules",
    description:
      "Choose the stocks a child may hold, the size of an order and how much may go into one stock.",
    steps: [
      "Choose an allowed stock",
      "Set the order and allocation limits",
      "Save a version of these rules",
    ],
    detail:
      "This local commitment is not yet registered on-chain. Private trades need a circuit that proves these rules.",
  },
  {
    id: "attestations",
    title: "Private credentials",
    phrase: "Choose what a proof should reveal",
    action: "Save proof request",
    description:
      "Prepare a request for a holdings or membership check. Specify who can use it and when it expires.",
    steps: [
      "Choose a statement",
      "Specify the audience and verifier",
      "Create a five-minute request",
    ],
    detail:
      "This creates a request, not a holdings or solvency proof. Those verifiers are not connected.",
  },
] as const;
export type FeatureId = (typeof privacyFeatures)[number]["id"];
export interface PublicVenue {
  provider: string;
  blockNumber: string;
  windowSeconds: number;
  markets: { symbol: string; token: string; decimals: number }[];
  sproutSettlementEnabled: false;
}
export type WorkspaceFields = {
  amount: string;
  asset: string;
  secondAsset: string;
  weight: string;
  limit: string;
  cadence: string;
  tag: string;
  audience: string;
  verifier: string;
  root: string;
  claim: string;
  spread: string;
};
export const initialFields: WorkspaceFields = {
  amount: "1",
  asset: "",
  secondAsset: "",
  weight: "60",
  limit: "250",
  cadence: "7",
  tag: "",
  audience: "",
  verifier: "",
  root: "",
  claim: "holdings",
  spread: "50",
};
