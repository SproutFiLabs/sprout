/** Intelligence access uses the community token, not the vault settlement token. */
export const INTELLIGENCE_TOKEN =
  "0x5ec27c931fb49911128dddf7d914c1754da9f49f" as const;
export const INTELLIGENCE_MIN_TOKENS = "1000000";
export const INTELLIGENCE_DISCLAIMER =
  "For education and information only. Not financial advice.";
export interface IntelligenceMessage {
  role: "user" | "assistant";
  content: string;
}
export interface IntelligenceConfigPublic {
  token: typeof INTELLIGENCE_TOKEN;
  minimumTokens: string;
  chainId: number | null;
  chainName: string;
  verificationReady: boolean;
  aiReady: boolean;
  dailyLimit: number;
}
export interface IntelligenceAccess {
  address: string;
  eligible: boolean;
  balance: string;
  checkedAt: number;
  blockNumber: string;
}
