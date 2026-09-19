import { keccak256, toHex } from "viem";
export interface SpendProduct {
  id: string;
  name: string;
  country: string;
  currency: string;
  values: number[];
  category: string;
}
export interface SpendRequest {
  key: string;
  vault: string;
  product: string;
  value: number;
  country: string;
}
export interface SpendOrder {
  id: string;
  product: SpendProduct;
  value: number;
  status:
    | "creating"
    | "unpaid"
    | "confirming"
    | "delivered"
    | "expired"
    | "attention";
  createdAt: number;
  paymentStarted?: boolean;
  payment?: {
    address: `0x${string}`;
    amount: string;
    chainId: 8453;
    token: `0x${string}`;
    expiresAt: number;
  };
  redemption?: {
    code?: string;
    pin?: string;
    instructions?: string;
    link?: string;
  };
}
export interface SpendCatalog {
  enabled: boolean;
  products: SpendProduct[];
  perOrderLimit: number;
  dailyLimit: number;
  country: string;
}
export const SPEND_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export function spendPurpose(r: SpendRequest) {
  return `spend:${keccak256(toHex(JSON.stringify([r.key, r.vault.toLowerCase(), r.product, r.value, r.country])))}`;
}
