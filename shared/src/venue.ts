/**
 * Stable, hand-written view of the narrow venue contract used by vaults. This is
 * independent of any concrete adapter (mock or Uniswap V3) so configuration can
 * be validated without trusting a particular implementation's extra surface.
 */
export const sproutVenueAbi = [
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

/**
 * Optional Robinhood stock-token metadata. `uiMultiplier` is 1e18-scaled and is
 * used only for share-equivalent display, never for USD valuation.
 */
export const stockTokenAbi = [
  {
    type: 'function',
    name: 'uiMultiplier',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'oraclePaused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;
