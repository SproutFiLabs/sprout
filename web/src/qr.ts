/**
 * Dependency-free QR Code encoder (ISO/IEC 18004), UTF-8 byte mode only.
 * The structure follows Project Nayuki's reference QR Code generator.
 */

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  version: number;
  size: number;
  /** modules[y][x], true = dark. */
  modules: boolean[][];
}

const ECC_ORDER: Record<QrEcc, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** The 2-bit ECC indicator stored in the format information (not the same order as above). */
const ECC_FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Rows are L, M, Q, H; index 0 of each row is unused so it can be indexed by version.
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

type Mask = (x: number, y: number) => boolean;

/** The eight data masks; a module is inverted where the mask returns true. */
const MASKS: readonly Mask[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const bit = (value: number, i: number): boolean => ((value >>> i) & 1) !== 0;

/** Bits available for data and ECC once all function patterns are placed. */
function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    result -= (25 * n - 10) * n - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function eccInfo(ver: number, ecc: QrEcc): { perBlock: number; blocks: number } {
  const row = ECC_ORDER[ecc];
  return {
    perBlock: ECC_CODEWORDS_PER_BLOCK[row]![ver]!,
    blocks: NUM_ERROR_CORRECTION_BLOCKS[row]![ver]!,
  };
}

function dataCodewords(ver: number, ecc: QrEcc): number {
  const { perBlock, blocks } = eccInfo(ver, ecc);
  return Math.floor(rawDataModules(ver) / 8) - perBlock * blocks;
}

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Generator polynomial with roots 2^0 .. 2^(degree-1), highest coefficient (always 1) dropped. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root) ^ (j + 1 < degree ? result[j + 1]! : 0);
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** Polynomial long division; the remainder is the block's ECC codewords. */
function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = result[i]! ^ gfMul(coef, factor);
    });
  }
  return result;
}

/** Splits data into blocks (short blocks first), appends ECC, and interleaves everything. */
function addEccAndInterleave(data: readonly number[], ver: number, ecc: QrEcc): number[] {
  const { perBlock, blocks: numBlocks } = eccInfo(ver, ecc);
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks) - perBlock;
  const divisor = rsDivisor(perBlock);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const block = data.slice(offset, offset + len);
    offset += len;
    blocks.push(block);
    eccs.push(rsRemainder(block, divisor));
  }
  const result: number[] = [];
  for (let i = 0; i <= shortLen; i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]!);
  }
  for (let i = 0; i < perBlock; i++) {
    for (const block of eccs) result.push(block[i]!);
  }
  return result;
}

/** Centre coordinates of alignment patterns, used on both axes. */
function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < n; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Scores one row or column: N1 (runs of 5+) and N3 (1:1:3:1:1 finder look-alikes). */
function linePenalty(line: string): number {
  let score = 0;
  for (const run of line.match(/0{5,}|1{5,}/g) ?? []) score += run.length - 2;
  // Pad with light modules because the quiet zone counts as light.
  const padded = `0000${line}0000`;
  for (let i = padded.indexOf('1011101'); i >= 0; i = padded.indexOf('1011101', i + 1)) {
    if (padded.startsWith('0000', i - 4) || padded.startsWith('0000', i + 7)) score += 40;
  }
  return score;
}

function penalty(modules: readonly boolean[][]): number {
  const size = modules.length;
  const rows = modules.map((row) => row.map((m) => (m ? '1' : '0')).join(''));
  const cols = rows.map((_, x) => rows.map((row) => row[x]).join(''));
  let score = 0;
  for (const line of [...rows, ...cols]) score += linePenalty(line);
  let dark = 0;
  for (let y = 0; y < size; y++) {
    const row = modules[y]!;
    for (let x = 0; x < size; x++) {
      const m = row[x]!;
      if (m) dark++;
      // N2: every 2x2 block of one colour.
      if (x > 0 && y > 0 && m === row[x - 1] && m === modules[y - 1]![x] && m === modules[y - 1]![x - 1]) {
        score += 3;
      }
    }
  }
  // N4: 10 points per full 5% step away from a 50/50 dark/light balance.
  const total = size * size;
  score += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export function encodeQr(text: string, ecc: QrEcc = 'M'): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  for (; ; version++) {
    if (version > 40) throw new Error('Text is too long for a QR code');
    const countBits = version <= 9 ? 8 : 16;
    if (bytes.length < 1 << countBits && 4 + countBits + bytes.length * 8 <= dataCodewords(version, ecc) * 8) break;
  }

  // Bit stream: mode, length, payload, terminator, byte padding, then 0xEC/0x11 pad bytes.
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  const capacity = dataCodewords(version, ecc) * 8;
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  const codewords = addEccAndInterleave(data, version, ecc);

  const size = version * 4 + 17;
  const grid = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const modules = grid();
  const isFunction = grid();
  const setFunction = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };

  const drawFormat = (mask: number) => {
    const value = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((value << 10) | rem) ^ 0x5412;
    // Copy around the top-left finder.
    for (let i = 0; i <= 5; i++) setFunction(8, i, bit(f, i));
    setFunction(8, 7, bit(f, 6));
    setFunction(8, 8, bit(f, 7));
    setFunction(7, 8, bit(f, 8));
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(f, i));
    // Copy split between the top-right and bottom-left finders.
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(f, i));
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(f, i));
    setFunction(8, size - 8, true); // The always-dark module.
  };

  // Timing patterns, then finders (with separators) drawn over their ends.
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  const finders: [number, number][] = [[3, 3], [size - 4, 3], [3, size - 4]];
  for (const [cx, cy] of finders) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const align = alignmentPositions(version);
  const last = align.length - 1;
  align.forEach((ay, i) => {
    align.forEach((ax, j) => {
      // Skip the three positions that overlap finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFunction(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  drawFormat(0); // Reserves the format areas; redrawn once the mask is chosen.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit(v, i));
      setFunction(b, a, bit(v, i));
    }
  }

  // Zigzag placement: two-module-wide columns from the right, alternating up and down.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Column 6 is the vertical timing pattern.
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let x = right; x >= right - 1; x--) {
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    const fn = MASKS[mask]!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunction[y]![x] && fn(x, y)) modules[y]![x] = !modules[y]![x];
      }
    }
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    applyMask(mask); // XOR again to undo.
  }
  applyMask(best);
  drawFormat(best);
  return { version, size, modules };
}

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (s: string): string => s.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);

export function qrToSvg(
  code: QrCode,
  opts: { quietZone?: number; dark?: string; light?: string; title?: string } = {},
): string {
  const { quietZone = 4, dark = '#000', light = '#fff', title } = opts;
  const dim = code.size + quietZone * 2;
  // One subpath per horizontal run of dark modules keeps the path short.
  let d = '';
  code.modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let len = 0;
      while (row[x + len]) len++;
      if (len > 0) d += `M${x + quietZone},${y + quietZone}h${len}v1h-${len}z`;
      x += len || 1;
    }
  });
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"` +
    `${title ? ' role="img"' : ''}>${label}` +
    `<rect width="${dim}" height="${dim}" fill="${escapeXml(light)}"/>` +
    `<path d="${d}" fill="${escapeXml(dark)}"/></svg>`
  );
}
