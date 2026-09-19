import { decodeEventLog, decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem';

export interface ToolBurnTransaction {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
  chainId: number;
  blockHash: Hex | null;
}

export interface ToolBurnReceiptLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
}

export interface ToolBurnReceipt {
  transactionHash: Hex;
  status: 'success' | 'reverted' | string;
  blockHash: Hex;
  blockNumber: bigint;
  logs: readonly ToolBurnReceiptLog[];
}

export interface ToolBurnBlock {
  hash: Hex;
  number: bigint;
  timestamp: bigint;
}

export interface ToolBurnEvidence {
  transaction: ToolBurnTransaction;
  receipt: ToolBurnReceipt;
  block: ToolBurnBlock;
}

export interface ToolBurnExpected {
  chainId: number;
  token: Address;
  payer: Address;
  amount: bigint;
  issuedAt: number;
  expiresAt: number;
  issuedBlock: bigint;
  headBlock: bigint;
  confirmations: number;
}

export interface ToolBurnReceiptResult {
  txHash: Hex;
  amount: string;
  payer: Address;
  blockNumber: string;
  at: number;
}

export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: string) => getAddress(value as Address);
const fail = (message: string): never => {
  throw new Error(`Invalid burn receipt: ${message}`);
};

export function verifyToolBurn(evidence: ToolBurnEvidence, expected: ToolBurnExpected): ToolBurnReceiptResult {
  if (expected.amount <= 0n) return fail('invalid amount');
  if (!Number.isInteger(expected.confirmations) || expected.confirmations <= 0) return fail('invalid confirmations');
  if (!Number.isSafeInteger(expected.issuedAt) || !Number.isSafeInteger(expected.expiresAt) || expected.expiresAt < expected.issuedAt)
    return fail('invalid quote window');
  if (expected.issuedBlock < 0n) return fail('invalid issued block');
  const { transaction: tx, receipt, block } = evidence;
  let token: Address, payer: Address;
  try {
    token = address(expected.token);
    payer = address(expected.payer);
  } catch {
    return fail('invalid expected address');
  }
  if (tx.chainId !== expected.chainId) return fail('wrong chain');
  if (receipt.status !== 'success') return fail('transaction failed');
  if (!sameHex(tx.hash, receipt.transactionHash)) return fail('transaction hash mismatch');
  if (!sameHex(receipt.blockHash, block.hash)) return fail('block hash mismatch');
  if (receipt.blockNumber !== block.number) return fail('block number mismatch');
  if (receipt.blockNumber <= expected.issuedBlock) return fail('transaction predates quote');
  if (tx.blockHash === null || !sameHex(tx.blockHash, receipt.blockHash)) return fail('transaction block mismatch');
  if (block.number > expected.headBlock || expected.headBlock - block.number + 1n < BigInt(expected.confirmations))
    return fail('insufficient confirmations');
  const at = Number(block.timestamp);
  if (!Number.isSafeInteger(at) || at < expected.issuedAt || at > expected.expiresAt) return fail('timestamp outside quote window');
  try {
    if (tx.to === null || address(tx.to) !== token || address(tx.from) !== payer) return fail('wrong token or payer');
    if (tx.input.length !== 138) return fail('non-canonical transfer calldata');
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    if (
      decoded.functionName !== 'transfer' ||
      !decoded.args ||
      address(decoded.args[0]) !== DEAD_ADDRESS ||
      decoded.args[1] !== expected.amount
    )
      return fail('invalid transfer calldata');
    let found = false;
    for (const log of receipt.logs) {
      if (address(log.address) !== token || log.topics.length < 3) continue;
      try {
        const event = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (
          event.args.from &&
          event.args.to &&
          address(event.args.from) === payer &&
          address(event.args.to) === DEAD_ADDRESS &&
          event.args.value === expected.amount
        )
          found = true;
      } catch {
        /* unrelated or malformed logs are ignored */
      }
    }
    if (!found) return fail('missing burn event');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid burn receipt:')) throw error;
    return fail('malformed transaction data');
  }
  return { txHash: tx.hash, amount: expected.amount.toString(), payer, blockNumber: block.number.toString(), at };
}
