/**
 * "Root your SPROUT": the optional SPROUT time-lock (contracts/src/SproutRootLock.sol).
 *
 * A holder locks their own SPROUT for 30, 90 or 180 days and takes it back on or
 * after the date. The contract pays nothing. Inside the Sprout app, locked SPROUT
 * counts toward holder tiers straight away, weighted by how long it is locked.
 * That weighting lives here so the server and the browser use the same numbers.
 */

/** The only lock lengths the contract accepts, in days. */
export const ROOT_DURATIONS = [30, 90, 180] as const;
export type RootDays = (typeof ROOT_DURATIONS)[number];

/** How much each locked SPROUT counts toward a tier while it is still locked, in basis points. */
export const ROOT_MULTIPLIER_BPS: Readonly<Record<RootDays, number>> = { 30: 12_500, 90: 15_000, 180: 20_000 };

export function isRootDays(days: number): days is RootDays {
  return (ROOT_DURATIONS as readonly number[]).includes(days);
}

/** 1.25, 1.5 or 2 (for display). */
export function rootMultiplier(days: RootDays): number {
  return ROOT_MULTIPLIER_BPS[days] / 10_000;
}

/** What `amount` (base units) counts for toward a tier while locked for `days`. */
export function rootCredit(amount: bigint, days: RootDays): bigint {
  return (amount * BigInt(ROOT_MULTIPLIER_BPS[days])) / 10_000n;
}

// Kept in step with the compiled contract by scripts/test/root-lock-abi.test.ts.
export const sproutRootLockAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "token_",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activeLocksOf",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "ids",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getLock",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct SproutRootLock.Lock",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "unlockAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lockDays",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "withdrawn",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lock",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "days_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "lockCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "locksOf",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "token",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalLocked",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Locked",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lockDays",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "unlockAt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyWithdrawn",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadDuration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotLockOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StillLocked",
    "inputs": [
      {
        "name": "unlockAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownLock",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
