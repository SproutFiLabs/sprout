import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes, keccak256, getAddress, type Hex } from "viem";

const Point = secp256k1.ProjectivePoint;
const n = secp256k1.CURVE.n;
function publicKey(key: Uint8Array) {
  return bytesToHex(secp256k1.getPublicKey(key, true));
}
function point(key: Hex) {
  if (!/^0x0[23][0-9a-fA-F]{64}$/.test(key))
    throw new Error("Expected a compressed secp256k1 public key.");
  return Point.fromHex(key.slice(2));
}
function addressOf(p: InstanceType<typeof Point>) {
  return getAddress(`0x${keccak256(p.toRawBytes(false).slice(1)).slice(-40)}`);
}
function secretHash(secret: Uint8Array, pub: Hex) {
  if (!secp256k1.utils.isValidPrivateKey(secret))
    throw new Error("Invalid private key.");
  // Explicit encoding: Keccak-256 of the uncompressed shared point, without 0x04.
  return keccak256(
    point(pub)
      .multiply(BigInt(bytesToHex(secret)))
      .toRawBytes(false)
      .slice(1),
  );
}
export function createStealthIdentity() {
  const spendingKey = secp256k1.utils.randomPrivateKey(),
    viewingKey = secp256k1.utils.randomPrivateKey();
  return {
    spendingKey: bytesToHex(spendingKey),
    viewingKey: bytesToHex(viewingKey),
    spendingPublicKey: publicKey(spendingKey),
    viewingPublicKey: publicKey(viewingKey),
  };
}
/** Fresh entropy on every call. Does not send, fund or register the destination. */
export function deriveStealthDestination(
  spendingPublicKey: Hex,
  viewingPublicKey: Hex,
) {
  const ephemeral = secp256k1.utils.randomPrivateKey();
  try {
    const hash = secretHash(ephemeral, viewingPublicKey),
      scalar = BigInt(hash) % n;
    if (scalar === 0n) throw new Error("Degenerate shared secret; retry.");
    const p = point(spendingPublicKey).add(Point.BASE.multiply(scalar));
    if (p.equals(Point.ZERO)) throw new Error("Degenerate destination; retry.");
    return {
      scheme: "sprout-stealth-v1" as const,
      address: addressOf(p),
      ephemeralPublicKey: publicKey(ephemeral),
      viewTag: hash.slice(2, 4),
    };
  } finally {
    ephemeral.fill(0);
  }
}
export function recoverStealthKey(
  spendingKey: Hex,
  viewingKey: Hex,
  ephemeralPublicKey: Hex,
  expected: string,
): Hex {
  if (!secp256k1.utils.isValidPrivateKey(hexToBytes(spendingKey)))
    throw new Error("Invalid spending key.");
  const scalar =
    (BigInt(spendingKey) +
      BigInt(secretHash(hexToBytes(viewingKey), ephemeralPublicKey))) %
    n;
  if (scalar === 0n) throw new Error("Invalid recovered key.");
  const raw = `0x${scalar.toString(16).padStart(64, "0")}` as Hex;
  if (addressOf(Point.fromPrivateKey(hexToBytes(raw))) !== getAddress(expected))
    throw new Error("Announcement does not belong to this identity.");
  return raw;
}
