import { describe, expect, test } from 'bun:test';
import { encodeQr, qrToSvg } from '../src/qr';

// Structural checks that need no decoder. `bun run qr:verify` decodes every
// version with a real QR reader (macOS).
describe('qr encoder', () => {
  test('picks the smallest version that fits', () => {
    expect(encodeQr('', 'M').version).toBe(1);
    expect(encodeQr('x'.repeat(14), 'M').version).toBe(1);
    expect(encodeQr('x'.repeat(15), 'M').version).toBe(2);
    const gift = `https://www.sproutfy.tech/gift/0x${'ab'.repeat(32)}`;
    // 97 bytes: over version 7-Q's 88, within version 8-Q's 108.
    expect(encodeQr(gift, 'Q').version).toBe(8);
  });

  test('has the finder patterns and the fixed dark module', () => {
    const code = encodeQr('sprout', 'Q');
    expect(code.size).toBe(code.version * 4 + 17);
    const m = code.modules;
    for (const [x, y] of [[0, 0], [code.size - 7, 0], [0, code.size - 7]] as const) {
      expect(m[y]![x]).toBe(true);
      expect(m[y + 1]![x + 1]).toBe(false);
      expect(m[y + 3]![x + 3]).toBe(true);
    }
    expect(m[code.size - 8]![8]).toBe(true);
  });

  test('refuses text beyond version 40', () => {
    expect(() => encodeQr('x'.repeat(2332), 'M')).toThrow('Text is too long for a QR code');
  });

  test('renders an SVG with a quiet zone and an escaped title', () => {
    const svg = qrToSvg(encodeQr('hi'), { title: 'a <b> & "c"' });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('<title>a &lt;b&gt; &amp; &quot;c&quot;</title>');
  });
});
