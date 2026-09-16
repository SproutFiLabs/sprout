import { describe, expect, test } from 'bun:test';
import { createChainContext } from '../src/chain';
import { memoryDb, testApp, testConfig } from './helpers';

const EVM = '0x1111111111111111111111111111111111111111';
const BASE58 = 'So11111111111111111111111111111111111111112';

async function publicCaFor(env: Record<string, string>) {
  const app = testApp(memoryDb(), createChainContext(testConfig(env)));
  const body = (await (await app.request('/api/config')).json()) as { publicCa: string | null };
  return body.publicCa;
}

describe('public contract address', () => {
  test('is hidden until set', async () => {
    expect(testConfig().publicCa).toBeUndefined();
    expect(await publicCaFor({})).toBeNull();
    expect(await publicCaFor({ SPROUT_PUBLIC_CA: '   ' })).toBeNull();
  });

  test('serves a 0x or base58 address exactly as set, trimmed', async () => {
    expect(await publicCaFor({ SPROUT_PUBLIC_CA: ` ${EVM} ` })).toBe(EVM);
    expect(await publicCaFor({ SPROUT_PUBLIC_CA: BASE58 })).toBe(BASE58);
  });

  test('refuses anything that is not address-shaped', () => {
    for (const bad of ['coming soon', '0x123', `${EVM}0`, 'https://example.com/0x1111', `${BASE58}!`, '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl']) {
      expect(() => testConfig({ SPROUT_PUBLIC_CA: bad })).toThrow('SPROUT_PUBLIC_CA');
    }
  });
});
