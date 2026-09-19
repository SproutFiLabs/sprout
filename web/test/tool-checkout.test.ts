import { describe, expect, test } from 'bun:test';
import { claimPaymentAttempt, paymentAttemptError } from '../src/tools/ToolsPage';

function storage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    value: () => value,
  };
}
const lock = (available = true) => ({
  request: async <T>(_name: string, _options: { ifAvailable: true }, callback: (value: object | null) => Promise<T>) =>
    callback(available ? {} : null),
});

describe('premium tool payment state decisions', () => {
  test('a second locked attempt refuses submitted state without writing or calling wallet', async () => {
    const saved = storage(JSON.stringify({ state: 'submitted', hash: '0xabc', updatedAt: 1 }));
    let writes = 0;
    await expect(
      claimPaymentAttempt('order', lock(), saved, async () => {
        writes++;
        return '0xnew';
      }),
    ).rejects.toThrow('already has a payment attempt');
    expect(writes).toBe(0);
  });
  test('reload with submitted state stays verify-only, while a fresh order claims and persists hash', async () => {
    const saved = storage();
    expect(await claimPaymentAttempt('fresh', lock(), saved, async () => '0xsent')).toBe('0xsent');
    expect(saved.value()).toContain('"state":"submitted"');
    await expect(claimPaymentAttempt('fresh', lock(), saved, async () => '0xagain')).rejects.toThrow('already has a payment attempt');
  });
  test('without locks or storage, payment fails closed', async () => {
    await expect(claimPaymentAttempt('order', undefined, storage(), async () => '0xsent')).rejects.toThrow('cannot safely coordinate');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    await expect(claimPaymentAttempt('order', lock(), broken, async () => '0xsent')).rejects.toThrow('storage is unavailable');
  });
  test('only code 4001 during signing is retryable', () => {
    expect(paymentAttemptError({ code: 4001 }, 'signing')).toBe('retry');
    expect(paymentAttemptError({ cause: { code: 4001 } }, 'signing')).toBe('retry');
    expect(paymentAttemptError({ message: 'User rejected' }, 'signing')).toBe('ambiguous');
    expect(paymentAttemptError({ code: 4001 }, 'receipt')).toBe('ambiguous');
  });
});
