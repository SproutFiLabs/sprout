import type {
  IntelligenceAccess,
  IntelligenceConfigPublic,
  IntelligenceMessage,
} from "@sprout/shared";
import { connectWallet, injectedProvider, type WalletState } from "../wallet";
export class IntelligenceRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  body?: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/intelligence/${path}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    signal,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new IntelligenceRequestError(
      json.error ?? "Something went wrong. Please try again.",
      response.status,
    );
  return json;
}
export const intelligenceConfig = () =>
  request<IntelligenceConfigPublic>("config");
export const intelligenceChat = (
  messages: IntelligenceMessage[],
  token: string,
  signal: AbortSignal,
) =>
  request<{ answer: string; access: IntelligenceAccess }>(
    "chat",
    { messages },
    token,
    signal,
  );
export const intelligenceLogout = (token: string) =>
  request("logout", {}, token);
export async function intelligenceWallet(config: IntelligenceConfigPublic) {
  if (!config.chainId || !config.verificationReady)
    throw new Error(
      "Wallet verification is being connected. You can explore the example conversations below.",
    );
  if (!injectedProvider())
    throw new Error(
      "Open SPROUT in your wallet’s browser, or install a browser wallet to connect.",
    );
  return connectWallet({ chainId: config.chainId, name: config.chainName });
}
export async function verifyIntelligence(
  wallet: WalletState,
): Promise<{ token: string; expiresAt: number; access: IntelligenceAccess }> {
  const response = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address, purpose: "intelligence" }),
  });
  if (!response.ok)
    throw new Error("Could not prepare wallet verification. Please try again.");
  const challenge = (await response.json()) as {
    nonce: string;
    message: string;
  };
  // Personal-sign proves the account, independently of the wallet's active chain.
  // The server binds the entitlement to Robinhood Chain and the fixed token.
  const accounts = (await wallet.provider.request({
    method: "eth_accounts",
  })) as string[];
  if (accounts[0]?.toLowerCase() !== wallet.address.toLowerCase())
    throw new Error("Your wallet changed. Please reconnect.");
  const signature = await wallet.walletClient.signMessage({
    account: wallet.address,
    message: challenge.message,
  });
  const verification = await fetch("/api/intelligence/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sprout-address": wallet.address,
      "x-sprout-nonce": challenge.nonce,
      "x-sprout-signature": signature,
    },
    body: "{}",
  });
  const result = await verification.json();
  if (!verification.ok)
    throw new IntelligenceRequestError(
      result.error ?? "Could not verify your wallet.",
      verification.status,
    );
  return result;
}
