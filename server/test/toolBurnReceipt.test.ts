import { describe, expect, test } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, parseAbiItem, type Address, type Hex } from 'viem';
import { DEAD_ADDRESS, verifyToolBurn, type ToolBurnEvidence, type ToolBurnExpected } from '../src/toolBurnReceipt';

const payer = '0x1111111111111111111111111111111111111111' as Address;
const token = '0x2222222222222222222222222222222222222222' as Address;
const amount = 123n;
const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;
const blockHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;
const input = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD_ADDRESS, amount] });
const transfer = {
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: payer, to: DEAD_ADDRESS } }) as Hex[],
  data: encodeAbiParameters(parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)').inputs.slice(2), [
    amount,
  ]),
};
const eventFor = (from: Address, to: Address, value: bigint) => ({
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }) as Hex[],
  data: encodeAbiParameters(parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)').inputs.slice(2), [
    value,
  ]),
});
const expected: ToolBurnExpected = {
  chainId: 1,
  token,
  payer,
  amount,
  issuedAt: 1000,
  expiresAt: 2000,
  issuedBlock: 9n,
  headBlock: 12n,
  confirmations: 3,
};
const evidence: ToolBurnEvidence = {
  transaction: { hash: txHash, from: payer, to: token, input, chainId: 1, blockHash },
  receipt: {
    transactionHash: txHash,
    status: 'success',
    blockHash,
    blockNumber: 10n,
    logs: [{ address: token, topics: transfer.topics, data: transfer.data }],
  },
  block: { hash: blockHash, number: 10n, timestamp: 1500n },
};

describe('verifyToolBurn', () => {
  test('accepts a canonical confirmed burn', () => {
    expect(verifyToolBurn(evidence, expected)).toEqual({ txHash, amount: '123', payer, blockNumber: '10', at: 1500 });
  });

  for (const [name, mutate] of [
    ['failed receipt', (e: ToolBurnEvidence) => ({ ...e, receipt: { ...e.receipt, status: 'reverted' } })],
    ['wrong token', (e: ToolBurnEvidence) => ({ ...e, transaction: { ...e.transaction, to: payer } })],
    ['wrong payer', (e: ToolBurnEvidence) => ({ ...e, transaction: { ...e.transaction, from: token } })],
    [
      'wrong receiver calldata',
      (e: ToolBurnEvidence) => ({
        ...e,
        transaction: { ...e.transaction, input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [payer, amount] }) },
      }),
    ],
    ['missing event', (e: ToolBurnEvidence) => ({ ...e, receipt: { ...e.receipt, logs: [] } })],
    ['early block', (e: ToolBurnEvidence) => ({ ...e, receipt: { ...e.receipt, blockNumber: 9n }, block: { ...e.block, number: 9n } })],
    ['unconfirmed', (e: ToolBurnEvidence) => ({ ...e, block: { ...e.block, number: 12n }, receipt: { ...e.receipt, blockNumber: 12n } })],
  ] as const)
    test(`rejects ${name}`, () => expect(() => verifyToolBurn(mutate(evidence), expected)).toThrow('Invalid burn receipt:'));

  test('rejects trailing calldata bytes', () =>
    expect(() => verifyToolBurn({ ...evidence, transaction: { ...evidence.transaction, input: `${input}00` as Hex } }, expected)).toThrow(
      'Invalid burn receipt:',
    ));
  test('rejects event from another token', () =>
    expect(() =>
      verifyToolBurn(
        { ...evidence, receipt: { ...evidence.receipt, logs: [{ address: payer, topics: transfer.topics, data: transfer.data }] } },
        expected,
      ),
    ).toThrow('Invalid burn receipt:'));
  test('rejects wrong chain and identity hashes', () => {
    expect(() => verifyToolBurn({ ...evidence, transaction: { ...evidence.transaction, chainId: 2 } }, expected)).toThrow(
      'Invalid burn receipt:',
    );
    expect(() => verifyToolBurn({ ...evidence, receipt: { ...evidence.receipt, transactionHash: payer as Hex } }, expected)).toThrow(
      'Invalid burn receipt:',
    );
    expect(() => verifyToolBurn({ ...evidence, block: { ...evidence.block, hash: txHash } }, expected)).toThrow('Invalid burn receipt:');
  });
  test('rejects timestamps outside quote window', () => {
    expect(() => verifyToolBurn({ ...evidence, block: { ...evidence.block, timestamp: 999n } }, expected)).toThrow('Invalid burn receipt:');
    expect(() => verifyToolBurn({ ...evidence, block: { ...evidence.block, timestamp: 2001n } }, expected)).toThrow(
      'Invalid burn receipt:',
    );
  });
  test('rejects wrong amount and function calldata', () => {
    expect(() =>
      verifyToolBurn(
        {
          ...evidence,
          transaction: {
            ...evidence.transaction,
            input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEAD_ADDRESS, 124n] }),
          },
        },
        expected,
      ),
    ).toThrow('Invalid burn receipt:');
    expect(() =>
      verifyToolBurn(
        {
          ...evidence,
          transaction: {
            ...evidence.transaction,
            input: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DEAD_ADDRESS, amount] }),
          },
        },
        expected,
      ),
    ).toThrow('Invalid burn receipt:');
  });
  test('rejects wrong event payer, recipient, or amount', () => {
    for (const log of [eventFor(token, DEAD_ADDRESS, amount), eventFor(payer, token, amount), eventFor(payer, DEAD_ADDRESS, amount + 1n)]) {
      expect(() => verifyToolBurn({ ...evidence, receipt: { ...evidence.receipt, logs: [{ address: token, ...log }] } }, expected)).toThrow(
        'Invalid burn receipt:',
      );
    }
  });
  test('accepts exact confirmation boundary', () => {
    expect(
      verifyToolBurn(
        { ...evidence, block: { ...evidence.block, number: 10n }, receipt: { ...evidence.receipt, blockNumber: 10n } },
        { ...expected, headBlock: 12n, confirmations: 3 },
      ),
    ).toBeTruthy();
  });
  test('rejects invalid expected inputs', () => {
    expect(() => verifyToolBurn(evidence, { ...expected, amount: 0n })).toThrow('Invalid burn receipt:');
    expect(() => verifyToolBurn(evidence, { ...expected, confirmations: 0 })).toThrow('Invalid burn receipt:');
    expect(() => verifyToolBurn(evidence, { ...expected, issuedAt: 2.5 })).toThrow('Invalid burn receipt:');
    expect(() => verifyToolBurn(evidence, { ...expected, expiresAt: 900 })).toThrow('Invalid burn receipt:');
    expect(() => verifyToolBurn(evidence, { ...expected, issuedBlock: -1n })).toThrow('Invalid burn receipt:');
  });
});
